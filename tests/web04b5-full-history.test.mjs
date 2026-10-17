import test from 'node:test';
import assert from 'node:assert/strict';
import {auditFullHistory,parseArgs,SQL,PLAN_PARAMS,numberField,GLOB_PARTS,errorCategory,safeCodes} from '../scripts/audit-web04b5-full-history.mjs';
const ACCOUNT='0123456789abcdef0123456789abcdef';
const DB='12345678-1234-4123-a456-123456789abc';
const TOKEN='SYNTHETIC-READ-ONLY-TOKEN-DO-NOT-LOG';
const responses={
  count:[{n:748}],
  formats:[{n:748,invalidTime:0,nonCanonicalShape:0,invalidId:0,invalidStormId:0}],
  ties:[{sameStormTimeGroups:32,repeatedRows:49,multiAgencyTieGroups:18}],
  agency:[{agency:'HKO',n:180},{agency:'CMA',n:180},{agency:'JMA',n:194},{agency:'CWA',n:194}],
  basePlan:[{detail:'SEARCH advisories USING INDEX idx_advisories_storm_time (storm_id=?)'},{detail:'USE TEMP B-TREE FOR RIGHT PART OF ORDER BY'}],
  agencyPlan:[{detail:'SEARCH advisories USING INDEX idx_advisories_agency_time (agency=?)'}],
  cursorPlan:[{detail:'SEARCH advisories USING INDEX idx_advisories_storm_time (storm_id=?)'},{detail:'USE TEMP B-TREE FOR ORDER BY'}]
};
function reply(result,status=200) {
  return new Response(JSON.stringify(result),{status,headers:{'content-type':'application/json'}});
}
function mock({overrides={},wrongDb=false,failAt=null,writeAt=null}={}) {
  const calls=[],keys=Object.keys(SQL);
  const fetchImpl=async (url,opts)=>{
    calls.push({url,opts});
    const i=calls.length;
    assert.equal(opts.headers.Authorization,'Bearer '+TOKEN);
    assert.equal(opts.redirect,'error');
    if(i===1) {
      assert.equal(opts.method,'GET');
      return reply({success:true,result:{
        uuid:wrongDb?'00000000-0000-0000-0000-000000000000':DB,
        name:'storm-track-db'
      }});
    }
    const key=keys[i-2];
    assert.equal(opts.method,'POST');
    assert.ok(url.endsWith('/query'));
    assert.deepEqual(JSON.parse(opts.body),{sql:SQL[key],params:PLAN_PARAMS[key]});
    assert.ok(/^(SELECT|EXPLAIN QUERY PLAN SELECT)\b/.test(SQL[key]));
    if(i===failAt)return reply({success:false,result:[]});
    return reply({success:true,result:[{
      success:true,results:overrides[key]??responses[key],
      meta:writeAt===i?{changed_db:true,rows_written:1}:{changed_db:false,rows_written:0,changes:0}
    }]});
  };
  return {calls,fetchImpl};
}
test('fixed aggregate SQL cannot accept caller supplied SQL',()=>{
  assert.equal(Object.keys(SQL).length,7);
  assert.throws(()=>parseArgs(['--sql','DELETE FROM advisories']),/Usage/);
  assert.deepEqual(parseArgs(['--account-id',ACCOUNT,'--database-id',DB]),
    {accountId:ACCOUNT,databaseId:DB});
  assert.equal(numberField('17','count'),17);
  assert.throws(()=>numberField(-1,'count'),/Invalid/);
});
test('successful synthetic full history count and tied timestamps are aggregate only',async()=>{
  const {fetchImpl,calls}=mock();
  let persisted;
  const result=await auditFullHistory({
    accountId:ACCOUNT,databaseId:DB,token:TOKEN,fetchImpl,
    persist:async x=>{persisted=x;return '/private/local-not-git';}
  });
  assert.equal(result.outcome,'aggregates-read-no-snapshot');
  assert.equal(result.completeRows,748);
  assert.equal(result.formats.invalidTime,0);
  assert.equal(result.ties.sameStormTimeGroups,32);
  assert.equal(result.ties.multiAgencyTieGroups,18);
  assert.equal(result.requests,8);
  assert.equal(calls.length,8);
  assert.equal(result.localEvidenceDirectory,'/private/local-not-git');
  assert.equal(persisted.localEvidenceDirectory,undefined);
  assert.equal(JSON.stringify(result).includes(TOKEN),false);
  assert.equal(JSON.stringify(result).includes(DB),false);
  assert.equal(result.writesAttempted,0);
  assert.equal(result.releaseGate,'BLOCKED_NO_PRODUCTION_CHANGES');
});
test('large databases are refused before whole-table aggregate queries',async()=>{
  const {fetchImpl,calls}=mock({overrides:{count:[{n:50001}]}});
  const outcome=await auditFullHistory({
    accountId:ACCOUNT,databaseId:DB,token:TOKEN,fetchImpl,
    persist:async()=>'/private/mock'
  });
  assert.equal(outcome.outcome,'full-audit-blocked-large-database');
  assert.equal(outcome.requests,2);
  assert.equal(calls.length,2);
  assert.equal(outcome.formats,undefined);
});
test('wrong D1 UUID, token missing and unknown CLI flags fail closed',async()=>{
  const {fetchImpl,calls}=mock({wrongDb:true});
  await assert.rejects(()=>auditFullHistory({accountId:ACCOUNT,databaseId:DB,token:TOKEN,fetchImpl}),/identity mismatch/);
  assert.equal(calls.length,1);
  await assert.rejects(()=>auditFullHistory({accountId:ACCOUNT,databaseId:DB,token:''}),/token/);
});
test('write indicator, failing D1 and inconsistent counts do not produce successful audit',async()=>{
  const {fetchImpl:writeFetch}=mock({writeAt:3});
  await assert.rejects(()=>auditFullHistory({accountId:ACCOUNT,databaseId:DB,token:TOKEN,fetchImpl:writeFetch}),/write indicator/);
  const {fetchImpl:failedFetch}=mock({failAt:2});
  await assert.rejects(()=>auditFullHistory({accountId:ACCOUNT,databaseId:DB,token:TOKEN,fetchImpl:failedFetch}),/read failed/);
  const {fetchImpl:changedFetch}=mock({overrides:{
    formats:[{...responses.formats[0],n:747}]
  }});
  await assert.rejects(()=>auditFullHistory({accountId:ACCOUNT,databaseId:DB,token:TOKEN,fetchImpl:changedFetch}),/count changed/);
});

