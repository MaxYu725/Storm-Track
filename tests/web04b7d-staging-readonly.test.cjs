'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');

const workerSrc=readFileSync(join(__dirname,'../backend/worker.js'),'utf8');
const workerUrl='data:text/javascript;base64,'+Buffer.from(workerSrc).toString('base64');
const stageSrc=readFileSync(join(__dirname,'../backend/web04b7-staging-readonly.js'),'utf8')
  .replace("from './worker.js'","from '"+workerUrl+"'");
const modulePromise=import('data:text/javascript;base64,'+Buffer.from(stageSrc).toString('base64'));
const mode='storm-web04b7d-synthetic-readonly';
function syntheticDB(){
  const calls=[];
  const db={prepare(sql){
    calls.push(sql);
    if(!/^\s*SELECT\b/i.test(sql))throw Error('NON-SELECT FORBIDDEN');
    return {bind(...args){return {
      async first(){return {merged_into_id:null};},
      async all(){return {results:[]};}
    }}};
  }};
  return {db,calls};
}
async function request(path, env,method='GET'){
  const worker=(await modulePromise).default;
  const resp=await worker.fetch(new Request('https://isolated.test'+path,{method}),env,{});
  return {status:resp.status,json:await resp.json()};
}
test('only fetch export exists; scheduled collector cannot be registered by stage module',async()=>{
  const stage=(await modulePromise).default;
  assert.equal(typeof stage.fetch,'function');
  assert.equal(Object.prototype.hasOwnProperty.call(stage,'scheduled'),false);
  assert.deepEqual(Object.keys(stage),['fetch']);
});
test('stage refuses missing/misconfigured DB or presence of any other binding',async()=>{
  const {db,calls}=syntheticDB();
  const allowed={DB:db,STAGING_REVIEW_MODE:mode};
  for(const env of [
    {},{DB:db},{DB:db,STAGING_REVIEW_MODE:'production'},
    {...allowed,ADMIN_TOKEN:'opaque'},
    {...allowed,RAW_BUCKET:{list(){}}},
    {...allowed,CWA_AUTHORIZATION:'opaque'},
    {...allowed,EXTRA_UNKNOWN_BINDING:'anything'}
  ]){
    const got=await request('/api/history/storms/STC-FIXTURE/advisories?paging=cursor',env);
    assert.equal(got.status,503);
    assert.equal(got.json.error,'Staging isolation is not verified');
  }
  assert.equal(calls.length,0);
});
test('only history advisory GET or limited local health route; admin, repair, proxy and scheduled never reachable',async()=>{
  const {db,calls}=syntheticDB();
  const env={DB:db,STAGING_REVIEW_MODE:mode};
  for(const path of [
    '/api/admin/collect','/api/admin/repair-identities','/api/proxy/hko',
    '/api/history/storms','/api/history/storms/STC-FIXTURE/advisories/extra',
    '/probe/database','/api/cwa','/api/history/storms/STC-FIXTURE/points'
  ]) {
    const out=await request(path,env);
    assert.equal(out.status,404,path);
  }
  for(const method of ['POST','PUT','DELETE','PATCH']){
    const out=await request('/api/admin/collect',env,method);
    assert.equal(out.status,405);
  }
  assert.equal(calls.length,0,'disabled paths cannot query D1');
  const health=await request('/__staging__/health',env);
  assert.equal(health.status,200);
  assert.deepEqual(health.json,{ok:true,stage:'synthetic-readonly'});
});
test('legitimate archive GET delegates to Worker but can only SELECT from local DB',async()=>{
  const {db,calls}=syntheticDB();
  const env={DB:db,STAGING_REVIEW_MODE:mode};
  const route='/api/history/storms/STC-FIXTURE/advisories?paging=cursor&limit=50';
  const out=await request(route,env);
  assert.equal(out.status,200);
  assert.deepEqual(out.json.advisories,[]);
  assert.equal(out.json.pagination.count,0);
  assert.equal(out.json.pagination.hasMore,false);
  assert.ok(calls.length>=1);
  assert.ok(calls.every(sql=>/^\s*SELECT\b/i.test(sql)));
});
