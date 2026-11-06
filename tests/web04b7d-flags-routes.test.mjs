import test from 'node:test';
import assert from 'node:assert/strict';
import {inspect7D,compareFlagEvidence,parseFlags,summarizeRoutes,parseArgs,active}
  from '../scripts/audit-web04b7d-flags-routes.mjs';

const ACCOUNT='0123456789abcdef0123456789abcdef';
const ZONE='abcdefabcdefabcdefabcdefabcdefab';
const WORKER_TOKEN='FAKE_WORKERS_TOKEN_PRIVATE';
const ROUTES_TOKEN='FAKE_ROUTES_TOKEN_PRIVATE';
const VERSION='320a390b-315e-494c-a135-eb242adc340d';
const DEPLOYMENT='895652c2-06b3-4cd9-afbb-d886cac7f0fe';
function reply(result,status=200){
  return new Response(JSON.stringify(status===200?{success:true,result}:
    {success:false,errors:[{code:5000,message:'secret error not logged'}]}),
    {status,headers:{'content-type':'application/json'}});
}
function mock({scriptFlags=undefined,betaFlags=[],drift=false,zoneError=false,
  routes=[{id:'aa',pattern:'storm.example.com/*',script:'storm'},
    {id:'bb',pattern:'other.example.com/*',script:'other'}]}={}){
  const calls=[];
  const fetchImpl=async(url,opts)=>{
    calls.push({url,method:opts.method});
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'error');
    assert.equal(opts.headers.Authorization,
      'Bearer '+(url.includes('/zones/')?ROUTES_TOKEN:WORKER_TOKEN));
    if(url.endsWith('/deployments?per_page=1')){
      const n=calls.filter(x=>x.url.endsWith('/deployments?per_page=1')).length;
      return reply({deployments:[{
        id:drift&&n===2?'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa':DEPLOYMENT,
        versions:[{version_id:VERSION,percentage:100}]
      }]});
    }
    if(url.includes('/scripts/storm/versions/'))return reply({
      id:VERSION,number:17,resources:{script_runtime:{
        compatibility_date:'2026-08-05',
        ...(scriptFlags===undefined?{}:{compatibility_flags:scriptFlags})
      }}
    });
    if(url.includes('/workers/workers/storm/versions/'))return reply({
      id:VERSION,number:17,compatibility_date:'2026-08-05',
      ...(betaFlags===undefined?{}:{compatibility_flags:betaFlags})
    });
    if(url.includes('/zones/'+ZONE+'/workers/routes'))
      return zoneError?reply(null,403):reply(routes);
    throw Error('Unexpected endpoint '+url);
  };
  return {calls,fetchImpl};
}
const inputs={accountId:ACCOUNT,scriptName:'storm',zoneIds:[ZONE],
  workersToken:WORKER_TOKEN,routesToken:ROUTES_TOKEN,
  persist:async()=>'/private/mock-path'};

