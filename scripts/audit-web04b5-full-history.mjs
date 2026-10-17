import {createHash} from 'node:crypto';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertIdentifiers} from './audit-web04b-d1-readonly.mjs';

const API='https://api.cloudflare.com/client/v4';
const MAX_COMPLETE_ROWS=50000;
const MAX_RESPONSE=512000;
// Cloudflare D1 caps LIKE/GLOB patterns at 50 bytes. Each fragment must fit.
const DATE_GLOB='[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]';
const CLOCK_GLOB='T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]';
const FRACTION_GLOB='.[0-9][0-9][0-9]Z';
const GLOB_PARTS=Object.freeze([DATE_GLOB,CLOCK_GLOB,FRACTION_GLOB]);
if(GLOB_PARTS.some(x=>Buffer.byteLength(x,'utf8')>50))
  throw Error('D1 GLOB fragment exceeds 50-byte pattern limit');
const SQL=Object.freeze({
  count:"SELECT COUNT(*) AS n FROM advisories WHERE ingest_status='complete'",
  formats:`SELECT COUNT(*) AS n,
    COALESCE(SUM(CASE WHEN issued_at IS NULL OR julianday(issued_at) IS NULL THEN 1 ELSE 0 END),0) AS invalidTime,
    COALESCE(SUM(CASE WHEN issued_at IS NULL OR length(issued_at)<>24
      OR substr(issued_at,1,10) NOT GLOB '${DATE_GLOB}'
      OR substr(issued_at,11,9) NOT GLOB '${CLOCK_GLOB}'
      OR substr(issued_at,20,5) NOT GLOB '${FRACTION_GLOB}'
      THEN 1 ELSE 0 END),0) AS nonCanonicalShape,
    COALESCE(SUM(CASE WHEN id IS NULL OR trim(id)='' THEN 1 ELSE 0 END),0) AS invalidId,
    COALESCE(SUM(CASE WHEN storm_id IS NULL OR trim(storm_id)='' THEN 1 ELSE 0 END),0) AS invalidStormId
    FROM advisories WHERE ingest_status='complete'`,
  ties:`SELECT COUNT(*) AS sameStormTimeGroups,
    COALESCE(SUM(n-1),0) AS repeatedRows,
    COALESCE(SUM(CASE WHEN agencies>1 THEN 1 ELSE 0 END),0) AS multiAgencyTieGroups
    FROM (SELECT storm_id,issued_at,COUNT(*) AS n,COUNT(DISTINCT agency) AS agencies
      FROM advisories WHERE ingest_status='complete'
      GROUP BY storm_id,issued_at HAVING COUNT(*)>1)`,
  agency:"SELECT agency,COUNT(*) AS n FROM advisories WHERE ingest_status='complete' GROUP BY agency LIMIT 16",
  basePlan:"EXPLAIN QUERY PLAN SELECT id FROM advisories WHERE storm_id=? AND ingest_status='complete' ORDER BY issued_at DESC,id DESC LIMIT 201",
  agencyPlan:"EXPLAIN QUERY PLAN SELECT id FROM advisories WHERE storm_id=? AND agency=? AND ingest_status='complete' ORDER BY issued_at DESC,id DESC LIMIT 201",
  cursorPlan:"EXPLAIN QUERY PLAN SELECT id FROM advisories WHERE storm_id=? AND ingest_status='complete' AND (issued_at<? OR (issued_at=? AND id<?)) ORDER BY issued_at DESC,id DESC LIMIT 201"
});
const PLAN_STORM='STC-NEVER-MATCHES-WEB04B5-PROBE';
const PLAN_TIME='2026-10-17T00:00:00.000Z';
const PLAN_PARAMS=Object.freeze({
  count:[],formats:[],ties:[],agency:[],basePlan:[PLAN_STORM],
  agencyPlan:[PLAN_STORM,'JMA'],
  cursorPlan:[PLAN_STORM,PLAN_TIME,PLAN_TIME,'STC-NO-REAL-ADVISORY-ID']
});
function numberField(value,label) {
  if(value == null || typeof value==='boolean') throw Error('Invalid aggregate count: '+label);
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<0) throw Error('Invalid aggregate count: '+label);
  return n;
}
function shortHash(s){return createHash('sha256').update(s).digest('hex').slice(0,16);}
function errorCategory(apiBody) {
  const errors=Array.isArray(apiBody?.errors)?apiBody.errors:[];
  const joined=errors.map(x=>typeof x?.message==='string'?x.message:'').join(' ').toLowerCase();
  // Do not echo arbitrary error messages: they could contain SQL or account details.
  if(/like or glob pattern too complex|glob pattern|like pattern/.test(joined))return 'GLOB_PATTERN_LIMIT';
  if(/not authorized|permission|forbidden|access denied/.test(joined))return 'AUTHORIZATION';
  if(/syntax error|sqlite_error|sql statement/.test(joined))return 'SQL_REJECTED';
  if(/quota|limit exceeded|too many/.test(joined))return 'RESOURCE_LIMIT';
  return 'UNCLASSIFIED';
}
function safeCodes(apiBody) {
  return [...new Set((Array.isArray(apiBody?.errors)?apiBody.errors:[])
    .map(x=>x?.code).filter(x=>Number.isSafeInteger(x)&&x>=1000))].slice(0,4);
}
async function readJson(res) {
  const len=Number(res.headers.get('content-length'));
  if(Number.isFinite(len)&&len>MAX_RESPONSE)throw Error('Oversized response');
  const reader=res.body?.getReader();
  if(!reader)throw Error('Missing Cloudflare response');
  const parts=[];let bytes=0;
  try {
    while(true) {
      const {value,done}=await reader.read();if(done)break;
      bytes+=value.byteLength;if(bytes>MAX_RESPONSE){await reader.cancel();throw Error('Oversized response');}
      parts.push(Buffer.from(value));
    }
  }finally{reader.releaseLock();}
  try {return JSON.parse(Buffer.concat(parts,bytes).toString('utf8'));}
  catch{throw Error('Cloudflare returned non-JSON data');}
}
function unwrap(data,label,expectMax=32) {
  if(data?.success!==true || !Array.isArray(data.result) || data.result.length!==1
     || data.result[0]?.success!==true || !Array.isArray(data.result[0].results))
    throw Error('D1 read failed: '+label);
  const entry=data.result[0];
  if(entry.meta?.changed_db===true || Number(entry.meta?.rows_written||0)>0
     || Number(entry.meta?.changes||0)>0)throw Error('Unexpected D1 write indicator');
  if(entry.results.length>expectMax)throw Error('Unexpected D1 result size');
  return entry.results;
}
async function auditFullHistory({accountId,databaseId,token,fetchImpl=fetch,persist=saveReport}={}) {
  assertIdentifiers(accountId,databaseId);
  if(typeof token!=='string'||!token.trim())throw Error('D1 Read API token required');
  const url=API+'/accounts/'+accountId+'/d1/database/'+databaseId;
  let calls=0;
  async function api(path,method,body=null,stage='metadata'){
    calls++;
    const response=await fetchImpl(url+path,{
      method,redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{Authorization:'Bearer '+token,Accept:'application/json',
        ...(method==='POST'?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    if(!response.ok){
      let parsed=null;
      try{parsed=await readJson(response);}catch{/* Non-JSON errors remain classified by HTTP code. */}
      throw Error('Cloudflare D1 stage='+stage+' HTTP '+response.status
        +' CF codes='+JSON.stringify(safeCodes(parsed))
        +' category='+errorCategory(parsed));
    }
    return readJson(response);
  }
  const database=await api('','GET');
  if(database?.success!==true||database.result?.uuid!==databaseId)
    throw Error('D1 database identity mismatch; no queries issued');
  async function query(name) {
    const sql=SQL[name];
    return unwrap(await api('/query','POST',{sql,params:PLAN_PARAMS[name]},name),
      name,name==='agency'?16:32);
  }
  const preflight=await query('count');
  if(preflight.length!==1)throw Error('Missing D1 count');
  const n=numberField(preflight[0].n,'totalComplete');
  const base={
    contract:'storm-web04b5-full-history-readonly/v1',
    recordedAt:new Date().toISOString(),
    accountIdSha256Prefix:shortHash(accountId),
    databaseIdSha256Prefix:shortHash(databaseId),
    databaseName:database.result.name||null,
    completeRows:n,maxAllowedRows:MAX_COMPLETE_ROWS,
    source:'Cloudflare D1 aggregate-only read; not a snapshot',
    writesAttempted:0
  };
  if(n>MAX_COMPLETE_ROWS){
    const report={...base,outcome:'full-audit-blocked-large-database',
      requests:calls,releaseGate:'BLOCKED_NO_PRODUCTION_CHANGES'};
    return {...report,localEvidenceDirectory:await persist(report)};
  }
  const formats=(await query('formats'))[0];
  const ties=(await query('ties'))[0];
  if(!formats||!ties)throw Error('Missing D1 aggregate results');
  const agencies=await query('agency');
  const plans={};
  for(const key of ['basePlan','agencyPlan','cursorPlan']){
    const rows=await query(key);
    plans[key]=rows.map(r=>String(r.detail||'')).slice(0,32);
  }
  const formatted={
    total:numberField(formats.n,'formats.total'),
    invalidTime:numberField(formats.invalidTime,'invalidTime'),
    nonCanonicalShape:numberField(formats.nonCanonicalShape,'nonCanonicalShape'),
    invalidId:numberField(formats.invalidId,'invalidId'),
    invalidStormId:numberField(formats.invalidStormId,'invalidStormId')
  };
  if(formatted.total!==n) throw Error('D1 count changed during scan; result discarded');
  const report={
    ...base,outcome:'aggregates-read-no-snapshot',
    formats:formatted,
    ties:{
      sameStormTimeGroups:numberField(ties.sameStormTimeGroups,'tieGroups'),
      repeatedRows:numberField(ties.repeatedRows,'repeatedRows'),
      multiAgencyTieGroups:numberField(ties.multiAgencyTieGroups,'multiAgencyTieGroups')
    },
    agencyCounts:agencies.map(row=>({
      agency:String(row.agency||'UNKNOWN').slice(0,64),
      count:numberField(row.n,'agencyCount')
    })),
    plans,
    warnings:[
      'Aggregates do not prove an immutable snapshot during concurrent ingest',
      'SQLite GLOB/julianday are aggregate screens, not full JS ISO parser',
      'Explain plans may differ from runtime query cost',
      'DB UUID must be independently confirmed as Worker DB binding'
    ],
    requests:calls,releaseGate:'BLOCKED_NO_PRODUCTION_CHANGES'
  };
  return {...report,localEvidenceDirectory:await persist(report)};
}
async function saveReport(report) {
  const dir=await mkdtemp(join(tmpdir(),'storm-web04b5-private-'));
  await writeFile(join(dir,'full-history-aggregate.private.json'),
    JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
  return dir;
}
function parseArgs(argv){
  const out={};
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--account-id'&&argv[i+1])out.accountId=argv[++i];
    else if(argv[i]==='--database-id'&&argv[i+1])out.databaseId=argv[++i];
    else throw Error('Usage: node scripts/audit-web04b5-full-history.mjs --account-id ID --database-id UUID');
  }
  return out;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const report=await auditFullHistory({...parseArgs(process.argv.slice(2)),
      token:process.env.CLOUDFLARE_API_TOKEN});
    console.log(JSON.stringify(report,null,2));
    if(report.outcome!=='aggregates-read-no-snapshot')process.exitCode=2;
  }catch(error){console.error('WEB-04B-5 aggregate audit blocked:',error.message);process.exitCode=1;}
}
export {auditFullHistory,parseArgs,SQL,PLAN_PARAMS,numberField,GLOB_PARTS,errorCategory,safeCodes};
