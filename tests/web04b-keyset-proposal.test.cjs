'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const keyset = require('../analysis/archive-advisory-keyset-proposal.js');
const client = require('../analysis/archive-advisory-cursor.js');

const STORM = 'STC-2026-FIXTURE';
const OTHERS = 'STC-2026-OTHER';
const AGENCIES = ['HKO','CMA','JMA','CWA'];
function fixture(count, stormId=STORM) {
  const origin = Date.parse('2026-10-16T18:00:00.000Z');
  return Array.from({length:count}, (_,i)=>({
    id:'ADV-'+String(i+1).padStart(6,'0'),
    storm_id:stormId,
    agency:AGENCIES[i%4],
    ingest_status:'complete',
    issued_at:new Date(origin-Math.floor(i/3)*60000).toISOString(),
    fetched_at:'2026-10-17T00:00:00.000Z',
    parser_version:'fixture',
    point_count:3
  }));
}
function sqlOrder(a,b) {
  if(a.issued_at>b.issued_at)return -1;
  if(a.issued_at<b.issued_at)return 1;
  if(a.id>b.id)return -1;
  if(a.id<b.id)return 1;
  return 0;
}
function fakeD1(rows, ctx, cursor) {
  const built=keyset.buildQuery(ctx,cursor);
  assert.equal(built.params[0],ctx.stormId);
  assert.match(built.sql,/ORDER BY issued_at DESC, id DESC LIMIT \?/);
  assert.match(built.sql,/ingest_status='complete'/);
  assert.equal(built.params.at(-1),ctx.limit+1);
  const anchor=cursor?keyset.decodeCursor(cursor,ctx):null;
  const matches=rows.filter(r=>r.storm_id===ctx.stormId
    &&r.ingest_status==='complete'
    &&(!ctx.agency||r.agency===ctx.agency)
    &&(!anchor||keyset.strictlyOlder(anchor,r)));
  const selected=matches.sort(sqlOrder).slice(0,ctx.limit+1);
  return keyset.buildResponse(ctx,selected,'3.3.0-alpha.4-proposal');
}
function replay(rows,ctx) {
  let state={advisories:[],seenCursors:[],nextCursor:null,hasMore:false};
  let count=0;
  do {
    const response=fakeD1(rows,ctx,state.nextCursor);
    const after=client.appendAdvisoryPage(state.advisories,response,{
      ...ctx,cursor:state.nextCursor,seenCursors:state.seenCursors
    });
    assert.equal(after.supported,true);
    state=after;
    count++;
    assert.ok(count<100,'no cursor loop');
  } while(state.hasMore);
  assert.equal(state.complete,true);
  return {state,count};
}

