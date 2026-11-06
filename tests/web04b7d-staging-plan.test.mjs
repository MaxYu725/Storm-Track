import test from 'node:test';
import assert from 'node:assert/strict';
import {assessPlan,inspectLocal,parseArgs,CONTRACT}
  from '../scripts/audit-web04b7d-staging-plan.mjs';

const prod={
  worker:'storm',d1Uuid:'12345678-1234-4123-a456-123456789abc',
  r2Bucket:'storm-raw-production'
};
const stage={
  worker:'storm-cursor-stage',
  d1Uuid:'87654321-4321-4123-a456-abcdef123456',
  r2Bucket:'storm-raw-fixture',
  cronTriggers:[],zoneRoutes:[],customDomains:[],
  useProductionSecrets:false,scheduledCollectorEnabled:false,
  adminCollectionEnabled:false,liveAgencyCollectionEnabled:false,
  syntheticRecordsOnly:true
};
const plan={contract:CONTRACT,production:prod,staging:stage};
test('offline staging manifest returns only hashed plan identifiers with release blocked',()=>{
  const result=assessPlan(plan);
  assert.equal(result.state,'NO_OBVIOUS_COLLISIONS_IN_DECLARED_IDENTIFIERS');
  assert.equal(result.stagingResourcesActuallyCreated,'NOT_VERIFIED');
  assert.equal(result.runtimeControlsActuallyEnforced,'NOT_VERIFIED');
  assert.equal(result.rollbackRehearsal,'NOT_PERFORMED');
  assert.equal(result.releaseGate,'BLOCKED_NO_STAGING_DEPLOYMENT_AUTHORIZATION');
  const body=JSON.stringify(result);
  for(const value of [prod.d1Uuid,stage.d1Uuid,prod.r2Bucket,stage.r2Bucket,
    stage.worker])assert.ok(!body.includes(value));
});
test('reused Worker, D1 UUID and R2 Bucket fail independently',()=>{
  for(const key of ['worker','d1Uuid','r2Bucket']){
    assert.throws(()=>assessPlan({...plan,staging:{...stage,[key]:prod[key]}}),/reuses/);
  }
});
test('cron, DNS route and custom domain declarations must all remain empty',()=>{
  for(const [key,entry] of [['cronTriggers','*/15 * * * *'],
    ['zoneRoutes','example.com/*'],['customDomains','storm.example.com']]){
    assert.throws(()=>assessPlan({...plan,staging:{
      ...stage,[key]:[entry]
    }}),/explicitly empty/);
  }
});
test('live collectors, administrative actions, production secrets and nonsynthetic data blocked',()=>{
  for(const key of ['useProductionSecrets','scheduledCollectorEnabled',
    'adminCollectionEnabled','liveAgencyCollectionEnabled']){
    assert.throws(()=>assessPlan({...plan,staging:{...stage,[key]:true}}),/explicitly false/);
  }
  assert.throws(()=>assessPlan({...plan,staging:{
    ...stage,syntheticRecordsOnly:false
  }}),/Synthetic-only/);
});
test('schema rejects undeclared fields, raw secrets and incomplete plans',()=>{
  assert.throws(()=>assessPlan({...plan,secret:'must-not-be-passed'}),/unknown fields/);
  assert.throws(()=>assessPlan({...plan,staging:{...stage,token:'never-accept'}}),/unknown fields/);
  assert.throws(()=>assessPlan({...plan,production:{worker:'storm'}}),/missing required/);
  assert.throws(()=>assessPlan({...plan,contract:'wrong'}),/Unsupported/);
});
test('private manifest read accepts JSON and refuses large or malformed input',async()=>{
  const result=await inspectLocal('/mock/path',async()=>Buffer.from(JSON.stringify(plan)));
  assert.equal(result.scope,'OFFLINE DECLARATION ONLY NOT CLOUDFLARE RESOURCE VERIFICATION');
  await assert.rejects(()=>inspectLocal('/x',async()=>Buffer.alloc(17000)),/size/);
  await assert.rejects(()=>inspectLocal('/x',async()=>Buffer.from('{bad'.repeat(40))),/JSON/);
  assert.deepEqual(parseArgs(['--private-plan','C:/tmp/staging-private.json']),
    'C:/tmp/staging-private.json');
  assert.throws(()=>parseArgs(['--deploy','production']),/Usage/);
});
