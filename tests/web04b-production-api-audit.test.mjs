import test from 'node:test';
import assert from 'node:assert/strict';
import {probeArchiveAdvisoryApi, parseArgs, safeOrigin} from '../scripts/audit-web04b-production-api.mjs';

const STORM = 'STC-2026-TEST';
const CONTRACT = 'storm-history-advisory-cursor/v1';
const ORDER = 'issued_at_desc,id_desc';
function row(id, hour) {
  return {
    id,storm_id:STORM,agency:'HKO',
    issued_at:new Date(Date.parse('2026-10-17T10:00:00Z')-hour*3600000).toISOString()
  };
}
function response(body, status=200) {
  return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
}
function page(rows,hasMore,nextCursor,limit=2) {
  return {stormId:STORM,advisories:rows,pagination:{
    contract:CONTRACT,order:ORDER,hasMore,nextCursor,limit,count:rows.length
  }};
}

test('strict origin parser rejects credentials and non-HTTPS transports',()=>{
  assert.equal(safeOrigin('https://storm.max-yu.workers.dev'),'https://storm.max-yu.workers.dev');
  assert.throws(()=>safeOrigin('http://storm.max-yu.workers.dev'),/HTTPS/);
  assert.throws(()=>safeOrigin('https://user:password@storm.max-yu.workers.dev'),/HTTPS/);
  assert.throws(()=>safeOrigin('https://storm.max-yu.workers.dev/a?b=1'),/HTTPS/);
  assert.deepEqual(parseArgs(['--storm-id','STC','--base','https://example.workers.dev']),{
    stormId:'STC',base:'https://example.workers.dev'
  });
});

test('probe selects a high-count storm then validates two cursor pages with GET only',async()=>{
  let calls=0;
  const fetchImpl=async (input,opts)=>{
    calls++;
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'error');
    assert.equal(opts.headers.Accept,'application/json');
    const url=new URL(input);
    if(url.pathname.endsWith('/storms'))return response({storms:[
      {id:'LOW',advisory_count:3},{id:STORM,advisory_count:235}
    ]});
    assert.match(url.pathname,/\/storms\/STC-2026-TEST\/advisories$/);
    if(!url.searchParams.has('cursor'))return response(page([row('Z',0),row('Y',1)],true,'opaque-cursor'));
    assert.equal(url.searchParams.get('cursor'),'opaque-cursor');
    return response(page([row('X',2)],false,null));
  };
  const result=await probeArchiveAdvisoryApi({fetchImpl});
  assert.equal(result.outcome,'cursor-contract-two-pages-verified');
  assert.equal(result.requests,3);
  assert.equal(result.reportedCount,235);
  assert.equal(result.distinctRecordsVerified,3);
  assert.equal(result.cursorSupported,true);
  assert.equal(result.hasFurtherPages,false);
  assert.equal(result.stormIdSha256Prefix.length,16);
  assert.equal(result.stormId,undefined,'audit should not print raw storm ID');
  assert.equal(calls,3);
});

test('legacy API is recognized without ever guessing a cursor',async()=>{
  let calls=0;
  const fetchImpl=async (_url,opts)=>{
    calls++;
    assert.equal(opts.method,'GET');
    return response({stormId:STORM,advisories:[row('A',0),row('B',1)]});
  };
  const result=await probeArchiveAdvisoryApi({stormId:STORM,fetchImpl});
  assert.equal(result.outcome,'legacy-no-cursor-contract');
  assert.equal(result.cursorSupported,false);
  assert.equal(result.requests,1);
  assert.equal(calls,1);
});

test('replayed cursor pages fail audit instead of reporting success',async()=>{
  let calls=0;
  const fetchImpl=async ()=>{
    calls++;
    return calls===1?response(page([row('Z',0),row('Y',1)],true,'cursor-two'))
      :response(page([row('Y',1)],false,null));
  };
  await assert.rejects(()=>probeArchiveAdvisoryApi({stormId:STORM,fetchImpl}),/重複/);
  assert.equal(calls,2);
});

test('probe never uses unbounded requests when there are no storms',async()=>{
  const fetchImpl=async()=>response({storms:[]});
  const result=await probeArchiveAdvisoryApi({fetchImpl});
  assert.equal(result.outcome,'no-storm-records');
  assert.equal(result.requests,1);
});
