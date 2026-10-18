import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  auditVersionSource, compareVersionModules, decodeStrictBase64,
  parseArgs,activeDeployment,PINNED_GIT_BLOB_SHA1
} from '../scripts/audit-web04b7b-version-source.mjs';

const ACCOUNT='0123456789abcdef0123456789abcdef';
const VERSION='320a390b-315e-494c-a135-eb242adc340d';
const DEPLOYMENT='895652c2-06b3-4cd9-afbb-d886cac7f0fe';
const WORKER='storm';
const TOKEN='FAKE-TOKEN-NEVER-EXPOSE';
const BASE=Buffer.from('export default {fetch(){return new Response("hello");}}\n'.repeat(60));
const GIT_SHA=createHash('sha1').update('blob '+BASE.length+'\0').update(BASE).digest('hex');
const mod=(data,name='worker.js')=>({
  content_type:'application/javascript+module',name,
  content_base64:Buffer.from(data).toString('base64')
});
function version(modules=[mod(BASE)],extra={}) {
  return {id:VERSION,number:17,main_module:'worker.js',modules,...extra};
}
function response(body,status=200) {
  return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
}
function makeFetch({modes=[],versionResult=version(),failStep=0,changed=false}={}){
  const calls=[];
  return {calls,fetchImpl:async(url,options)=>{
    calls.push({url,options});
    assert.equal(options.method,'GET');
    assert.equal(options.headers.Authorization,'Bearer '+TOKEN);
    assert.equal(options.redirect,'error');
    const n=calls.length;
    if(failStep===n)return response({success:false,errors:[{code:400,message:'should not log'}]},403);
    if(url.includes('/deployments?per_page=1')) {
      const dep={id:n===3&&changed?'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa':DEPLOYMENT,
        versions:[{version_id:VERSION,percentage:100}]};
      return response({success:true,result:{deployments:[dep]}});
    }
    assert.equal(n,2);
    assert.ok(url.includes('/workers/workers/storm/versions/'+VERSION+'?include=modules'));
    return response({success:true,result:versionResult});
  }};
}
const options={accountId:ACCOUNT,workerName:WORKER,versionId:VERSION,
  deploymentId:DEPLOYMENT,referenceFile:'C:/temp/pinned-worker.js',
  token:TOKEN,readFileImpl:async()=>BASE,pinnedReferenceBlobSha1:GIT_SHA,
  persist:async()=>'/temp/synthetic-audit'};
test('immutable version module exactly matches pinned reference without source leakage',async()=>{
  const {fetchImpl,calls}=makeFetch();
  const report=await auditVersionSource({...options,fetchImpl});
  assert.equal(report.requests,3);
  assert.equal(calls.length,3);
  assert.equal(report.comparison.status,'VERSION_MAIN_EXACT_MATCH');
  assert.equal(report.versionSourceStatus,'MATCHED');
  assert.equal(report.fullWorkerArtifactStatus,'SINGLE_MODULE_SOURCE_MATCHED');
  assert.equal(JSON.stringify(report).includes(TOKEN),false);
  assert.equal(JSON.stringify(report).includes(ACCOUNT),false);
  assert.equal(report.writesAttempted,0);
});
test('trailing-LF-only is tracked distinctly, not claimed byte-identical',async()=>{
  const x=compareVersionModules(version([mod(BASE.subarray(0,-1))]),BASE);
  assert.equal(x.status,'VERSION_MAIN_MATCH_TRAILING_LF_ONLY');
  assert.equal(x.relation,'one-trailing-LF');
});
test('additional runtime modules cannot establish full artifact match',async()=>{
  const {fetchImpl}=makeFetch({versionResult:version([
    mod(BASE),mod('import nothing from "other";','extra.js')
  ])});
  const report=await auditVersionSource({...options,fetchImpl});
  assert.equal(report.versionSourceStatus,'NOT_VERIFIED');
  assert.equal(report.comparison.status,'MAIN_MATCH_EXTRA_MODULES_UNREVIEWED');
});
test('missing or malformed modules return NOT_VERIFIED, without guessing ETag',()=>{
  assert.equal(compareVersionModules(version([]),BASE).status,'VERSION_MODULES_UNAVAILABLE');
  assert.equal(compareVersionModules({...version(),main_module:null},BASE).status,'MAIN_MODULE_UNIDENTIFIED');
  assert.equal(compareVersionModules(version([{...mod(BASE),content_base64:'!' }]),BASE).status,
    'MAIN_MODULE_ENCODING_UNSUPPORTED');
  assert.equal(compareVersionModules(version([mod(BASE),mod(BASE)]),BASE).status,
    'MAIN_MODULE_MISSING_OR_AMBIGUOUS');
  assert.equal(compareVersionModules(version([mod(BASE.subarray(1))]),BASE).status,
    'MAIN_MODULE_DIFFERENT');
  assert.throws(()=>decodeStrictBase64('A'),/Invalid/);
});
test('wrong pinned local baseline hard-fails before any GET',async()=>{
  const {fetchImpl,calls}=makeFetch();
  await assert.rejects(()=>auditVersionSource({...options,
    pinnedReferenceBlobSha1:PINNED_GIT_BLOB_SHA1,fetchImpl}),/does not match audited/);
  assert.equal(calls.length,0);
});
test('version / deployment mismatch or drift fails with no successful report',async()=>{
  const before=makeFetch(),drift=makeFetch({changed:true});
  await assert.rejects(()=>auditVersionSource({...options,
    deploymentId:'11111111-1111-4111-8111-111111111111',
    fetchImpl:before.fetchImpl}),/differs/);
  assert.equal(before.calls.length,1);
  await assert.rejects(()=>auditVersionSource({...options,fetchImpl:drift.fetchImpl}),/changed during/);
  assert.equal(drift.calls.length,3);
});
test('Cloudflare 403 and wrong version number fail closed',async()=>{
  const a=makeFetch({failStep:2});
  await assert.rejects(()=>auditVersionSource({...options,fetchImpl:a.fetchImpl}),/HTTP 403/);
  const b=makeFetch({versionResult:version([mod(BASE)],{number:18})});
  await assert.rejects(()=>auditVersionSource({...options,fetchImpl:b.fetchImpl}),/Version 17/);
});
test('no mutating methods and parse arguments are strictly constrained',()=>{
  const parsed=parseArgs(['--account-id',ACCOUNT,'--worker-name','storm',
    '--version-id',VERSION,'--deployment-id',DEPLOYMENT,'--reference-file','src.js']);
  assert.equal(parsed.workerName,'storm');
  assert.throws(()=>parseArgs(['--deployment-id']),/Usage/);
  assert.throws(()=>activeDeployment({deployments:[{id:DEPLOYMENT,versions:[
    {version_id:VERSION,percentage:50}]}]}),/single-version/);
});
