import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditRuntime,valid,active,bindingFrom,summarizeBindings,normalizedDate,
  safeFlags,scheduleInfo,parseArgs
} from '../scripts/audit-web04b7c-runtime-metadata.mjs';

const ACCOUNT='0123456789abcdef0123456789abcdef';
const DB='12345678-1234-4123-a456-123456789abc';
const OTHER_DB='87654321-4321-4123-a456-abcdef123456';
const R2='storm-track-raw-test';
const TOKEN='SECRET-TOKEN-NOT-OUTPUT';
const VERSION='320a390b-315e-494c-a135-eb242adc340d';
const DEPLOYMENT='895652c2-06b3-4cd9-afbb-d886cac7f0fe';
const ETAG='2db199a2281e6209518941a5a36f5cd91392dc4022db284db60efde136129b54';
const bindings=[
  {name:'DB',type:'d1',database_id:DB},
  {name:'RAW_BUCKET',type:'r2_bucket',bucket_name:R2},
  {name:'ADMIN_TOKEN',type:'secret_text',text:'ADMIN_SECRET_MUST_NOT_LEAK'},
  {name:'CWA_AUTHORIZATION',type:'secret_text',text:'CWA_SECRET_MUST_NOT_LEAK'}
];
const baseVersion={id:VERSION,number:17,resources:{
  script:{etag:ETAG,handlers:['fetch','scheduled']},
  script_runtime:{compatibility_date:'2025-09-01T00:00:00Z',
    compatibility_flags:['nodejs_compat']},
  bindings
}};
function res(result,status=200){return new Response(JSON.stringify(
  status===200?{success:true,result}:{success:false,errors:[{code:7500,message:'secret error'}]}
),{status,headers:{'content-type':'application/json'}});}
function mock({version=baseVersion,settingsBindings=bindings,cron=['*/15 * * * *'],
  settingsDate='2025-09-01',etagChanged=false,
  drift=false,denyStage=null}={}){
  const calls=[];
  const fetchImpl=async(url,opts)=>{
    calls.push({url,method:opts.method});
    const i=calls.length;
    assert.equal(opts.method,'GET');
    assert.equal(opts.headers.Authorization,'Bearer '+TOKEN);
    assert.equal(opts.redirect,'error');
    if(denyStage===i)return res(null,403);
    if(url.endsWith('/deployments?per_page=1')){
      const j=calls.filter(x=>x.url.endsWith('/deployments?per_page=1')).length;
      return res({deployments:[{
        id:drift&&j===2?'00000000-0000-4000-8000-000000000000':DEPLOYMENT,
        versions:[{version_id:VERSION,percentage:100}]}]});
    }
    if(url.endsWith('/versions/'+VERSION))return res(etagChanged?{
      ...version,resources:{...version.resources,script:{...version.resources.script,etag:'wrong'}}
    }:version);
    if(url.endsWith('/settings'))return res({bindings:settingsBindings,
      compatibility_date:settingsDate,compatibility_flags:[]});
    if(url.endsWith('/script-settings'))return res({logpush:false,
      observability:{enabled:true},tail_consumers:[]});
    if(url.endsWith('/schedules'))return res({schedules:cron.map(cron=>({cron}))});
    if(url.endsWith('/subdomain'))return res({enabled:true,previews_enabled:false});
    throw Error('Unknown GET '+url);
  };
  return {calls,fetchImpl};
}
const inputs={accountId:ACCOUNT,scriptName:'storm',databaseId:DB,
  expectedR2Bucket:R2,token:TOKEN,persist:async()=>'/private/mock'};
