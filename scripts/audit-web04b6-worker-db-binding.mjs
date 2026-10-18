import {createHash} from 'node:crypto';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const API='https://api.cloudflare.com/client/v4';
const ACCOUNT=/^[a-f0-9]{32}$/i;
const DATABASE=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const SCRIPT=/^[a-z0-9_][a-z0-9_-]{0,127}$/i;
const VERSION=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const LIMIT_BYTES=256000;
function hashPrefix(value){return createHash('sha256').update(value).digest('hex').slice(0,16);}
function validateArgs({accountId,scriptName,databaseId,expectedVersionNumber}={}){
  if(!ACCOUNT.test(accountId||''))throw Error('Invalid Cloudflare account ID');
  if(!SCRIPT.test(scriptName||''))throw Error('Invalid Worker script name');
  if(!DATABASE.test(databaseId||''))throw Error('Invalid expected D1 UUID');
  if(!Number.isSafeInteger(expectedVersionNumber)||expectedVersionNumber<1)
    throw Error('Expected traffic-serving Worker version number required');
}
function getActiveVersion(payload) {
  const deployments=payload?.deployments;
  if(!Array.isArray(deployments)||!deployments.length)throw Error('No active deployment');
  const d=deployments[0];
  if(typeof d.id!=='string'||!VERSION.test(d.id)||!Array.isArray(d.versions)||
    d.versions.length!==1||d.versions[0]?.percentage!==100||
    !VERSION.test(d.versions[0].version_id||''))
    throw Error('Active deployment is not single-version 100%; manual review required');
  return {deploymentId:d.id,versionId:d.versions[0].version_id};
}
// Only inspect D1 binding named DB. Never serialize other bindings or secret metadata.
function extractDB(bindings) {
  if(bindings==null)return {status:'missing'};
  const candidates=[];
  if(Array.isArray(bindings)) {
    for(const v of bindings)if(v&&v.name==='DB')candidates.push(v);
  }else if(typeof bindings==='object') {
    if(bindings.name==='DB')candidates.push(bindings);
    if(bindings.DB&&typeof bindings.DB==='object')
      candidates.push({...bindings.DB,name:bindings.DB.name??'DB'});
    if(Array.isArray(bindings.d1))
      for(const v of bindings.d1)if(v&&v.name==='DB')candidates.push(v);
    if(Array.isArray(bindings.bindings))
      for(const v of bindings.bindings)if(v&&v.name==='DB')candidates.push(v);
  }else return {status:'unsupported'};
  if(candidates.length===0)return {status:'missing'};
  if(candidates.length!==1)return {status:'ambiguous'};
  const b=candidates[0];
  if(b.type!== 'd1')return {status:'wrong-type'};
  const id=b.database_id??b.id;
  if(typeof id!=='string'||!DATABASE.test(id))
    return {status:'missing-database-id'};
  return {status:'present',databaseId:id.toLowerCase()};
}
function compareBinding(binding,databaseId) {
  const parsed=extractDB(binding);
  return {
    sourceState:parsed.status,
    matchesExpected:parsed.status==='present'?parsed.databaseId===databaseId.toLowerCase():false
  };
}
async function readJson(res){
  const length=Number(res.headers.get('content-length'));
  if(Number.isFinite(length)&&length>LIMIT_BYTES)throw Error('Oversized Cloudflare response');
  const reader=res.body?.getReader();
  if(!reader)throw Error('Missing Cloudflare response');
  const pieces=[];let size=0;
  try {
    while(true) {
      const {value,done}=await reader.read();
      if(done)break;
      size+=value.length;
      if(size>LIMIT_BYTES){await reader.cancel();throw Error('Oversized Cloudflare response');}
      pieces.push(Buffer.from(value));
    }
  }finally{reader.releaseLock();}
  let parsed;
  try{parsed=JSON.parse(Buffer.concat(pieces,size).toString('utf8'));}
  catch{throw Error('Invalid Cloudflare JSON response');}
  return parsed;
}
async function verifyWorkerDB({
  accountId,scriptName,databaseId,expectedVersionNumber,
  token,fetchImpl=fetch,persist=saveReport
}={}){
  validateArgs({accountId,scriptName,databaseId,expectedVersionNumber});
  if(typeof token!=='string'||!token.trim())throw Error('Workers read-only API token required');
  if(typeof fetchImpl!=='function')throw Error('fetchImpl required');
  const base=API+'/accounts/'+accountId+'/workers/scripts/'+encodeURIComponent(scriptName);
  let requests=0;
  async function get(path,stage) {
    requests++;
    const res=await fetchImpl(base+path,{
      method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{Authorization:'Bearer '+token,Accept:'application/json'}
    });
    if(!res.ok)throw Error('Cloudflare Worker '+stage+' GET failed: HTTP '+res.status);
    const data=await readJson(res);
    if(data?.success!==true||!data.result)throw Error('Cloudflare Worker '+stage+' invalid result');
    return data.result;
  }
  const first=getActiveVersion(await get('/deployments?per_page=1','deployment-initial'));
  const version=await get('/versions/'+encodeURIComponent(first.versionId),'traffic-version');
  if(version.id!==first.versionId)throw Error('Version response ID mismatch');
  if(version.number!==expectedVersionNumber)
    throw Error('Traffic-serving Worker version number changed; stop and re-review');
  // Settings may reflect a newer draft version rather than the active deployment.
  const settings=await get('/settings','current-settings');
  const last=getActiveVersion(await get('/deployments?per_page=1','deployment-final'));
  if(first.deploymentId!==last.deploymentId||first.versionId!==last.versionId)
    throw Error('Deployment changed during read-only inspection');
  const deployed=compareBinding(version.resources?.bindings,databaseId);
  const current=compareBinding(settings.bindings,databaseId);
  const versionDbMatches=deployed.sourceState==='present'&&deployed.matchesExpected;
  const bindingStatus = versionDbMatches
    ? current.matchesExpected && current.sourceState==='present'
      ? 'TRAFFIC_VERSION_DB_MATCH_CURRENT_SETTINGS_MATCH'
      : 'TRAFFIC_VERSION_DB_MATCH_SETTINGS_DIFFER_OR_ABSENT'
    : deployed.sourceState==='missing' && current.matchesExpected
      ? 'CURRENT_SETTINGS_ONLY_NOT_VERSION_VERIFIED'
      : 'NOT_VERIFIED_OR_MISMATCH';
  // Never claim authoritative SOURCE match from a metadata ETag.
  const report={
    contract:'storm-web04b6-worker-db-binding/v1',
    recordedAt:new Date().toISOString(),
    scriptName,
    accountIdSha256Prefix:hashPrefix(accountId),
    requestedDatabaseSha256Prefix:hashPrefix(databaseId.toLowerCase()),
    deploymentId:first.deploymentId,
    activeVersionId:first.versionId,
    activeVersionNumber:version.number,
    trafficPercentage:100,
    scriptEtag:typeof version.resources?.script?.etag==='string'
      ?version.resources.script.etag:null,
    versionDBBinding:deployed,
    currentSettingsDBBinding:current,
    bindingStatus,
    versionSourceMatch:'NOT_VERIFIED',
    note:'Version script ETag is not necessarily SHA256 of the downloaded multipart script',
    requests,methods:['GET'],
    releaseGate:'BLOCKED_PENDING_VERSION_SOURCE_AND_CURSOR_ROLLOUT_REVIEW'
  };
  const evidenceDirectory=await persist(report);
  return {...report,localEvidenceDirectory:evidenceDirectory};
}
async function saveReport(report) {
  const dir=await mkdtemp(join(tmpdir(),'storm-web04b6-private-'));
  await writeFile(join(dir,'worker-db-binding.private.json'),
    JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
  return dir;
}
function parseArgs(argv){
  const out={};
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--account-id'&&argv[i+1])out.accountId=argv[++i];
    else if(argv[i]==='--script-name'&&argv[i+1])out.scriptName=argv[++i];
    else if(argv[i]==='--database-id'&&argv[i+1])out.databaseId=argv[++i];
    else if(argv[i]==='--expected-version-number'&&argv[i+1]){
      const value=argv[++i];if(!/^[1-9]\d*$/.test(value))throw Error('Invalid expected version number');
      out.expectedVersionNumber=Number(value);
    }else throw Error('Usage: node audit-web04b6-worker-db-binding.mjs --account-id HEX --script-name storm --database-id UUID --expected-version-number 17');
  }
  return out;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const result=await verifyWorkerDB({...parseArgs(process.argv.slice(2)),
      token:process.env.CLOUDFLARE_API_TOKEN});
    console.log(JSON.stringify(result,null,2));
    if(!result.bindingStatus.startsWith('TRAFFIC_VERSION_DB_MATCH'))process.exitCode=2;
  }catch(e){console.error('WEB-04B-6 binding verification blocked:',e.message);process.exitCode=1;}
}
export {verifyWorkerDB,extractDB,compareBinding,getActiveVersion,parseArgs,validateArgs};
