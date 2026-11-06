import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyWorkerDB,extractDB,compareBinding,getActiveVersion,parseArgs
} from '../scripts/audit-web04b6-worker-db-binding.mjs';

const ACCOUNT='0123456789abcdef0123456789abcdef';
const DB='12345678-1234-4123-a456-123456789abc';
const OTHER='87654321-4321-4123-a456-abcdef123456';
const TOKEN='SECRET-CF-WORKERS-READ-ONLY-TEST';
const DEPLOYMENT='1082f282-d147-4d9a-a73c-7fa4393b04a4';
const VERSION='84d20190-817f-41e1-9580-d6cad4833dfc';
const dep={id:DEPLOYMENT,versions:[{version_id:VERSION,percentage:100}]};
function result(data, status=200) {
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
}
function fake({versionDb=DB,settingsDb=DB,missingVersion=false,
  drift=false,wrongVersion=false,emptySettings=false,httpCode=null}={}) {
  const calls=[];
  const fetchImpl=async(url,opts)=>{
    calls.push({url,method:opts.method});
    assert.equal(opts.headers.Authorization,'Bearer '+TOKEN);
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'error');
    const req=calls.length;
    if(httpCode&&req===2)return result({success:false,errors:[{message:'not allowed'}]},httpCode);
    if(url.endsWith('/deployments?per_page=1')) {
      const isEnd=calls.filter(x=>x.url.endsWith('/deployments?per_page=1')).length===2;
      return result({success:true,result:{deployments:[
        isEnd&&drift?{...dep,id:'cf765cea-f3e8-4c1e-abcb-c059cab142f4'}:dep
      ]}});
    }
    if(url.endsWith('/versions/'+VERSION))return result({success:true,result:{
      id:VERSION,number:wrongVersion?18:17,
      resources:{
        bindings:missingVersion?undefined:[{name:'DB',type:'d1',database_id:versionDb},
          {name:'ADMIN_TOKEN',type:'secret_text',text:'TOP-SECRET-DO-NOT-PRINT'}],
        script:{etag:'only-a-cloudflare-content-etag-not-a-comparable-file-hash'}
      }
    }});
    if(url.endsWith('/settings'))return result({success:true,result:{
      bindings:emptySettings?[]:[{name:'DB',type:'d1',database_id:settingsDb},
        {name:'ADMIN_TOKEN',type:'secret_text',text:'TOP-SECRET-DO-NOT-PRINT'}]
    }});
    assert.fail('Unexpected endpoint '+url);
  };
  return {fetchImpl,calls};
}
const common={accountId:ACCOUNT,scriptName:'storm',databaseId:DB,
  expectedVersionNumber:17,token:TOKEN};