test('immutable Beta explicit empty flags and scoped zone routes verified, redacted',async()=>{
  const {calls,fetchImpl}=mock();
  const result=await inspect7D({...inputs,fetchImpl});
  assert.equal(result.flags.status,'VERSION_EXPLICIT_FLAGS_REPORTED');
  assert.equal(result.flags.scriptVersion.state,'NOT_RETURNED');
  assert.deepEqual(result.flags.immutableBetaVersion.values,[]);
  assert.equal(result.flags.dateStatus,'MATCHED_BOTH');
  assert.equal(result.zoneRoutes[0].routesCount,2);
  assert.equal(result.zoneRoutes[0].matchedScriptRouteCount,1);
  assert.equal(result.requests,5);
  assert.equal(result.writesAttempted,0);
  assert.ok(calls.every(x=>x.method==='GET'));
  for(const secret of [ACCOUNT,ZONE,WORKER_TOKEN,ROUTES_TOKEN,
    'storm.example.com','other.example.com'])
    assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(result.customDomainsStatus,'NOT_CHECKED_REQUIRES_SEPARATE_REVIEW');
});
test('two omitted optional compatibility flags cannot establish an empty array',async()=>{
  const x=mock({betaFlags:null});
  const result=await inspect7D({...inputs,zoneIds:[],routesToken:null,
    fetchImpl:x.fetchImpl});
  assert.equal(result.flags.status,'NOT_VERIFIED');
  assert.equal(result.flags.effectiveFlags,null);
  assert.equal(result.routesStatus,'NOT_CHECKED_NO_ZONE_IDS');
  assert.equal(result.requests,4);
});
test('script version can provide explicit flags when immutable Beta omits field',()=>{
  const result=compareFlagEvidence({
    id:VERSION,number:17,resources:{script_runtime:{
      compatibility_date:'2026-08-05',compatibility_flags:['nodejs_compat']
    }}
  },{id:VERSION,number:17,compatibility_date:'2026-08-05'});
  assert.equal(result.status,'VERSION_EXPLICIT_FLAGS_REPORTED');
  assert.deepEqual(result.effectiveFlags,['nodejs_compat']);
});
test('conflicting flags, malformed shapes, dates and version ID fail closed',()=>{
  const script={id:VERSION,number:17,resources:{script_runtime:{
    compatibility_date:'2026-08-05',compatibility_flags:['nodejs_compat']
  }}};
  assert.equal(compareFlagEvidence(script,{id:VERSION,number:17,
    compatibility_date:'2026-08-05',compatibility_flags:[]}).status,
  'CONFLICTING_VERSION_FIELDS');
  assert.equal(parseFlags(['INVALID FLAG']).state,'MALFORMED');
  assert.equal(parseFlags(undefined).state,'NOT_RETURNED');
  assert.deepEqual(parseFlags([]),{state:'PRESENT',values:[]});
  assert.throws(()=>compareFlagEvidence(script,{id:VERSION,number:17,
    compatibility_date:'2026-08-06',compatibility_flags:[]}),/date mismatch/);
  assert.throws(()=>compareFlagEvidence(script,{id:'bad',number:17}),/identity/);
});
test('route list aggregation flags truncation, duplicates, custom domain limits',()=>{
  const x=summarizeRoutes(ZONE,{result:[{
    id:'route',pattern:'storm.example.com/*',script:'storm'
  }],result_info:{total_count:1}},'storm');
  assert.equal(x.matchedScriptRouteCount,1);
  assert.equal(x.scope,'ZONE_ROUTES_ONLY_NOT_CUSTOM_DOMAINS_OR_OTHER_ZONES');
  assert.throws(()=>summarizeRoutes(ZONE,{result:[{
    id:'route',pattern:'storm.example.com/*',script:'storm'
  }],result_info:{total_count:2}},'storm'),/Truncated/);
  assert.throws(()=>summarizeRoutes(ZONE,{result:[
    {id:'same',pattern:'a',script:'storm'},
    {id:'same',pattern:'b',script:'storm'}
  ]},'storm'),/duplicate/);
});
test('failed routes permissions, token absent, or deployment drift blocks',async()=>{
  const deny=mock({zoneError:true});
  await assert.rejects(()=>inspect7D({...inputs,fetchImpl:deny.fetchImpl}),/HTTP 403/);
  const drift=mock({drift:true});
  await assert.rejects(()=>inspect7D({...inputs,fetchImpl:drift.fetchImpl}),/changed/);
  const empty=mock();
  await assert.rejects(()=>inspect7D({...inputs,routesToken:'',
    fetchImpl:empty.fetchImpl}),/Routes Read token/);
  assert.equal(empty.calls.length,0);
});
test('CLI only accepts explicit read-only identifiers',()=>{
  assert.deepEqual(parseArgs(['--account-id',ACCOUNT,'--script-name','storm',
    '--zone-id',ZONE]),{accountId:ACCOUNT,scriptName:'storm',zoneIds:[ZONE]});
  assert.throws(()=>parseArgs(['--deploy','yes']),/read-only/);
  assert.throws(()=>active({deployments:[{id:DEPLOYMENT,
    versions:[{version_id:VERSION,percentage:50}]}]}),/changed/);
});

test('explicit flags without a verified pinned compatibility date cannot clear the gate',()=>{
  const sameId='320a390b-315e-494c-a135-eb242adc340d';
  const v=compareFlagEvidence({
    id:sameId,number:17,resources:{script_runtime:{
      compatibility_flags:['nodejs_compat']
    }}
  },{id:sameId,number:17,compatibility_flags:['nodejs_compat']});
  assert.equal(v.status,'VERSION_FLAGS_DATE_NOT_VERIFIED');
  assert.equal(v.dateStatus,'NOT_VERIFIED');
  assert.equal(v.effectiveFlags,null);
});
test('route count is explicitly incomplete when Cloudflare omits pagination metadata',()=>{
  const zone='abcdefabcdefabcdefabcdefabcdefab';
  const local=summarizeRoutes(zone,{result:[{id:'X',pattern:'x.example/*',script:'storm'}]},'storm');
  assert.equal(local.completeness,'NOT_CONFIRMED_NO_PAGINATION_METADATA');
  const withMeta=summarizeRoutes(zone,{result:[{id:'X',pattern:'x.example/*',script:'storm'}],
    result_info:{total_count:1}},'storm');
  assert.equal(withMeta.completeness,'TOTAL_COUNT_CONFIRMED');
});