test('complete exact 7-GET audit proves immutable version settings without exposing secrets',async()=>{
  const {calls,fetchImpl}=mock();
  let persisted;
  const report=await auditRuntime({...inputs,fetchImpl,persist:async r=>{
    persisted=r;return '/temp/report-private';
  }});
  assert.equal(calls.length,7);
  assert.ok(calls.every(x=>x.method==='GET'));
  assert.equal(report.requests,7);
  assert.equal(report.readiness.versionD1Binding,'MATCHED');
  assert.equal(report.readiness.versionR2Bucket,'MATCHED');
  assert.equal(report.readiness.versionRuntimeMetadata,'REPORTED');
  assert.equal(report.versionRuntime.compatibilityDate,'2025-09-01');
  assert.deepEqual(report.versionRuntime.compatibilityFlags.values,['nodejs_compat']);
  assert.deepEqual(report.versionRuntime.handlers,['fetch','scheduled']);
  assert.equal(report.cron.fifteenMinuteCadenceObserved,true);
  assert.equal(report.subdomain.enabled,true);
  assert.equal(report.writesAttempted,0);
  assert.equal(report.releaseGate,'BLOCKED_PENDING_STAGING_ISOLATION_AND_ROLLBACK_APPROVAL');
  assert.equal(persisted.localEvidenceDirectory,undefined);
  for(const value of [TOKEN,ACCOUNT,DB,R2,'ADMIN_SECRET_MUST_NOT_LEAK','CWA_SECRET_MUST_NOT_LEAK']) {
    assert.ok(!JSON.stringify(report).includes(value),'secret value leaked');
  }
});
test('only deployed version binding is authoritative; newer current settings do not override it',async()=>{
  const {fetchImpl}=mock({settingsBindings:[
    {name:'DB',type:'d1',database_id:OTHER_DB}]});
  const report=await auditRuntime({...inputs,fetchImpl});
  assert.equal(report.readiness.versionD1Binding,'MATCHED');
  assert.equal(report.latestSettingsBindings.DB.matchesExpected,false);
  assert.equal(report.versionBindings.DB.matchesExpected,true);
});
test('R2 bucket unknown is reported as unverified, not silently matched',async()=>{
  const {fetchImpl}=mock();
  const result=await auditRuntime({...inputs,expectedR2Bucket:null,fetchImpl});
  assert.equal(result.readiness.versionR2Bucket,'MANUAL_REVIEW_REQUIRED');
  assert.equal(result.versionBindings.RAW_BUCKET.identityCheck,'NAME_NOT_SUPPLIED');
});
test('wrong version D1 or R2 bucket does not grant release gate',async()=>{
  const other={...baseVersion,resources:{...baseVersion.resources,bindings:[
    {name:'DB',type:'d1',database_id:OTHER_DB},
    {name:'RAW_BUCKET',type:'r2_bucket',bucket_name:'not-correct-bucket'}
  ]}};
  const {fetchImpl}=mock({version:other});
  const report=await auditRuntime({...inputs,fetchImpl});
  assert.equal(report.readiness.versionD1Binding,'BLOCKED');
  assert.equal(report.readiness.versionR2Bucket,'MANUAL_REVIEW_REQUIRED');
});
test('no version/date/flags proof if missing or malformed fields',async()=>{
  const version={...baseVersion,resources:{...baseVersion.resources,script_runtime:{}}};
  const {fetchImpl}=mock({version});
  const report=await auditRuntime({...inputs,fetchImpl});
  assert.equal(report.readiness.versionRuntimeMetadata,'INCOMPLETE');
  assert.equal(report.versionRuntime.compatibilityDate,null);
  assert.equal(report.versionRuntime.compatibilityFlags.state,'UNKNOWN_OR_MALFORMED');
});
test('version ID, ETag and deployment drift hard-stop',async()=>{
  const a=mock({etagChanged:true});
  await assert.rejects(()=>auditRuntime({...inputs,fetchImpl:a.fetchImpl}),/ETag changed/);
  assert.equal(a.calls.length,2);
  const b=mock({drift:true});
  await assert.rejects(()=>auditRuntime({...inputs,fetchImpl:b.fetchImpl}),/changed/);
  assert.equal(b.calls.length,7);
  const c=mock({denyStage:4});
  await assert.rejects(()=>auditRuntime({...inputs,fetchImpl:c.fetchImpl}),/script-level-settings HTTP 403/);
  assert.equal(c.calls.length,4);
});
test('unknown cron and malformed binding fail without printing confidential values',()=>{
  assert.equal(normalizedDate('2025-09-01T00:00:00Z'),'2025-09-01');
  assert.equal(normalizedDate('not-date'),null);
  assert.equal(safeFlags(['nodejs_compat']).state,'PRESENT');
  assert.equal(safeFlags(['invalid flag']).state,'UNKNOWN_OR_MALFORMED');
  assert.deepEqual(scheduleInfo({schedules:[{cron:'*/15 * * * *'}]}).crons,['*/15 * * * *']);
  assert.throws(()=>scheduleInfo({schedules:[{cron:'\nNOTSAFE'}]}),/Unrecognized/);
  assert.equal(bindingFrom(null,'DB').state,'absent');
  assert.equal(bindingFrom([bindings[0],bindings[0]],'DB').state,'ambiguous');
  assert.equal(summarizeBindings({DB:bindings[0],RAW_BUCKET:bindings[1]},DB,R2).DB.matchesExpected,true);
});
test('strict local identifier validation and reject mutating CLI options',()=>{
  valid(inputs);
  assert.throws(()=>valid({...inputs,accountId:'INVALID'}),/account/);
  assert.throws(()=>valid({...inputs,expectedR2Bucket:'../invalid'}),/bucket/);
  assert.throws(()=>parseArgs(['--write','true']),/Usage/);
  assert.deepEqual(parseArgs(['--script-name','storm','--expected-r2-bucket',R2]),
    {scriptName:'storm',expectedR2Bucket:R2});
  assert.throws(()=>active({deployments:[{id:DEPLOYMENT,versions:[{version_id:VERSION,percentage:50}]}]}),/changed/);
});
