import {createHash} from 'node:crypto';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const API='https://api.cloudflare.com/client/v4';
const ACCOUNT=/^[0-9a-f]{32}$/i;
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const WORKER=/^[a-z0-9_][a-z0-9_-]{0,127}$/i;
const MAX_RESPONSE=10_000_000;
const MAX_MODULE=2_000_000;
const MAX_LOCAL=2_000_000;
const PINNED_GIT_BLOB_SHA1='8958e6c13a5ea04cf7bcbbbc261ea4689bd8c131';
const PREVIOUS_EXPORTED_MODULE_SHA256='333d9405b1c4322ec09815f1d1bb19c8746933dcc18557904dc8f8c913255c80';
function sha256(b){return createHash('sha256').update(b).digest('hex');}
function gitBlobSha1(b){return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');}
function boundedId(v,re,what){if(typeof v!=='string'||!re.test(v))throw Error('Invalid '+what);return v;}
function activeDeployment(body) {
  const first=body?.deployments?.[0];
  if(!first||!UUID.test(first.id||'')||!Array.isArray(first.versions)||
    first.versions.length!==1||first.versions[0]?.percentage!==100||
    !UUID.test(first.versions[0]?.version_id||''))
    throw Error('No stable single-version 100% active deployment');
  return {deploymentId:first.id,versionId:first.versions[0].version_id};
}
function validateOptions({accountId,workerName,versionId,deploymentId,referenceFile,token}={}){
  boundedId(accountId,ACCOUNT,'account ID');
  boundedId(workerName,WORKER,'Worker name');
  boundedId(versionId,UUID,'version ID');
  boundedId(deploymentId,UUID,'deployment ID');
  if(typeof referenceFile!=='string'||!referenceFile.trim())throw Error('Local pinned reference source required');
  if(typeof token!=='string'||!token.trim())throw Error('Read-only API token required');
}
function decodeStrictBase64(value) {
  if(typeof value!=='string'||value.length>Math.ceil(MAX_MODULE/3)*4+10||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw Error('Invalid/oversized version module encoding');
  const bytes=Buffer.from(value,'base64');
  if(bytes.length>MAX_MODULE||bytes.toString('base64')!==value)throw Error('Noncanonical version module encoding');
  return bytes;
}
function compareVersionModules(result,reference) {
  // No raw code or secret bindings are included in audit report.
  if(!result||!Array.isArray(result.modules)||result.modules.length===0)
    return {status:'VERSION_MODULES_UNAVAILABLE'};
  if(result.modules.length>32)return {status:'TOO_MANY_MODULES'};
  const main=result.main_module;
  if(typeof main!=='string'||!main) return {status:'MAIN_MODULE_UNIDENTIFIED',moduleCount:result.modules.length};
  const matches=result.modules.filter(m=>m?.name===main);
  if(matches.length!==1)return {status:'MAIN_MODULE_MISSING_OR_AMBIGUOUS',moduleCount:result.modules.length};
  const mod=matches[0];
  if(!/javascript/i.test(mod.content_type||''))return {status:'MAIN_MODULE_NOT_JAVASCRIPT',moduleCount:result.modules.length};
  let content;
  try{content=decodeStrictBase64(mod.content_base64);}
  catch{return {status:'MAIN_MODULE_ENCODING_UNSUPPORTED',moduleCount:result.modules.length};}
  const exact=content.equals(reference);
  const onlyTerminalLF=(content.length+1===reference.length&&reference[reference.length-1]===10&&
    content.equals(reference.subarray(0,-1)))||
    (reference.length+1===content.length&&content[content.length-1]===10&&
    reference.equals(content.subarray(0,-1)));
  const otherModules=result.modules.length-1;
  const status=(!exact&&!onlyTerminalLF)?'MAIN_MODULE_DIFFERENT'
    :otherModules>0?'MAIN_MATCH_EXTRA_MODULES_UNREVIEWED'
      :exact?'VERSION_MAIN_EXACT_MATCH':'VERSION_MAIN_MATCH_TRAILING_LF_ONLY';
  return {status,moduleCount:result.modules.length,otherModules,
    mainModuleSha256:sha256(content),
    referenceSha256:sha256(reference),
    relation:exact?'exact':onlyTerminalLF?'one-trailing-LF':'different'};
}
async function boundedJson(response) {
  const length=Number(response.headers.get('content-length'));
  if(Number.isFinite(length)&&length>MAX_RESPONSE)throw Error('Version metadata too large');
  const reader=response.body?.getReader();
  if(!reader)throw Error('Missing Cloudflare response body');
  let bytes=0;const chunks=[];
  try {
    while(true) {
      const {value,done}=await reader.read();if(done)break;
      bytes+=value.byteLength;
      if(bytes>MAX_RESPONSE){await reader.cancel();throw Error('Version metadata too large');}
      chunks.push(Buffer.from(value));
    }
  }finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));}
  catch{throw Error('Invalid version metadata JSON');}
}
async function auditVersionSource({
  accountId,workerName,versionId,deploymentId,referenceFile,token,
  fetchImpl=fetch,readFileImpl=readFile,persist=saveSummary,
  pinnedReferenceBlobSha1=PINNED_GIT_BLOB_SHA1
}={}) {
  validateOptions({accountId,workerName,versionId,deploymentId,referenceFile,token});
  const reference=await readFileImpl(referenceFile);
  if(!Buffer.isBuffer(reference)||reference.length>MAX_LOCAL||reference.length<1000)
    throw Error('Invalid bounded local source file');
  if(gitBlobSha1(reference)!==pinnedReferenceBlobSha1)
    throw Error('Local reference does not match audited GitHub Worker Git blob; STOP');
  const base=API+'/accounts/'+accountId+'/workers';
  const script=base+'/scripts/'+encodeURIComponent(workerName);
  const versionUrl=base+'/workers/'+encodeURIComponent(workerName)+'/versions/'+encodeURIComponent(versionId)+'?include=modules';
  let requests=0;
  async function get(url,stage){
    requests++;
    const response=await fetchImpl(url,{
      method:'GET',redirect:'error',signal:AbortSignal.timeout(20000),
      headers:{Authorization:'Bearer '+token,Accept:'application/json'}
    });
    if(!response.ok)throw Error('Worker source audit stage='+stage+' HTTP '+response.status);
    const body=await boundedJson(response);
    if(body?.success!==true||!body.result)throw Error('Worker source audit stage='+stage+' failed');
    return body.result;
  }
  const first=activeDeployment(await get(script+'/deployments?per_page=1','deployment-before'));
  if(first.deploymentId!==deploymentId||first.versionId!==versionId)
    throw Error('Active Worker deployment/version differs from audited IDs; stop');
  const version=await get(versionUrl,'version-modules');
  if(version.id!==versionId)throw Error('Version module response ID mismatch');
  if(version.number!==17)throw Error('Expected Worker Version 17 not confirmed');
  const compare=compareVersionModules(version,reference);
  const last=activeDeployment(await get(script+'/deployments?per_page=1','deployment-after'));
  if(last.versionId!==versionId||last.deploymentId!==deploymentId)
    throw Error('Worker deployment changed during source inspection; stop');
  const passed=['VERSION_MAIN_EXACT_MATCH','VERSION_MAIN_MATCH_TRAILING_LF_ONLY'].includes(compare.status);
  const report={
    contract:'storm-web04b7b-immutable-source/v1',recordedAt:new Date().toISOString(),
    workerName,accountIdSha256Prefix:sha256(Buffer.from(accountId)).slice(0,16),
    deploymentId,activeVersionId:versionId,activeVersionNumber:17,trafficPercentage:100,
    sourceEndpoint:'/workers/workers/{worker_id}/versions/{version_id}?include=modules',
    pinnedGithubBlobSha1:pinnedReferenceBlobSha1,
    previousScriptExportSha256:PREVIOUS_EXPORTED_MODULE_SHA256,
    comparison:compare,versionSourceStatus:passed?'MATCHED':'NOT_VERIFIED',
    fullWorkerArtifactStatus:passed?'SINGLE_MODULE_SOURCE_MATCHED':'NOT_VERIFIED',
    requests,methods:['GET'],writesAttempted:0,
    releaseGate:'BLOCKED_PENDING_ISOLATED_RUNTIME_AND_RELEASE_REVIEW'
  };
  return {...report,localEvidenceDirectory:await persist(report)};
}
async function saveSummary(report) {
  const dir=await mkdtemp(join(tmpdir(),'storm-web04b7b-private-'));
  await writeFile(join(dir,'version17-source-audit.private.json'),
    JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
  return dir;
}
function parseArgs(args) {
  const out={};
  for(let i=0;i<args.length;i++){
    const key=args[i];
    const opt={
      '--account-id':'accountId','--worker-name':'workerName',
      '--version-id':'versionId','--deployment-id':'deploymentId',
      '--reference-file':'referenceFile'
    }[key];
    if(!opt||!args[i+1])throw Error('Usage: --account-id HEX --worker-name storm --version-id UUID --deployment-id UUID --reference-file PATH');
    out[opt]=args[++i];
  }
  return out;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const report=await auditVersionSource({...parseArgs(process.argv.slice(2)),
      token:process.env.CLOUDFLARE_API_TOKEN});
    console.log(JSON.stringify(report,null,2));
    if(report.versionSourceStatus!=='MATCHED')process.exitCode=2;
  } catch(e) {console.error('WEB-04B-7B version source verification blocked:',e.message);process.exitCode=1;}
}
export {auditVersionSource,compareVersionModules,decodeStrictBase64,parseArgs,activeDeployment,PINNED_GIT_BLOB_SHA1};
