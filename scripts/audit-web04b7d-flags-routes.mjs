import {createHash} from 'node:crypto';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const BASE='https://api.cloudflare.com/client/v4';
const ACCOUNT=/^[0-9a-f]{32}$/i;
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const WORKER=/^[a-z0-9_][a-z0-9_-]{0,127}$/i;
const ACTIVE_VERSION='320a390b-315e-494c-a135-eb242adc340d';
const ACTIVE_DEPLOYMENT='895652c2-06b3-4cd9-afbb-d886cac7f0fe';
const EXPECTED_DATE='2026-08-05';
const MAX_BODY=600000;
function prefix(x){return createHash('sha256').update(x).digest('hex').slice(0,16);}
function parseFlags(value){
  if(value==null)return {state:'NOT_RETURNED',values:[]};
  if(!Array.isArray(value)||value.length>40||
     value.some(v=>typeof v!=='string'||!/^[a-z0-9_-]{1,100}$/i.test(v)))
    return {state:'MALFORMED',values:[]};
  return {state:'PRESENT',values:[...new Set(value)].sort()};
}
function isoDay(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/.test(value))
    return null;
  const d=new Date(value);
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value.slice(0,10)
    ?value.slice(0,10):null;
}
function active(result){
  const deployments=result?.deployments;
  if(!Array.isArray(deployments)||deployments.length===0)throw Error('No live deployment');
  const d=deployments[0];
  if(d?.id!==ACTIVE_DEPLOYMENT||!Array.isArray(d.versions)||
     d.versions.length!==1||d.versions[0]?.version_id!==ACTIVE_VERSION||
     d.versions[0]?.percentage!==100)
    throw Error('Production deployment/version changed or is split; stop');
  return {deploymentId:d.id,versionId:d.versions[0].version_id};
}
function compareFlagEvidence(scriptVersion,betaVersion){
  if(scriptVersion?.id!==ACTIVE_VERSION||scriptVersion?.number!==17||
     betaVersion?.id!==ACTIVE_VERSION||betaVersion?.number!==17)
    throw Error('Immutable version identity/number mismatch');
  const first=parseFlags(scriptVersion.resources?.script_runtime?.compatibility_flags);
  const second=parseFlags(betaVersion.compatibility_flags);
  const firstDate=isoDay(scriptVersion.resources?.script_runtime?.compatibility_date);
  const betaDate=isoDay(betaVersion.compatibility_date);
  const dateMismatch=(firstDate!=null&&firstDate!==EXPECTED_DATE)
    ||(betaDate!=null&&betaDate!==EXPECTED_DATE);
  if(dateMismatch)throw Error('Version compatibility date mismatch');
  const both=first.state==='PRESENT'&&second.state==='PRESENT';
  const inconsistent=both&&JSON.stringify(first.values)!==JSON.stringify(second.values);
  const explicit=first.state==='PRESENT'?first:second.state==='PRESENT'?second:null;
  let status='NOT_VERIFIED';
  if(inconsistent)status='CONFLICTING_VERSION_FIELDS';
  else if(first.state==='MALFORMED'||second.state==='MALFORMED')status='MALFORMED_VERSION_FIELDS';
  else if(explicit)status=(firstDate===EXPECTED_DATE || betaDate===EXPECTED_DATE)
    ? 'VERSION_EXPLICIT_FLAGS_REPORTED' : 'VERSION_FLAGS_DATE_NOT_VERIFIED';
  return {
    status,scriptVersion: first, immutableBetaVersion:second,
    scriptVersionDate:firstDate,betaVersionDate:betaDate,
    dateStatus:firstDate===EXPECTED_DATE&&betaDate===EXPECTED_DATE?'MATCHED_BOTH'
      :firstDate===EXPECTED_DATE||betaDate===EXPECTED_DATE?'MATCHED_ONE_SOURCE':'NOT_VERIFIED',
    effectiveFlags:status==='VERSION_EXPLICIT_FLAGS_REPORTED'?explicit.values:null,
    note:'A missing optional flags field is NOT proof of an explicit empty array.'
  };
}
function summarizeRoutes(zoneId,body,scriptName){
  if(!body||!Array.isArray(body.result)||body.result.length>500)
    throw Error('Invalid or oversized zone routes response');
  const routes=body.result;
  const seen=new Set();
  const matched=[];
  for(const route of routes){
    if(!route||typeof route.pattern!=='string'||route.pattern.length>2048||
       typeof route.id!=='string'||seen.has(route.id)||
       (route.script!=null&&typeof route.script!=='string'))
      throw Error('Invalid or duplicate Worker route metadata');
    seen.add(route.id);
    if(route.script===scriptName){
      matched.push({patternSha256Prefix:prefix(route.pattern)});
    }
  }
  const meta=body.result_info;
  let completeness='NOT_CONFIRMED_NO_PAGINATION_METADATA';
  if(meta!=null){
    const total=Number(meta.total_count??routes.length);
    if(!Number.isSafeInteger(total)||total!==routes.length)
      throw Error('Truncated or paginated Worker route list; manual review');
    completeness='TOTAL_COUNT_CONFIRMED';
  }
  if(routes.length===500)completeness='NOT_CONFIRMED_RESULT_SIZE_AT_GUARD';
  return {
    zoneIdSha256Prefix:prefix(zoneId),routesCount:routes.length,
    completeness,
    matchedScriptRouteCount:matched.length,
    matchedRoutePatterns:matched.slice(0,16),
    matchLimitExceeded:matched.length>16,
    scope:'ZONE_ROUTES_ONLY_NOT_CUSTOM_DOMAINS_OR_OTHER_ZONES'
  };
}
async function boundedJSON(response){
  const size=Number(response.headers.get('content-length'));
  if(Number.isFinite(size)&&size>MAX_BODY)throw Error('Cloudflare response too large');
  const reader=response.body?.getReader();
  if(!reader)throw Error('No Cloudflare response body');
  const parts=[];let bytes=0;
  try {
    while(true){
      const {value,done}=await reader.read();if(done)break;
      bytes+=value.byteLength;
      if(bytes>MAX_BODY){await reader.cancel();throw Error('Cloudflare response too large');}
      parts.push(Buffer.from(value));
    }
  }finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(parts,bytes).toString('utf8'));}
  catch{throw Error('Cloudflare did not return valid JSON');}
}
async function inspect7D({accountId,scriptName='storm',zoneIds=[],
  workersToken,routesToken,fetchImpl=fetch,persist=saveSummary}={}){
  if(!ACCOUNT.test(accountId||''))throw Error('Invalid account ID');
  if(!WORKER.test(scriptName||''))throw Error('Invalid Worker name');
  if(!Array.isArray(zoneIds)||zoneIds.length>4||
     zoneIds.some(z=>typeof z!=='string'||!ACCOUNT.test(z))||
     new Set(zoneIds).size!==zoneIds.length)throw Error('Invalid Zone ID list');
  if(typeof workersToken!=='string'||!workersToken.trim())
    throw Error('Workers read-only token required');
  if(zoneIds.length&&(!routesToken||typeof routesToken!=='string'||!routesToken.trim()))
    throw Error('Zone Workers Routes Read token required for zone checks');
  const script=BASE+'/accounts/'+accountId+'/workers/scripts/'+encodeURIComponent(scriptName);
  let requests=0;
  async function get(url,stage,token){
    requests++;
    const res=await fetchImpl(url,{
      method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{Accept:'application/json',Authorization:'Bearer '+token}
    });
    if(!res.ok)throw Error('Cloudflare read-only stage='+stage+' HTTP '+res.status);
    const body=await boundedJSON(res);
    if(body?.success!==true)throw Error('Cloudflare read-only stage='+stage+' API failure');
    return body;
  }
  active((await get(script+'/deployments?per_page=1','deployment-before',workersToken)).result);
  const scriptVersion=(await get(script+'/versions/'+ACTIVE_VERSION,'script-version',workersToken)).result;
  const betaVersion=(await get(BASE+'/accounts/'+accountId+'/workers/workers/'+
    encodeURIComponent(scriptName)+'/versions/'+ACTIVE_VERSION,'immutable-version',workersToken)).result;
  const flags=compareFlagEvidence(scriptVersion,betaVersion);
  const routes=[];
  for(const zone of zoneIds){
    const r=await get(BASE+'/zones/'+zone+'/workers/routes','zone-routes',routesToken);
    routes.push(summarizeRoutes(zone,r,scriptName));
  }
  active((await get(script+'/deployments?per_page=1','deployment-after',workersToken)).result);
  const report={
    contract:'storm-web04b7d-flag-routes-readonly/v1',
    recordedAt:new Date().toISOString(),
    scriptName,accountIdSha256Prefix:prefix(accountId),
    deploymentVersion:'17',trafficPercentage:100,
    deploymentId:ACTIVE_DEPLOYMENT,versionId:ACTIVE_VERSION,
    flags,
    zonesChecked:zoneIds.length,zoneRoutes:routes,
    routesStatus:zoneIds.length
      ?routes.every(r=>r.completeness==='TOTAL_COUNT_CONFIRMED')
        ?'CHECKED_SUPPLIED_ZONES_WITH_TOTALS':'CHECKED_SUPPLIED_ZONES_COMPLETENESS_UNVERIFIED'
      :'NOT_CHECKED_NO_ZONE_IDS',
    customDomainsStatus:'NOT_CHECKED_REQUIRES_SEPARATE_REVIEW',
    allZoneCoverageStatus:'NOT_VERIFIED_ONLY_OWNER_SUPPLIED_ZONES',
    stagingStatus:'NOT_DEPLOYED',
    requests,methods:['GET'],writesAttempted:0,
    releaseGate:'BLOCKED_PENDING_ISOLATED_STAGING_AND_ROLLBACK_REHEARSAL'
  };
  return {...report,localEvidenceDirectory:await persist(report)};
}
async function saveSummary(report){
  const folder=await mkdtemp(join(tmpdir(),'storm-web04b7d-private-'));
  await writeFile(join(folder,'version17-flags-routes.private.json'),JSON.stringify(report,null,2)+'\n',
    {mode:0o600,flag:'wx'});
  return folder;
}
function parseArgs(args){
  const out={zoneIds:[]};
  for(let i=0;i<args.length;i++){
    const option=args[i],value=args[i+1];
    if(!value)throw Error('Usage: --account-id HEX [--script-name storm] [--zone-id HEX ...]');
    if(option==='--account-id')out.accountId=value;
    else if(option==='--script-name')out.scriptName=value;
    else if(option==='--zone-id')out.zoneIds.push(value);
    else throw Error('Only account, Worker and Zone IDs are accepted: read-only');
    i++;
  }
  return out;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const report=await inspect7D({...parseArgs(process.argv.slice(2)),
      workersToken:process.env.CLOUDFLARE_WORKERS_READ_TOKEN,
      routesToken:process.env.CLOUDFLARE_ROUTES_READ_TOKEN});
    console.log(JSON.stringify(report,null,2));
    if(report.flags.status!=='VERSION_EXPLICIT_FLAGS_REPORTED')process.exitCode=2;
  }catch(e){console.error('WEB-04B-7D read-only verification blocked:',e.message);process.exitCode=1;}
}
export {inspect7D,parseArgs,compareFlagEvidence,parseFlags,summarizeRoutes,active,isoDay};
