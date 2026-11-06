import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const CONTRACT='storm-web04b7d-offline-staging-plan/v1';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const NAME=/^[A-Za-z0-9_.-]{3,128}$/;
function digest(x){return createHash('sha256').update(x).digest('hex').slice(0,16);}
function schemaKeys(obj,keys,label){
  if(!obj||typeof obj!=='object'||Array.isArray(obj)||
     Object.keys(obj).sort().join('|')!==keys.slice().sort().join('|'))
    throw Error('Invalid '+label+' structure; unknown fields or missing required fields');
}
function arrayEmpty(a,name){
  if(!Array.isArray(a)||a.length)throw Error(name+' must be explicitly empty for declared isolation');
}
function expect(v,condition,reason){if(!condition)throw Error(reason);return v;}
function assessPlan(plan){
  schemaKeys(plan,['contract','production','staging'],'plan');
  if(plan.contract!==CONTRACT)throw Error('Unsupported staging plan contract');
  schemaKeys(plan.production,['worker','d1Uuid','r2Bucket'],'production');
  schemaKeys(plan.staging,['worker','d1Uuid','r2Bucket',
    'cronTriggers','zoneRoutes','customDomains','useProductionSecrets',
    'scheduledCollectorEnabled','adminCollectionEnabled','liveAgencyCollectionEnabled',
    'syntheticRecordsOnly'],'staging');
  const p=plan.production,s=plan.staging;
  if(!NAME.test(p.worker)||!NAME.test(s.worker)||p.worker!=='storm')
    throw Error('Production and staging worker names must be explicit and valid');
  if(!UUID.test(p.d1Uuid)||!UUID.test(s.d1Uuid))
    throw Error('Both D1 IDs must be valid UUIDs');
  if(!NAME.test(p.r2Bucket)||!NAME.test(s.r2Bucket))
    throw Error('Both R2 Bucket names must be valid');
  expect(true,p.worker!==s.worker,'Staging Worker reuses production name');
  expect(true,p.d1Uuid.toLowerCase()!==s.d1Uuid.toLowerCase(),
    'Staging D1 reuses production UUID');
  expect(true,p.r2Bucket!==s.r2Bucket,'Staging R2 reuses production bucket');
  arrayEmpty(s.cronTriggers,'Cron Triggers');
  arrayEmpty(s.zoneRoutes,'Zone Routes');
  arrayEmpty(s.customDomains,'Custom Domains');
  for(const key of ['useProductionSecrets','scheduledCollectorEnabled',
    'adminCollectionEnabled','liveAgencyCollectionEnabled'])
    expect(true,s[key]===false,key+' must be explicitly false');
  expect(true,s.syntheticRecordsOnly===true,'Synthetic-only records declaration required');
  return {
    contract:'storm-web04b7d-staging-plan-assessment/v1',
    scope:'OFFLINE DECLARATION ONLY NOT CLOUDFLARE RESOURCE VERIFICATION',
    state:'NO_OBVIOUS_COLLISIONS_IN_DECLARED_IDENTIFIERS',
    production:{workerNameSha256Prefix:digest(p.worker),
      d1Sha256Prefix:digest(p.d1Uuid.toLowerCase()),
      r2Sha256Prefix:digest(p.r2Bucket)},
    staging:{workerNameSha256Prefix:digest(s.worker),
      d1Sha256Prefix:digest(s.d1Uuid.toLowerCase()),
      r2Sha256Prefix:digest(s.r2Bucket),
      cronTriggerCount:0,routeCount:0,customDomainCount:0,
      productionSecretsAllowed:false,collectionAllowed:false,syntheticOnly:true},
    stagingResourcesActuallyCreated:'NOT_VERIFIED',
    runtimeControlsActuallyEnforced:'NOT_VERIFIED',
    productionIsolationActuallyProven:'NOT_VERIFIED',
    rollbackRehearsal:'NOT_PERFORMED',
    releaseGate:'BLOCKED_NO_STAGING_DEPLOYMENT_AUTHORIZATION'
  };
}
function parseArgs(args){
  if(args.length!==2||args[0]!=='--private-plan'||typeof args[1]!=='string'||
     !args[1].trim())throw Error('Usage: node audit-web04b7d-staging-plan.mjs --private-plan PATH');
  return args[1];
}
async function inspectLocal(path,read=readFile){
  const bytes=await read(path);
  if(!Buffer.isBuffer(bytes)||bytes.length>16384||bytes.length<100)
    throw Error('Invalid staging plan input size');
  let plan;
  try{plan=JSON.parse(bytes.toString('utf8'));}
  catch{throw Error('Invalid staging plan JSON');}
  return assessPlan(plan);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(await inspectLocal(parseArgs(process.argv.slice(2))),null,2));}
  catch(e){console.error('WEB-04B-7D offline staging-plan check blocked:',e.message);process.exitCode=1;}
}
export {assessPlan,inspectLocal,parseArgs,CONTRACT};
