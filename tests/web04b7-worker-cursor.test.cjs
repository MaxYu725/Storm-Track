'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');

// Load actual standalone Worker source as ESM, without deploying, binding
// external resources, or making any production network requests.
const source=readFileSync(join(__dirname,'../backend/worker.js'),'utf8');
const workerPromise=import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const STORM='STC-2026-TEST';
const ALIAS='STC-ALIAS';
const ANOTHER='STC-OTHER';
const agencies=['HKO','CMA','JMA','CWA'];
const origin=Date.parse('2026-10-17T18:00:00.000Z');
function makeRows(n,stormId=STORM) {
  return Array.from({length:n},(_,i)=>({
    id:'adv-'+String(i+1).padStart(8,'0'),
    storm_id:stormId,
    agency:agencies[i%4],
    issued_at:new Date(origin-Math.floor(i/2)*60000).toISOString(),
    fetched_at:'2026-10-17T19:00:00.000Z',
    source_code:'test',
    source_url:'https://example.invalid',
    raw_object_key:null,
    parser_version:'synthetic',
    point_count:1,
    ingest_status:'complete'
  }));
}
function stableCompare(a,b){
  return a.issued_at>b.issued_at?-1:a.issued_at<b.issued_at?1:a.id>b.id?-1:a.id<b.id?1:0;
}
function makeD1(input=[]) {
  const records=input.slice();
  const calls=[];
  let writes=0;
  const db={
    prepare(sql) {
      calls.push({sql,params:null});
      if(!/^SELECT\b/i.test(sql.trim())){writes++;throw Error('Test DB refuses non-SELECT');}
      const idx=calls.length-1;
      return {bind(...params) {
        calls[idx].params=params;
        return {
          async first(){
            if(!sql.includes('FROM storms'))throw Error('Unexpected first query');
            return {merged_into_id: params[0]===ALIAS?STORM:null};
          },
          async all(){
            if(!sql.includes('FROM advisories'))throw Error('Unexpected all query');
            let cursor=null,agency=null;
            const newMode=sql.includes('ORDER BY issued_at DESC, id DESC LIMIT ?');
            assert.match(sql,/storm_id=\?/);
            assert.match(sql,/ingest_status='complete'/);
            let p=1;
            if(sql.includes('agency=?'))agency=params[p++];
            if(sql.includes('(issued_at < ? OR (issued_at = ? AND id < ?))')){
              cursor={issued_at:params[p],id:params[p+2]};
              assert.equal(params[p],params[p+1]);
              p+=3;
            }
            const lim=params[p++];
            assert.equal(p,params.length);
            assert.ok(lim>=1 && lim<=201);
            const r=records.filter(x=>x.storm_id===params[0]&&x.ingest_status==='complete'
              &&(!agency||x.agency===agency)
              &&(!cursor||x.issued_at<cursor.issued_at
                ||(x.issued_at===cursor.issued_at&&x.id<cursor.id)));
            r.sort(stableCompare);
            return {results:r.slice(0,lim).map(({ingest_status,...row})=>row)};
          }
        };
      }};
    }
  };
  return {db,calls,getWrites:()=>writes};
}
async function get(url,db){
  const worker=(await workerPromise).default;
  const resp=await worker.fetch(new Request('https://storm.example.invalid'+url),{DB:db});
  return {status:resp.status,body:await resp.json(),headers:resp.headers};
}
function firstUrl({stormId=STORM,limit=200,agency=null}={}){
  return '/api/history/storms/'+encodeURIComponent(stormId)+'/advisories?paging=cursor&limit='+limit
   +(agency?'&agency='+agency:'');
}
async function replay(n,{limit=200,agency=null,stormId=STORM}={}){
  const {db,calls,getWrites}=makeD1(makeRows(n,stormId).concat(makeRows(17,ANOTHER)));
  let url=firstUrl({stormId,limit,agency});
  const seen=new Set(),all=[];
  let pages=0;
  while(true){
    const r=await get(url,db);
    assert.equal(r.status,200);
    const b=r.body;
    assert.equal(b.pagination.contract,'storm-history-advisory-cursor/v1');
    assert.equal(b.pagination.order,'issued_at_desc,id_desc');
    assert.equal(b.pagination.count,b.advisories.length);
    assert.ok(b.pagination.count<=limit);
    for(const item of b.advisories){
      assert.equal(item.storm_id,stormId);
      if(agency)assert.equal(item.agency,agency);
      assert.equal(seen.has(item.id),false);
      if(all.length)assert.ok(stableCompare(all.at(-1),item)<0);
      seen.add(item.id);all.push(item);
    }
    pages++;
    assert.ok(pages<100);
    if(!b.pagination.hasMore){
      assert.equal(b.pagination.nextCursor,null);
      break;
    }
    assert.ok(b.pagination.nextCursor?.startsWith('v1.'));
    url=firstUrl({stormId,limit,agency})+'&cursor='+encodeURIComponent(b.pagination.nextCursor);
  }
  assert.equal(getWrites(),0);
  return {rows:all,calls,pages};
}
test('Actual standalone Worker paginates 0/1/199/200/201/748 correctly',async()=>{
  for(const n of [0,1,199,200,201,748]){
    const r=await replay(n);
    assert.equal(r.rows.length,n);
    assert.equal(r.pages,Math.max(1,Math.ceil(n/200)),'page count n='+n);
    const pagedCalls=r.calls.filter(x=>x.sql.includes('FROM advisories'));
    assert.equal(pagedCalls.length,r.pages);
    assert.ok(pagedCalls.every(x=>x.sql.includes('ORDER BY issued_at DESC, id DESC LIMIT ?')));
  }
});
test('Legacy query response remains unchanged and does not expose pagination',async()=>{
  const fixture=makeRows(210);
  const {db,calls,getWrites}=makeD1(fixture);
  const r=await get('/api/history/storms/'+STORM+'/advisories?limit=201&agency=bogus',db);
  assert.equal(r.status,200);
  assert.deepEqual(Object.keys(r.body).sort(),['advisories','stormId','version']);
  assert.equal(r.body.advisories.length,200); // legacy clamps max
  assert.equal(calls.filter(x=>x.sql.includes('FROM advisories')).length,1);
  assert.match(calls.at(-1).sql,/ORDER BY issued_at DESC LIMIT \?/);
  assert.equal(getWrites(),0);
});
test('Agency filter and aliases are scoped by canonical storm ID',async()=>{
  const filtered=await replay(748,{limit:50,agency:'JMA'});
  assert.equal(filtered.rows.length,187);
  const {db}=makeD1(makeRows(220));
  const first=await get(firstUrl({stormId:ALIAS}),db);
  assert.equal(first.status,200);
  assert.equal(first.body.stormId,STORM);
  assert.equal(first.body.pagination.hasMore,true);
  const next=await get(firstUrl({stormId:STORM})+'&cursor='+encodeURIComponent(first.body.pagination.nextCursor),db);
  assert.equal(next.status,200);
  const mismatch=await get(firstUrl({stormId:ANOTHER})+'&cursor='+encodeURIComponent(first.body.pagination.nextCursor),db);
  assert.equal(mismatch.status,400);
});
test('Cursor cannot be forged across storm, agency or limit',async()=>{
  const {db,calls}=makeD1(makeRows(222));
  const first=await get(firstUrl({limit:100}),db);
  const token=first.body.pagination.nextCursor;
  assert.ok(token);
  for(const u of [
    firstUrl({limit:200})+'&cursor='+encodeURIComponent(token),
    firstUrl({limit:100,agency:'HKO'})+'&cursor='+encodeURIComponent(token),
    firstUrl({stormId:ANOTHER,limit:100})+'&cursor='+encodeURIComponent(token),
    firstUrl({limit:100})+'&cursor=v1.invalid',
    firstUrl({limit:100})+'&cursor='+encodeURIComponent(token+'='),
    firstUrl({limit:100})+'&cursor='+'x'.repeat(2050),
    '/api/history/storms/'+STORM+'/advisories?cursor='+encodeURIComponent(token),
    firstUrl({limit:100})+'&limit=100',
    firstUrl({limit:100})+'&agency=HKO&agency=CMA',
    firstUrl({limit:100})+'&tracking=1'
  ]){
    const result=await get(u,db);
    assert.equal(result.status,400,'expected 400 for '+u.slice(0,110));
    assert.equal(result.body.error,'Invalid advisory pagination request');
  }
  const advisoryCalls=calls.filter(x=>x.sql.includes('FROM advisories'));
  assert.equal(advisoryCalls.length,1,'no invalid requests reached advisory D1 query');
});
test('Opt-in uses strict limit and agency while legacy retains permissive clamping',async()=>{
  const {db}=makeD1(makeRows(10));
  for(const u of [
    '/api/history/storms/'+STORM+'/advisories?paging=cursor&limit=0',
    '/api/history/storms/'+STORM+'/advisories?paging=cursor&limit=201',
    '/api/history/storms/'+STORM+'/advisories?paging=cursor&limit=2.5',
    '/api/history/storms/'+STORM+'/advisories?paging=cursor&limit=',
    '/api/history/storms/'+STORM+'/advisories?paging=cursor&agency=',
    '/api/history/storms/'+STORM+'/advisories?paging=cursor&agency=INVALID',
    '/api/history/storms/'+STORM+'/advisories?paging=bogus'
  ])assert.equal((await get(u,db)).status,400);
  assert.equal((await get('/api/history/storms/'+STORM+'/advisories?limit=0',db)).status,200);
});
test('Malformed database data fails closed with generic 503 and no leak',async()=>{
  const good=makeRows(2);
  const {db}=makeD1(good.map((x,i)=>i?{...x,issued_at:'not-a-date'}:x));
  assert.equal((await get(firstUrl({limit:2}),db)).status,503);
  const bad=makeD1([{...good[0],id:'💥'}]);
  const result=await get(firstUrl({limit:1}),bad.db);
  assert.equal(result.status,503);
  assert.ok(!JSON.stringify(result.body).includes('💥'));
});
test('Newer bulletin is not reintroduced mid-replay; older backfill may appear',async()=>{
  const rows=makeRows(5);
  const data=makeD1(rows);
  const initial=await get(firstUrl({limit:2}),data.db);
  const c=initial.body.pagination.nextCursor;
  // For next page, create a different database version with new and backfilled rows.
  const later={...rows[0],id:'adv-newer',issued_at:'2026-10-18T00:00:00.000Z'};
  const backfill={...rows[4],id:'adv-backfill',issued_at:'2026-10-17T17:58:30.000Z'};
  const updated=makeD1([...rows,later,backfill]);
  const next=await get(firstUrl({limit:2})+'&cursor='+encodeURIComponent(c),updated.db);
  assert.equal(next.status,200);
  assert.ok(next.body.advisories.every(x=>x.id!=='adv-newer'));
  // This does not establish a repeatable-read transactional snapshot.
});

test('D1 alias-resolution failure is a generic 503 and does not leak internal SQL errors',async()=>{
  const db={prepare(){throw Error('Sensitive D1 driver error: internal-state-abcdef');}};
  const response=await get(firstUrl({limit:25}),db);
  assert.equal(response.status,503);
  assert.equal(response.body.contract,'storm-history-advisory-cursor/v1');
  assert.equal(response.body.error,'Historical advisory paging temporarily unavailable');
  assert.equal(JSON.stringify(response.body).includes('internal-state-abcdef'),false);
});
