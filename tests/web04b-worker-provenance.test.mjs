import test from 'node:test';
import assert from 'node:assert/strict';
import { collectProvenance, parseArgs, activeVersions, validateTarget } from '../scripts/audit-web04b-worker-provenance.mjs';

const ACCOUNT = '0123456789abcdef0123456789abcdef';
const SCRIPT = 'storm-production-real-name';
const VERSION = '023e105f-2a42-4f8b-a1c1-73f6a2a30c0f';
const TOKEN = 'TEST-READ-ONLY-TOKEN-DO-NOT-PRINT';
const DEPLOYMENT = {
  id: '182bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e',
  created_on: '2026-10-17T00:00:00Z',
  versions: [{version_id:VERSION,percentage:100}]
};
function jsonResult(result) {
  return new Response(JSON.stringify({success:true,result}),{
    status:200,headers:{'content-type':'application/json'}
  });
}
function fakeFetch({changeDeployment = false, bytes = 'export default {fetch(){}}',
  bindingSecret = 'NEVER_PRINT_THIS'} = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({url,method:opts.method,auth:opts.headers.Authorization});
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'error');
    assert.equal(opts.headers.Authorization,'Bearer '+TOKEN);
    if(url.endsWith('/deployments?per_page=1')) {
      return jsonResult({deployments:[
        (changeDeployment && calls.filter(c=>c.url.endsWith('/deployments?per_page=1')).length===2)
          ? {...DEPLOYMENT,id:'changed-id'} : DEPLOYMENT
      ]});
    }
    if(url.endsWith('/versions/'+VERSION))return jsonResult({
      id:VERSION,number:7,resources:{
        script:{etag:'cf-script-etag'},
        bindings:{PRIVATE_VALUE:bindingSecret}
      }
    });
    if(url.endsWith('/content/v2'))return new Response(bytes,{
      status:200,headers:{'content-type':'application/javascript'}
    });
    assert.fail('Unexpected endpoint');
  };
  return {calls,fetchImpl};
}
test('strict explicit target and CLI arguments required',()=>{
  validateTarget(ACCOUNT,SCRIPT);
  assert.throws(()=>validateTarget('not-an-account',SCRIPT),/account/);
  assert.throws(()=>validateTarget(ACCOUNT,'../unsafe'),/script name/);
  assert.deepEqual(parseArgs(['--account-id',ACCOUNT,'--script-name',SCRIPT]),{
    accountId:ACCOUNT,scriptName:SCRIPT
  });
  assert.throws(()=>parseArgs(['--push-to-production']),/Usage/);
});
test('captures verified stable deployment metadata and opaque content hash with GET only',async()=>{
  const {calls,fetchImpl}=fakeFetch();
  let stored;
  const result=await collectProvenance({
    accountId:ACCOUNT,scriptName:SCRIPT,token:TOKEN,fetchImpl,
    persist:async(bytes,meta)=>{
      stored={bytes,meta};
      return '/outside-git/private';
    }
  });
  assert.equal(result.requests,4);
  assert.equal(calls.length,4);
  assert.equal(result.deploymentId,DEPLOYMENT.id);
  assert.equal(result.versions[0].versionId,VERSION);
  assert.equal(result.versions[0].scriptEtag,'cf-script-etag');
  assert.equal(result.capturedScriptContent.bytes,stored.bytes.byteLength);
  assert.equal(result.localEvidenceDirectory,'/outside-git/private');
  assert.equal(result.deployedVersionSourceMatch,'NOT_VERIFIED');
  assert.equal(result.releaseGate,'BLOCKED_UNTIL_SOURCE_VERSION_MATCH_CONFIRMED');
  assert.equal(stored.meta.localEvidenceDirectory,undefined);
  assert.equal(JSON.stringify(result).includes(TOKEN),false);
  assert.equal(JSON.stringify(result).includes('NEVER_PRINT_THIS'),false);
  assert.equal(calls.every(x=>x.method==='GET'),true);
});
test('changed deployment between first and last read rejects evidence',async()=>{
  const {fetchImpl}=fakeFetch({changeDeployment:true});
  let writes=0;
  await assert.rejects(()=>collectProvenance({
    accountId:ACCOUNT,scriptName:SCRIPT,token:TOKEN,fetchImpl,
    persist:async()=>{writes++;return '/tmp/should-not-exist';}
  }),/Deployment changed/);
  assert.equal(writes,0);
});
test('invalid traffic splits fail closed',()=>{
  assert.throws(()=>activeVersions({id:'dep',versions:[{version_id:VERSION,percentage:60}]}),/percentage/);
  assert.throws(()=>activeVersions({id:'dep',versions:[{version_id:'bad',percentage:100}]}),/invalid/);
});
test('token and unsuccessful APIs fail closed without writing files',async()=>{
  const {fetchImpl}=fakeFetch();
  await assert.rejects(()=>collectProvenance({
    accountId:ACCOUNT,scriptName:SCRIPT,token:'',fetchImpl
  }),/token required/);
  await assert.rejects(()=>collectProvenance({
    accountId:ACCOUNT,scriptName:SCRIPT,token:TOKEN,
    fetchImpl:async()=>new Response('forbidden',{status:403})
  }),/HTTP 403/);
});
test('oversized source is rejected before storage',async()=>{
  const {fetchImpl}=fakeFetch({bytes:'x'.repeat(25_000_001)});
  let persisted=false;
  await assert.rejects(()=>collectProvenance({
    accountId:ACCOUNT,scriptName:SCRIPT,token:TOKEN,fetchImpl,
    persist:async()=>{persisted=true;}
  }),/bounded size/);
  assert.equal(persisted,false);
});