test('all canonical timestamp GLOB fragments stay below Cloudflare D1 50-byte ceiling',()=>{
  assert.equal(GLOB_PARTS.length,3);
  assert.deepEqual(GLOB_PARTS.map(x=>Buffer.byteLength(x,'utf8')),[42,33,17]);
  assert.ok(GLOB_PARTS.every(x=>Buffer.byteLength(x,'utf8')<=50));
  const matches=[...SQL.formats.matchAll(/NOT GLOB '([^']+)'/g)].map(x=>x[1]);
  assert.deepEqual(matches,GLOB_PARTS);
  assert.match(SQL.formats,/substr\(issued_at,1,10\)/);
  assert.match(SQL.formats,/substr\(issued_at,11,9\)/);
  assert.match(SQL.formats,/substr\(issued_at,20,5\)/);
});
test('HTTP 400 error reports failing SQL stage and sanitized Cloudflare code',async()=>{
  const {fetchImpl,calls}=mock();
  const badFetch=async(url,opts)=>{
    if(calls.length===2) return reply({
      success:false,errors:[{code:7500,message:'LIKE or GLOB pattern too complex; internal value SECRET-DO-NOT-REVEAL'}]
    },400);
    return fetchImpl(url,opts);
  };
  const promise=auditFullHistory({accountId:ACCOUNT,databaseId:DB,token:TOKEN,fetchImpl:badFetch});
  await assert.rejects(promise,e=>{
    assert.match(e.message,/stage=formats HTTP 400/);
    assert.match(e.message,/CF codes=\[7500\]/);
    assert.match(e.message,/category=GLOB_PATTERN_LIMIT/);
    assert.ok(!e.message.includes('SECRET-DO-NOT-REVEAL'));
    assert.ok(!e.message.includes(TOKEN));
    return true;
  });
  assert.equal(calls.length,2);
  assert.equal(errorCategory({errors:[{message:'syntax error near SELECT'}]}),'SQL_REJECTED');
  assert.deepEqual(safeCodes({errors:[{code:7500},{code:'not-a-number'}]}),[7500]);
});