test('DB binding parser supports array/object and legacy id but rejects ambiguous entries',()=>{
  assert.deepEqual(extractDB([{name:'DB',type:'d1',database_id:DB}]),
    {status:'present',databaseId:DB});
  assert.deepEqual(extractDB({DB:{type:'d1',database_id:DB}}),
    {status:'present',databaseId:DB});
  assert.deepEqual(extractDB([{name:'DB',type:'d1',id:DB}]),
    {status:'present',databaseId:DB});
  assert.equal(extractDB([{name:'DB',type:'secret_text'}]).status,'wrong-type');
  assert.equal(extractDB([{name:'DB',type:'d1',database_id:DB},
    {name:'DB',type:'d1',database_id:DB}]).status,'ambiguous');
  assert.equal(extractDB(null).status,'missing');
  assert.equal(compareBinding([{name:'DB',type:'d1',database_id:DB}],OTHER).matchesExpected,false);
});
test('stable active version metadata and both D1 bindings match without leaking secrets',async()=>{
  const {fetchImpl,calls}=fake();
  let saved=null;
  const report=await verifyWorkerDB({...common,fetchImpl,
    persist:async x=>{saved=x;return '/tmp/private';}});
  assert.equal(report.bindingStatus,'TRAFFIC_VERSION_DB_MATCH_CURRENT_SETTINGS_MATCH');
  assert.equal(report.versionDBBinding.matchesExpected,true);
  assert.equal(report.currentSettingsDBBinding.matchesExpected,true);
  assert.equal(report.versionSourceMatch,'NOT_VERIFIED');
  assert.equal(report.releaseGate,'BLOCKED_PENDING_VERSION_SOURCE_AND_CURSOR_ROLLOUT_REVIEW');
  assert.equal(report.requests,4);
  assert.equal(calls.length,4);
  assert.equal(report.activeVersionNumber,17);
  assert.equal(saved.localEvidenceDirectory,undefined);
  assert.equal(JSON.stringify(report).includes(TOKEN),false);
  assert.equal(JSON.stringify(report).includes(DB),false);
  assert.equal(JSON.stringify(report).includes('TOP-SECRET-DO-NOT-PRINT'),false);
});
test('version binding match remains source-confirmed even if current settings differ',async()=>{
  const {fetchImpl}=fake({settingsDb:OTHER});
  const report=await verifyWorkerDB({...common,fetchImpl,persist:async()=>'/tmp/private'});
  assert.equal(report.bindingStatus,'TRAFFIC_VERSION_DB_MATCH_SETTINGS_DIFFER_OR_ABSENT');
  assert.equal(report.versionDBBinding.matchesExpected,true);
  assert.equal(report.currentSettingsDBBinding.matchesExpected,false);
});
test('matching current settings cannot substitute for missing traffic-version binding',async()=>{
  const {fetchImpl}=fake({missingVersion:true});
  const report=await verifyWorkerDB({...common,fetchImpl,persist:async()=>'/tmp/private'});
  assert.equal(report.bindingStatus,'CURRENT_SETTINGS_ONLY_NOT_VERSION_VERIFIED');
});
test('version DB mismatch fails verification even when settings appear correct',async()=>{
  const {fetchImpl}=fake({versionDb:OTHER});
  const report=await verifyWorkerDB({...common,fetchImpl,persist:async()=>'/tmp/private'});
  assert.equal(report.bindingStatus,'NOT_VERIFIED_OR_MISMATCH');
});
test('deployment race rejects output before report persistence',async()=>{
  const {fetchImpl,calls}=fake({drift:true});let wrote=false;
  await assert.rejects(()=>verifyWorkerDB({...common,fetchImpl,
    persist:async()=>{wrote=true;return '/tmp';}}),/Deployment changed/);
  assert.equal(calls.length,4);assert.equal(wrote,false);
});
test('changed production version number, token error and HTTP 403 fail closed',async()=>{
  const {fetchImpl,calls}=fake({wrongVersion:true});
  await assert.rejects(()=>verifyWorkerDB({...common,fetchImpl}),/version number changed/);
  assert.equal(calls.length,2);
  const denied=fake({httpCode:403});
  await assert.rejects(()=>verifyWorkerDB({...common,fetchImpl:denied.fetchImpl}),/HTTP 403/);
  await assert.rejects(()=>verifyWorkerDB({...common,token:''}),/token required/);
});
test('reject multi-version rollouts and unsafe argument values',()=>{
  assert.throws(()=>getActiveVersion({deployments:[{
    id:DEPLOYMENT,versions:[{version_id:VERSION,percentage:50},
      {version_id:'a51abe3c-283e-4e4e-a119-6ff8cb13420a',percentage:50}]
  }]}),/single-version/);
  assert.deepEqual(parseArgs(['--script-name','storm','--expected-version-number','17']),
    {scriptName:'storm',expectedVersionNumber:17});
  assert.throws(()=>parseArgs(['--expected-version-number','garbage']),/Invalid expected/);
  assert.throws(()=>parseArgs(['--mutation']),/Usage/);
});
