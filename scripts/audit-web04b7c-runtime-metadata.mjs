import {createHash} from 'node:crypto';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const API='https://api.cloudflare.com/client/v4';
const ACCOUNT=/^[a-f0-9]{32}$/i;
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const NAME=/^[a-z0-9_][a-z0-9_-]{0,127}$/i;
const PINNED_VERSION='320a390b-315e-494c-a135-eb242adc340d';
const PINNED_DEPLOYMENT='895652c2-06b3-4cd9-afbb-d886cac7f0fe';
const PINNED_ETAG='2db199a2281e6209518941a5a36f5cd91392dc4022db284db60efde136129b54';
const MAX_RESPONSE=400000;
function hash(value){return createHash('sha256').update(value).digest('hex').slice(0,16);}
function valid({accountId,scriptName,databaseId,expectedR2Bucket,token}={}){
  if(!ACCOUNT.test(accountId||''))throw Error('Invalid account ID');
  if(!NAME.test(scriptName||''))throw Error('Invalid Worker script name');
  if(!UUID.test(databaseId||''))throw Error('Invalid previously audited D1 UUID');
  if(expectedR2Bucket!=null && (typeof expectedR2Bucket!=='string' ||
      !/^[A-Za-z0-9_.-]{3,200}$/.test(expectedR2Bucket)))
    throw Error('Invalid expected R2 bucket name');
  if(typeof token!=='string'||!token.trim())throw Error('Workers read-only token required');
}
function active(payload) {
  const d=payload?.deployments?.[0];
  if(!d||d.id!==PINNED_DEPLOYMENT||!Array.isArray(d.versions)||
      d.versions.length!==1||d.versions[0].version_id!==PINNED_VERSION||
      d.versions[0].percentage!==100)
    throw Error('Active Worker deployment/version changed; stop and re-review');
  return {deploymentId:d.id,versionId:d.versions[0].version_id};
}
// Extract ONLY known binding names. Never serialize other bindings or secret values.
function bindingFrom(bindings,name){
  if(bindings==null)return {state:'absent'};
  let candidates=[];
  if(Array.isArray(bindings))candidates=bindings.filter(v=>v&&v.name===name);
  else if(typeof bindings==='object'){
    if(bindings[name]&&typeof bindings[name]==='object')
      candidates.push({...bindings[name],name});
    for(const group of ['bindings','d1','r2','vars']){
      if(Array.isArray(bindings[group]))
        candidates.push(...bindings[group].filter(v=>v&&v.name===name));
    }
  }else return {state:'unsupported'};
  if(candidates.length===0)return {state:'absent'};
  if(candidates.length!==1)return {state:'ambiguous'};
  return {state:'present',value:candidates[0]};
}
function summarizeBindings(bindings,databaseId,expectedR2Bucket){
  const db=bindingFrom(bindings,'DB');
  const r2=bindingFrom(bindings,'RAW_BUCKET');
  const secretNames=['ADMIN_TOKEN','CWA_AUTHORIZATION'];
  const dbValue=db.value;
  const dbId=dbValue?.database_id??dbValue?.id;
  const d1={state:db.state,
    typeCorrect:db.state==='present'&&dbValue?.type==='d1',
    matchesExpected:db.state==='present'&&dbValue?.type==='d1'
      &&typeof dbId==='string'&&dbId.toLowerCase()===databaseId.toLowerCase()};
  const r2Value=r2.value;
  const bucketName=r2Value?.bucket_name??r2Value?.bucketName;
  const correctR2=r2.state==='present'&&r2Value?.type==='r2_bucket'
    &&typeof bucketName==='string'&&bucketName.length>0;
  const r2Result={state:r2.state,typeCorrect:correctR2,
    bucketSha256Prefix:correctR2?hash(bucketName):null,
    identityCheck:!correctR2?'NOT_VERIFIED':expectedR2Bucket==null
      ?'NAME_NOT_SUPPLIED':'EXPECTED_NAME_'+(bucketName===expectedR2Bucket?'MATCH':'MISMATCH')};
  const secrets=Object.fromEntries(secretNames.map(name=>{
    const b=bindingFrom(bindings,name);
    return [name,{present:b.state==='present',
      type:b.state==='present'&&b.value?.type==='secret_text'?'secret_text':
        b.state==='present'?'other-or-unknown':'absent'}];
  }));
  return {DB:d1,RAW_BUCKET:r2Result,secrets};
}
function normalizedDate(v) {
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/.test(v))return null;
  const ms=Date.parse(v);
  return Number.isFinite(ms)?v.slice(0,10):null;
}
function safeFlags(value) {
  // Cloudflare declares version script_runtime.compatibility_flags optional.
  // Missing is not the same as malformed or explicitly configured empty [].
  if(value===undefined||value===null)return {state:'NOT_RETURNED',values:[]};
  if(!Array.isArray(value)||value.length>40
    ||value.some(s=>typeof s!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(s)))
    return {state:'MALFORMED',values:[]};
  return {state:'PRESENT',values:[...new Set(value)].sort()};
}
function scheduleInfo(v) {
  if(!Array.isArray(v?.schedules)||v.schedules.length>16)throw Error('Unexpected schedules schema');
  const crons=v.schedules.map(x=>x?.cron);
  if(crons.some(x=>typeof x!=='string'||!/^[A-Za-z0-9*/?,#LW -]{1,128}$/.test(x)))
    throw Error('Unrecognized cron format');
  return {count:crons.length,crons:[...new Set(crons)].sort(),
    fifteenMinuteCadenceObserved:crons.includes('*/15 * * * *')};
}
async function parseBoundedJson(response){
  const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>MAX_RESPONSE)throw Error('Oversized Cloudflare response');
  const reader=response.body?.getReader();
  if(!reader)throw Error('Missing Cloudflare response');
  let length=0;const parts=[];
  try {
    while(true) {
      const {value,done}=await reader.read();if(done)break;
      length+=value.byteLength;
      if(length>MAX_RESPONSE){await reader.cancel();throw Error('Oversized Cloudflare response');}
      parts.push(Buffer.from(value));
    }
  }finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(parts,length).toString('utf8'));}
  catch{throw Error('Unexpected Cloudflare JSON response');}
}
async function auditRuntime({
  accountId,scriptName='storm',databaseId,expectedR2Bucket=null,
  token,fetchImpl=fetch,persist=saveSummary
}={}) {
  valid({accountId,scriptName,databaseId,expectedR2Bucket,token});
  const prefix=API+'/accounts/'+accountId+'/workers/scripts/'+encodeURIComponent(scriptName);
  let requests=0;
  async function get(path,stage){
    requests++;
    const res=await fetchImpl(prefix+path,{
      method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{Accept:'application/json',Authorization:'Bearer '+token}
    });
    if(!res.ok)throw Error('Cloudflare read-only metadata stage='+stage+' HTTP '+res.status);
    const data=await parseBoundedJson(res);
    if(data?.success!==true||!data.result)throw Error('Cloudflare metadata stage='+stage+' invalid response');
    return data.result;
  }
  const before=active(await get('/deployments?per_page=1','deploy-before'));
  const version=await get('/versions/'+encodeURIComponent(before.versionId),'immutable-version');
  if(version.id!==PINNED_VERSION||version.number!==17)throw Error('Unexpected Worker Version ID/number');
  if(version.resources?.script?.etag!==PINNED_ETAG)
    throw Error('Version script ETag changed from owner-audited version; stop');
  const versionBindings=summarizeBindings(version.resources?.bindings,databaseId,expectedR2Bucket);
  const runtime=version.resources?.script_runtime;
  const versionRuntime={
    compatibilityDate:normalizedDate(runtime?.compatibility_date),
    compatibilityFlags:safeFlags(runtime?.compatibility_flags),
    handlers:Array.isArray(version.resources?.script?.handlers)
      ?version.resources.script.handlers.filter(x=>x==='fetch'||x==='scheduled'||x==='queue'||x==='alarm').sort():[]
  };
  const settings=await get('/settings','latest-settings');
  const settingsBindings=summarizeBindings(settings.bindings,databaseId,expectedR2Bucket);
  const currentSettings={
    compatibilityDate:normalizedDate(settings.compatibility_date),
    compatibilityFlags:safeFlags(settings.compatibility_flags)
  };
  const scripts=await get('/script-settings','script-level-settings');
  const scriptSettings={logpush:typeof scripts.logpush==='boolean'?scripts.logpush:null,
    observabilityEnabled:typeof scripts.observability?.enabled==='boolean'
      ?scripts.observability.enabled:null,
    tailConsumerCount:Array.isArray(scripts.tail_consumers)?scripts.tail_consumers.length:null};
  const cron=scheduleInfo(await get('/schedules','cron'));
  const subdomain=await get('/subdomain','workers-dev');
  if(typeof subdomain.enabled!=='boolean'||typeof subdomain.previews_enabled!=='boolean')
    throw Error('Unexpected workers.dev response');
  const after=active(await get('/deployments?per_page=1','deploy-after'));
  if(before.versionId!==after.versionId||before.deploymentId!==after.deploymentId)
    throw Error('Deployment drift during audit');
  const versionRuntimeReady=Boolean(versionRuntime.compatibilityDate)
    &&versionRuntime.compatibilityFlags.state==='PRESENT';
  const coreMatches=versionBindings.DB.matchesExpected;
  const r2Ready=versionBindings.RAW_BUCKET.typeCorrect
    &&versionBindings.RAW_BUCKET.identityCheck==='EXPECTED_NAME_MATCH';
  const report={
    contract:'storm-web04b7c-runtime-metadata/v1',recordedAt:new Date().toISOString(),
    accountIdSha256Prefix:hash(accountId),
    requestedD1Sha256Prefix:hash(databaseId.toLowerCase()),
    scriptName,deploymentId:before.deploymentId,versionId:before.versionId,
    versionNumber:17,trafficPercentage:100,
    versionSourceMatch:'PREVIOUS_OWNER_VERSION_17_REPORT_MATCHED',
    versionBindings,versionRuntime,
    latestSettingsBindings:settingsBindings,currentSettings,scriptSettings,
    cron,subdomain:{enabled:subdomain.enabled,previewsEnabled:subdomain.previews_enabled},
    routes:{status:'NOT_CHECKED_REQUIRES_ZONE_ID_AND_WORKERS_ROUTES_READ'},
    readiness:{
      versionRuntimeMetadata:versionRuntimeReady?'REPORTED':'INCOMPLETE',
      versionD1Binding:coreMatches?'MATCHED':'BLOCKED',
      versionR2Bucket:r2Ready?'MATCHED':'MANUAL_REVIEW_REQUIRED',
      cron:'REPORTED_NOT_AUTHORITATIVELY_MATCHED_TO_EXPECTED',
      routes:'NOT_VERIFIED',
      stagingDeployment:'NOT_PERFORMED'
    },
    requests,methods:['GET'],writesAttempted:0,
    releaseGate:'BLOCKED_PENDING_STAGING_ISOLATION_AND_ROLLBACK_APPROVAL'
  };
  const directory=await persist(report);
  return {...report,localEvidenceDirectory:directory};
}
async function saveSummary(report){
  const dir=await mkdtemp(join(tmpdir(),'storm-web04b7c-private-'));
  await writeFile(join(dir,'version17-runtime-metadata.private.json'),
    JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
  return dir;
}
function parseArgs(argv) {
  const output={};
  const allowed={
    '--account-id':'accountId','--script-name':'scriptName',
    '--database-id':'databaseId','--expected-r2-bucket':'expectedR2Bucket'
  };
  for(let i=0;i<argv.length;i++){
    if(!allowed[argv[i]]||!argv[i+1])throw Error(
      'Usage: --account-id HEX --script-name storm --database-id UUID [--expected-r2-bucket NAME]');
    output[allowed[argv[i]]]=argv[++i];
  }
  return output;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const result=await auditRuntime({...parseArgs(process.argv.slice(2)),
      token:process.env.CLOUDFLARE_API_TOKEN});
    console.log(JSON.stringify(result,null,2));
    if(result.readiness.versionD1Binding!=='MATCHED'
      ||result.readiness.versionRuntimeMetadata!=='REPORTED'
      ||result.readiness.versionR2Bucket!=='MATCHED')process.exitCode=2;
  }catch(e){console.error('WEB-04B-7C read-only runtime audit blocked:',e.message);process.exitCode=1;}
}
export {auditRuntime,valid,active,bindingFrom,summarizeBindings,normalizedDate,safeFlags,scheduleInfo,parseArgs};