test('0/1/199/200/201/748 advisories complete without omissions or duplicates',()=>{
  for(const n of [0,1,199,200,201,748]) {
    const rows=fixture(n).concat(fixture(15,OTHERS));
    const result=replay(rows,{stormId:STORM,agency:null,limit:200});
    assert.equal(result.state.advisories.length,n,'length '+n);
    assert.equal(new Set(result.state.advisories.map(x=>x.id)).size,n);
    assert.deepEqual(result.state.advisories,fixture(n).sort(sqlOrder));    assert.equal(result.count,Math.max(1,Math.ceil(n/200)),'page count '+n);
  }
});
test('agency filter and cross-storm records never leak',()=>{
  const rows=fixture(748).concat(fixture(300,OTHERS));
  rows.push({...fixture(1)[0],id:'BROKEN',ingest_status:'failed'});
  const ctx={stormId:STORM,agency:'JMA',limit:50};
  const result=replay(rows,ctx);
  assert.equal(result.state.advisories.length,187);
  assert.ok(result.state.advisories.every(x=>x.storm_id===STORM&&x.agency==='JMA'));
  const first=fakeD1(rows,ctx,null);
  assert.throws(()=>keyset.decodeCursor(first.pagination.nextCursor,
    {stormId:OTHERS,agency:'JMA',limit:50}),/context/);
  assert.throws(()=>keyset.decodeCursor(first.pagination.nextCursor,
    {stormId:STORM,agency:'CMA',limit:50}),/context/);
  assert.throws(()=>keyset.decodeCursor(first.pagination.nextCursor,
    {stormId:STORM,agency:'JMA',limit:51}),/context/);
});
test('strict cursor rejects invalid, tampered, noncanonical and oversized inputs',()=>{
  const ctx={stormId:STORM,agency:null,limit:2};
  const cursor=keyset.encodeCursor(ctx,fixture(1)[0]);
  assert.ok(cursor.startsWith('v1.'));
  const anchor=keyset.decodeCursor(cursor,ctx);
  assert.equal(anchor.id,'ADV-000001');
  for(const bad of ['v2.invalid','v1.!!!','v1.','v1.'+'x'.repeat(3000),cursor+'=']) {
    assert.throws(()=>keyset.decodeCursor(bad,ctx));
  }
  assert.throws(()=>keyset.decodeCursor(cursor.slice(0,-3)+'xxx',ctx));
  assert.throws(()=>keyset.encodeCursor(ctx,{issued_at:'2026-02-30T00:00:00.000Z',id:'x'}));
  assert.throws(()=>keyset.buildQuery({stormId:STORM,agency:'ANY',limit:20}),/agency/);
  assert.throws(()=>keyset.buildQuery({stormId:STORM,agency:null,limit:201}),/limit/);
});
test('SQL statement uses bound parameters; never interpolates storm ID',()=>{
  const storm="STC'; DELETE FROM advisories; --";
  const ctx={stormId:storm,agency:'hko',limit:2};
  const query=keyset.buildQuery(ctx);
  assert.equal(query.params[0],storm);
  assert.equal(query.params[1],'HKO');
  assert.ok(!query.sql.includes(storm));
  const page=keyset.buildResponse(ctx,[], 'fixture');
  assert.equal(page.pagination.hasMore,false);
});
test('tied timestamps require descending ID order on page and across boundary',()=>{
  const ctx={stormId:STORM,agency:null,limit:2};
  const items=fixture(4);
  const order=items.slice().sort(sqlOrder);
  const first=keyset.buildResponse(ctx,order.slice(0,3),'fixture');
  assert.deepEqual(first.advisories.map(x=>x.id),order.slice(0,2).map(x=>x.id));
  const next=fakeD1(items,ctx,first.pagination.nextCursor);
  const second=client.appendAdvisoryPage(first.advisories,next,{
    ...ctx,cursor:first.pagination.nextCursor,seenCursors:[first.pagination.nextCursor]
  });
  assert.equal(second.complete,true);
  assert.equal(second.advisories.length,4);
  assert.throws(()=>keyset.buildResponse(ctx,[order[1],order[0]],'fixture'),/unordered/);
});
test('concurrent later advisories do not replay before anchor; backfilled older items may appear',()=>{
  const ctx={stormId:STORM,agency:null,limit:2};
  const rows=fixture(5);
  const first=fakeD1(rows,ctx,null);
  const originalFirst=first.advisories.map(x=>x.id);
  const newlyIssued={...rows[0],id:'NEW-LATEST',issued_at:'2026-10-17T08:00:00.000Z'};
  const backfill={...rows[4],id:'BACKFILL',issued_at:'2026-10-16T17:57:30.000Z'};
  const after=fakeD1(rows.concat([newlyIssued,backfill]),ctx,first.pagination.nextCursor);
  assert.deepEqual(first.advisories.map(x=>x.id),originalFirst);
  assert.ok(after.advisories.every(x=>x.id!=='NEW-LATEST'));
  let outcome=client.appendAdvisoryPage(first.advisories,after,{
    ...ctx,cursor:first.pagination.nextCursor,seenCursors:[first.pagination.nextCursor]
  });
  if(outcome.hasMore) {
    const finish=fakeD1(rows.concat([newlyIssued,backfill]),ctx,outcome.nextCursor);
    outcome=client.appendAdvisoryPage(outcome.advisories,finish,{
      ...ctx,cursor:outcome.nextCursor,seenCursors:outcome.seenCursors
    });
  }
  assert.ok(outcome.advisories.some(x=>x.id==='BACKFILL'));
  assert.ok(!outcome.advisories.some(x=>x.id==='NEW-LATEST'));
  // This is best-effort continuation, NOT a transactional historical snapshot.
});
test('malformed D1 response with cross-storm or duplicate rows fails closed',()=>{
  const ctx={stormId:STORM,agency:null,limit:2};
  const rows=fixture(2);
  assert.throws(()=>keyset.buildResponse(ctx,[rows[0],rows[0]],'fixture'),/duplicated/);
  assert.throws(()=>keyset.buildResponse(ctx,[{...rows[0],storm_id:OTHERS}],'fixture'),/Invalid/);
  assert.throws(()=>keyset.buildResponse(ctx,Array.from({length:4},()=>rows[0]),'fixture'),/page size/);
});
