import {createHash} from 'node:crypto';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const ORIGIN = 'https://api.cloudflare.com/client/v4';
const ACCOUNT_ID = /^[a-f0-9]{32}$/i;
const DATABASE_ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const MAX_BODY_BYTES = 512_000;
const TIMEOUT_MS = 15_000;
const SAMPLE_LIMIT = 128;
const PLAN_STORM = 'WEB04B-AUDIT-NONEXISTENT-STORM';
const PLAN_DATE = '2026-01-01T00:00:00.000Z';

// No caller-supplied SQL. Only fixed metadata reads, bounded SELECT and EXPLAIN.
// D1's HTTP query API is POST even when the SQL and account permissions are read-only.
const QUERIES = Object.freeze([
  {key:'columns', sql:"PRAGMA table_info('advisories')", params:[]},
  {key:'indexList', sql:"PRAGMA index_list('advisories')", params:[]},
  {key:'indexSql', sql:"SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='advisories' LIMIT 32", params:[]},
  {key:'basePlan', sql:"EXPLAIN QUERY PLAN SELECT id FROM advisories WHERE storm_id=? AND ingest_status='complete' ORDER BY issued_at DESC, id DESC LIMIT 201", params:[PLAN_STORM]},
  {key:'agencyPlan', sql:"EXPLAIN QUERY PLAN SELECT id FROM advisories WHERE storm_id=? AND agency=? AND ingest_status='complete' ORDER BY issued_at DESC, id DESC LIMIT 201", params:[PLAN_STORM,'JMA']},
  {key:'cursorPlan', sql:"EXPLAIN QUERY PLAN SELECT id FROM advisories WHERE storm_id=? AND ingest_status='complete' AND (issued_at < ? OR (issued_at = ? AND id < ?)) ORDER BY issued_at DESC, id DESC LIMIT 201", params:[PLAN_STORM,PLAN_DATE,PLAN_DATE,'WEB04B-AUDIT-EXAMPLE-ID']},
  {key:'sample', sql:`SELECT id, storm_id, agency, issued_at FROM advisories WHERE ingest_status='complete' LIMIT ${SAMPLE_LIMIT}`, params:[]}
]);
function assertIdentifiers(accountId,databaseId) {
  if(!ACCOUNT_ID.test(accountId||'')) throw new Error('Cloudflare Account ID must be 32 hex characters');
  if(!DATABASE_ID.test(databaseId||'')) throw new Error('D1 database ID must be a UUID');
}
function summarizePlan(rows) {
  const details=rows.map(row=>String(row?.detail||''));
  return {
    steps:details.length,
    indexSearch:details.some(x=>/\bSEARCH\b.*\bUSING\b.*\bINDEX\b/i.test(x)),
    indexScan:details.some(x=>/\bSCAN\b.*\bUSING\b.*\bINDEX\b/i.test(x)),
    tableScan:details.some(x=>/\bSCAN\s+(?:TABLE\s+)?advisories\b(?!.*\bUSING\b)/i.test(x)),
    tempSort:details.some(x=>/\b(?:TEMP|TEMPORARY)\s+B-?TREE\b/i.test(x)),
    explanation:'EXPLAIN only; no production data rows were read by these plan statements'
  };
}
function summarizeSample(rows) {
  let invalidTime=0,nonCanonicalTime=0,invalidId=0,invalidStorm=0,repeatedTimestamp=0;
  const byAgency={},timestamps=new Set();
  for(const row of rows) {
    const value=row.issued_at;
    const date=typeof value==='string'?new Date(value):new Date(NaN);
    const valid=Number.isFinite(date.valueOf());
    if(!valid) invalidTime++;
    else if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
        || date.toISOString()!==value) nonCanonicalTime++;
    if(typeof row.id!=='string'||!row.id.trim()) invalidId++;
    if(typeof row.storm_id!=='string'||!row.storm_id.trim()) invalidStorm++;
    const agency=typeof row.agency==='string' && /^(HKO|CMA|JMA|CWA)$/.test(row.agency)?row.agency:'OTHER';
    byAgency[agency]=(byAgency[agency]||0)+1;
    if(valid){if(timestamps.has(value))repeatedTimestamp++;timestamps.add(value);}
  }
  return {sampledRows:rows.length,sampleLimit:SAMPLE_LIMIT,invalidTime,nonCanonicalTime,
    invalidId,invalidStorm,repeatedTimestamp,byAgency,sampleIsNotFullTableAudit:true};
}
function fingerprint(value){return createHash('sha256').update(value).digest('hex').slice(0,16);}
async function readLimited(response,maxBytes=MAX_BODY_BYTES) {
  const length=Number(response.headers.get('content-length'));
  if(Number.isFinite(length)&&length>maxBytes) throw Error('Bounded Cloudflare API response exceeded limit');
  const reader=response.body?.getReader();
  if(!reader) throw Error('Cloudflare API response has no body');
  const buffers=[];let total=0;
  try {
    while(true) {
      const {value,done}=await reader.read();
      if(done)break;
      total+=value.length;
      if(total>maxBytes){await reader.cancel();throw Error('Bounded Cloudflare API response exceeded limit');}
      buffers.push(Buffer.from(value));
    }
  } finally {reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(buffers,total).toString('utf8'));}
  catch{throw Error('Cloudflare API returned invalid JSON');}
}
function unwrapQuery(data,key) {
  if(data?.success!==true || !Array.isArray(data.result) || data.result.length!==1)
    throw Error('D1 query failed or response schema incorrect: '+key);
  const entry=data.result[0];
  if(entry?.success!==true || !Array.isArray(entry.results)) throw Error('D1 statement failed: '+key);
  if(entry.meta?.changed_db===true || Number(entry.meta?.rows_written||0)>0 || Number(entry.meta?.changes||0)>0)
    throw Error('Unexpected D1 database write indicator: '+key);
  if(entry.results.length>512) throw Error('D1 response row limit exceeded: '+key);
  return entry.results;
}
async function captureD1Audit({accountId,databaseId,token,fetchImpl=fetch,persist=persistSummary}={}) {
  assertIdentifiers(accountId,databaseId);
  if(typeof token!=='string'||!token.trim()) throw Error('A D1 Read-only API token is required');
  if(typeof fetchImpl!=='function') throw Error('fetchImpl must be a function');
  const base=ORIGIN+'/accounts/'+accountId+'/d1/database/'+databaseId;
  let requests=0;
  async function api(path,method,body) {
    requests++;
    const response=await fetchImpl(base+path,{
      method,redirect:'error',signal:AbortSignal.timeout(TIMEOUT_MS),
      headers:{Authorization:'Bearer '+token,Accept:'application/json',
        ...(method==='POST'?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    if(!response.ok) throw Error('Cloudflare D1 API HTTP '+response.status+' at '+(method==='GET'?'metadata':'read-only query'));
    return readLimited(response);
  }
  const meta=await api('','GET');
  if(meta?.success!==true || meta.result?.uuid!==databaseId)
    throw Error('D1 metadata UUID differs from requested database; stop');
  const raw={};
  for(const item of QUERIES) {
    raw[item.key]=unwrapQuery(await api('/query','POST',{sql:item.sql,params:item.params}),item.key);
    if(item.key==='columns') {
      const cols=new Set(raw.columns.map(row=>row.name));
      if(!['id','storm_id','agency','issued_at','ingest_status'].every(c=>cols.has(c)))
        throw Error('Expected advisories columns missing; no further queries issued');
    }
  }
  const columns=raw.columns.map(row=>({name:row.name,type:row.type,notNull:row.notnull===1,primaryKey:row.pk}));
  const indexes=raw.indexList.map(row=>({name:row.name,unique:row.unique===1,origin:row.origin,partial:row.partial===1}));
  const indexDDL=raw.indexSql.map(row=>({name:row.name,sql:row.sql||null}));
  const plans={base:summarizePlan(raw.basePlan),agency:summarizePlan(raw.agencyPlan),cursor:summarizePlan(raw.cursorPlan)};
  const sample=summarizeSample(raw.sample);
  const allPlansIndexed=Object.values(plans).every(p=>p.indexSearch&&!p.tableScan&&!p.tempSort&&!p.indexScan);
  const report={
    contract:'storm-web04b-d1-readonly-audit/v1',recordedAt:new Date().toISOString(),
    accountIdSha256Prefix:fingerprint(accountId),databaseIdSha256Prefix:fingerprint(databaseId),
    databaseName:meta.result.name||null,columns,indexes,indexDDL,plans,sample,
    readiness:allPlansIndexed&&!sample.invalidTime&&!sample.nonCanonicalTime&&!sample.invalidId
      ? 'SAMPLED_PLANS_ACCEPTABLE_FULL_REVIEW_REQUIRED':'REVIEW_REQUIRED',
    constraints:['sample-not-full-dataset','EXPLAIN-does-not-execute','index-design-not-authorized',
      'deployed-worker-version-still-unverified','database-worker-binding-must-be-verified'],
    requests,methods:['GET metadata','POST fixed read-only SQL'],writesAttempted:0,
    releaseGate:'BLOCKED_NO_PRODUCTION_CHANGES'
  };
  const dir=await persist(report);
  return {...report,localEvidenceDirectory:dir};
}
async function persistSummary(report) {
  const dir=await mkdtemp(join(tmpdir(),'storm-web04b-d1-private-'));
  await writeFile(join(dir,'d1-readonly-audit.private.json'),
    JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
  return dir;
}
function parseArgs(args) {
  const out={};
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--account-id'&&args[i+1])out.accountId=args[++i];
    else if(args[i]==='--database-id'&&args[i+1])out.databaseId=args[++i];
    else throw Error('Usage: node scripts/audit-web04b-d1-readonly.mjs --account-id ID --database-id UUID');
  }
  return out;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try{
    const result=await captureD1Audit({
      ...parseArgs(process.argv.slice(2)),token:process.env.CLOUDFLARE_API_TOKEN
    });
    console.log(JSON.stringify(result,null,2));
    console.log('Read-only audit complete. Database and Worker unchanged.');
  }catch(err){console.error('WEB-04B-4 audit unavailable:',err.message);process.exitCode=1;}
}
export {captureD1Audit,parseArgs,assertIdentifiers,unwrapQuery,summarizePlan,summarizeSample,QUERIES};
