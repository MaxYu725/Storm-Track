// WEB-04B-7B: entirely local Miniflare/workerd + disposable D1 SQLite.
// Run only in a GitHub Actions isolated runner after installing miniflare.
// Does not use wrangler deploy, Cloudflare credentials, or remote D1.
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';

const dbId='11111111-1111-4111-8111-111111111111';
const mf=new Miniflare({
  modules:true,
  scriptPath:'backend/worker.js',
  // The pinned local workerd binary supports at most 2026-08-06.
  // Emulator parity is a smoke test, NOT proof of the live compatibility date.
  compatibilityDate:'2026-08-01',
  d1Databases:{DB:dbId},
  // No R2 bucket, secrets, production env IDs or upstream requests.
});
function t(i){
  return new Date(Date.parse('2026-10-17T20:00:00.000Z')-Math.floor(i/2)*60000).toISOString();
}
const STORM='STC-TEST-LOCAL';
const OTHER='STC-TEST-UNRELATED';
async function fetchArchive(path){
  const r=await mf.dispatchFetch('https://local-worker.invalid'+path);
  return {status:r.status,data:await r.json()};
}
try{
  const db=await mf.getD1Database('DB');
  await db.exec(`CREATE TABLE storms(id TEXT PRIMARY KEY,merged_into_id TEXT);
CREATE TABLE advisories(
  id TEXT PRIMARY KEY,
  storm_id TEXT NOT NULL,
  agency TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  fetched_at TEXT,
  source_code TEXT,
  source_url TEXT,
  raw_object_key TEXT,
  parser_version TEXT,
  point_count INTEGER,
  ingest_status TEXT NOT NULL
);
CREATE INDEX idx_advisories_storm_time ON advisories(storm_id, issued_at DESC);`);
  await db.prepare('INSERT INTO storms(id,merged_into_id) VALUES (?,?)')
    .bind(STORM,null).run();
  await db.prepare('INSERT INTO storms(id,merged_into_id) VALUES (?,?)')
    .bind(OTHER,null).run();
  const insert=`INSERT INTO advisories
   (id,storm_id,agency,issued_at,fetched_at,source_code,source_url,raw_object_key,parser_version,point_count,ingest_status)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)`;
  const stmts=[];
  for(let i=0;i<748;i++){
    stmts.push(db.prepare(insert).bind(
      'adv-'+String(i).padStart(6,'0'),STORM,
      ['JMA','CMA','HKO','CWA'][i%4],t(i),t(i),'local-fixture',
      'https://example.invalid',null,'mock',0,'complete'
    ));
  }
  for(let i=0;i<20;i++){
    stmts.push(db.prepare(insert).bind(
      'other-'+i,OTHER,'HKO',t(i),t(i),'local-fixture',
      'https://example.invalid',null,'mock',0,'complete'
    ));
  }
  for(let i=0;i<stmts.length;i+=50)await db.batch(stmts.slice(i,i+50));
  const legacy=await fetchArchive('/api/history/storms/'+STORM+'/advisories?limit=200');
  assert.equal(legacy.status,200);
  assert.deepEqual(Object.keys(legacy.data).sort(),['advisories','stormId','version']);
  assert.equal(legacy.data.advisories.length,200);
  let cursor=null;
  const all=[];
  let pages=0;
  do{
    const q='?paging=cursor&limit=200'+(cursor?'&cursor='+encodeURIComponent(cursor):'');
    const response=await fetchArchive('/api/history/storms/'+STORM+'/advisories'+q);
    assert.equal(response.status,200,JSON.stringify(response.data));
    const data=response.data;
    assert.equal(data.pagination.contract,'storm-history-advisory-cursor/v1');
    assert.equal(data.pagination.count,data.advisories.length);
    if(all.length&&data.advisories.length){
      const prev=all.at(-1), next=data.advisories[0];
      assert.ok(prev.issued_at>next.issued_at||
        (prev.issued_at===next.issued_at&&prev.id>next.id));
    }
    all.push(...data.advisories);
    pages++;
    assert.ok(pages<8);
    cursor=data.pagination.nextCursor;
    if(!data.pagination.hasMore){
      assert.equal(cursor,null);
      break;
    }
    assert.ok(cursor?.startsWith('v1.'));
  }while(true);
  assert.equal(all.length,748);
  assert.equal(new Set(all.map(r=>r.id)).size,748);
  assert.equal(pages,4);
  assert.deepEqual(all.map(r=>r.id),
    [...all].sort((a,b)=>b.issued_at.localeCompare(a.issued_at)||b.id.localeCompare(a.id))
      .map(r=>r.id)); // Canonical UTC / ASCII fixture comparator
  const invalid=await fetchArchive(
    '/api/history/storms/'+STORM+'/advisories?paging=cursor&limit=200&cursor=v1.invalid');
  assert.equal(invalid.status,400);
  const withAgency=await fetchArchive(
    '/api/history/storms/'+STORM+'/advisories?paging=cursor&limit=200&agency=JMA');
  assert.equal(withAgency.status,200);
  assert.ok(withAgency.data.advisories.every(r=>r.agency==='JMA'));
  const unrelated=await fetchArchive(
    '/api/history/storms/'+OTHER+'/advisories?paging=cursor&limit=200');
  assert.equal(unrelated.status,200);
  assert.equal(unrelated.data.advisories.length,20);
  console.log(JSON.stringify({
    contract:'storm-web04b7b-local-miniflare/v1',
    engine:'local Miniflare workerd with in-memory isolated D1',
    advisoriesValidated:748,pages,validBoundary:true,
    agencyFiltered:true,crossStormIsolation:true,legacyUnchanged:true,
    malformedCursorRejected:true,productionAccess:false
  }));
} finally {
  await mf.dispose();
}
