import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureD1Audit,parseArgs,assertIdentifiers,unwrapQuery,summarizePlan,QUERIES
} from '../scripts/audit-web04b-d1-readonly.mjs';
const ACCOUNT='0123456789abcdef0123456789abcdef';
const DB='12345678-1234-4123-a456-123456789abc';
const TOKEN='SECRET-D1-READ-TOKEN-NEVER-LOG';
function response(o,status=200) {
  return new Response(JSON.stringify(o),{status,headers:{'content-type':'application/json'}});
}
const metadata={success:true,result:{uuid:DB,name:'storm-history'}};
const required=['id','storm_id','agency','issued_at','ingest_status'];
const values={
  columns:required.map(name=>({name,type:'TEXT',notnull:1,pk:name==='id'?1:0})),
  indexList:[{seq:0,name:'idx_advisory_keyset',unique:0,origin:'c',partial:0}],
  indexSql:[{name:'idx_advisory_keyset',
    sql:'CREATE INDEX idx_advisory_keyset ON advisories(storm_id,ingest_status,issued_at DESC,id DESC)'}],
  basePlan:[{detail:'SEARCH advisories USING COVERING INDEX idx_advisory_keyset (storm_id=? AND ingest_status=?)'}],
  agencyPlan:[{detail:'SEARCH advisories USING INDEX idx_advisory_keyset (storm_id=?)'}],
  cursorPlan:[{detail:'SEARCH advisories USING COVERING INDEX idx_advisory_keyset (storm_id=?)'}],
  sample:[{id:'a',storm_id:'abc',agency:'HKO',issued_at:'2026-01-02T12:00:00.000Z'},
          {id:'b',storm_id:'abc',agency:'JMA',issued_at:'2026-01-02T12:00:00.000Z'}]
};
function mock({change={},failedStep=-1,writeStep=-1,wrongDb=false}={}) {
  const calls=[];
  const fetchImpl=async(url,opts)=>{
    calls.push({url,opts});
    assert.ok(url.startsWith('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/d1/database/'+DB));
    assert.equal(opts.headers.Authorization,'Bearer '+TOKEN);
    assert.equal(opts.redirect,'error');
    const n=calls.length;
    if(n===1) {
      assert.equal(opts.method,'GET');
      assert.equal(opts.body,undefined);
      return response(wrongDb?{success:true,result:{...metadata.result,
        uuid:'00000000-0000-0000-0000-000000000000'}}:metadata);
    }
    assert.equal(opts.method,'POST');
    assert.equal(opts.headers['Content-Type'],'application/json');
    const body=JSON.parse(opts.body),spec=QUERIES[n-2];
    assert.deepEqual(body,{sql:spec.sql,params:spec.params});
    assert.ok(/^PRAGMA (?:table_info|index_list)\('advisories'\)$|^SELECT\b|^EXPLAIN QUERY PLAN SELECT\b/.test(body.sql));
    assert.equal(body.sql.includes(';'),false);
    if(n===failedStep)return response({success:false,result:[],errors:[{message:'test'}]});
    return response({success:true,result:[{success:true,results:change[spec.key]??values[spec.key],
      meta:writeStep===n?{changed_db:true,rows_written:1}:{changed_db:false,rows_written:0,changes:0}}]});
  };
  return {fetchImpl,calls};
}
test('fixed SQL only; reject arbitrary SQL and invalid identifiers',()=>{
  assertIdentifiers(ACCOUNT,DB);
  assert.throws(()=>assertIdentifiers(ACCOUNT,'not-a-uuid'),/UUID/);
  assert.throws(()=>assertIdentifiers('wrong',DB),/Account ID/);
  assert.throws(()=>parseArgs(['--sql','DELETE FROM advisories']),/Usage/);
  assert.deepEqual(parseArgs(['--account-id',ACCOUNT,'--database-id',DB]),
    {accountId:ACCOUNT,databaseId:DB});
  assert.equal(QUERIES.length,7);
});
test('bounded read-only queries return metadata and aggregated sample summary',async()=>{
  const {fetchImpl,calls}=mock();
  let saved=null;
  const result=await captureD1Audit({accountId:ACCOUNT,databaseId:DB,token:TOKEN,fetchImpl,
    persist:async r=>{saved=r;return '/tmp/outside-git';}});
  assert.equal(calls.length,8);
  assert.equal(result.requests,8);
  assert.equal(result.sample.sampledRows,2);
  assert.equal(result.sample.repeatedTimestamp,1);
  assert.equal(result.sample.nonCanonicalTime,0);
  assert.equal(result.readiness,'SAMPLED_PLANS_ACCEPTABLE_FULL_REVIEW_REQUIRED');
  assert.equal(result.localEvidenceDirectory,'/tmp/outside-git');
  assert.equal(saved.localEvidenceDirectory,undefined);
  assert.equal(JSON.stringify(result).includes(TOKEN),false);
  assert.equal(JSON.stringify(result).includes(DB),false);
  assert.equal(JSON.stringify(result).includes('"storm_id":"abc"'),false);
  assert.equal(result.writesAttempted,0);
  assert.equal(calls.filter(c=>c.opts.method==='POST').length,7);
});
test('poor plans and non-canonical timestamps require further review',async()=>{
  const {fetchImpl}=mock({change:{
    cursorPlan:[{detail:'SCAN advisories'},{detail:'USE TEMP B-TREE FOR ORDER BY'}],
    sample:[{id:'a',storm_id:'x',agency:'CMA',issued_at:'2026-01-02T20:00:00+08:00'},
            {id:'b',storm_id:'y',agency:'HKO',issued_at:'not-a-time'}]
  }});
  const result=await captureD1Audit({
    accountId:ACCOUNT,databaseId:DB,token:TOKEN,fetchImpl,persist:async()=>'/tmp/mock'
  });
  assert.equal(result.readiness,'REVIEW_REQUIRED');
  assert.equal(result.sample.nonCanonicalTime,1);
  assert.equal(result.sample.invalidTime,1);
  assert.equal(result.plans.cursor.tempSort,true);
  assert.equal(result.plans.cursor.tableScan,true);
});
test('database identity mismatch halts before SQL',async()=>{
  const {fetchImpl,calls}=mock({wrongDb:true});
  await assert.rejects(()=>captureD1Audit({
    accountId:ACCOUNT,databaseId:DB,token:TOKEN,fetchImpl
  }),/UUID differs/);
  assert.equal(calls.length,1);
});
test('schema mismatch halts without further D1 reads',async()=>{
  const {fetchImpl,calls}=mock({change:{
    columns:values.columns.filter(c=>c.name!=='issued_at')
  }});
  await assert.rejects(()=>captureD1Audit({
    accountId:ACCOUNT,databaseId:DB,token:TOKEN,fetchImpl
  }),/Expected advisories columns/);
  assert.equal(calls.length,2);
});
test('unexpected database write indicators are rejected',async()=>{
  const {fetchImpl,calls}=mock({writeStep:3});
  await assert.rejects(()=>captureD1Audit({
    accountId:ACCOUNT,databaseId:DB,token:TOKEN,fetchImpl
  }),/write indicator/);
  assert.equal(calls.length,3);
});
test('failed D1 query and missing token fail closed',async()=>{
  const {fetchImpl}=mock({failedStep:3});
  await assert.rejects(()=>captureD1Audit({
    accountId:ACCOUNT,databaseId:DB,token:TOKEN,fetchImpl
  }),/D1 query failed/);
  await assert.rejects(()=>captureD1Audit({
    accountId:ACCOUNT,databaseId:DB,token:'',fetchImpl
  }),/token/);
});
test('EXPLAIN plan recognizer detects table scan and temp sort',()=>{
  assert.equal(summarizePlan([{detail:'SEARCH advisories USING INDEX abc (storm_id=?)'}]).indexSearch,true);
  assert.equal(summarizePlan([{detail:'SCAN advisories'},{detail:'USE TEMP B-TREE FOR ORDER BY'}]).tempSort,true);
  assert.equal(unwrapQuery({success:true,result:[{success:true,results:[]}]},'test').length,0);
});
