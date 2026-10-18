import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';

// WEB-04B-7E: use actual workerd/Miniflare with a disposable in-memory D1.
// No Cloudflare token, Cron, R2, route, secret, wrangler deploy or remote DB.
const WORKER_ENTRY='backend/web04b7-staging-readonly.js';
const MODE='storm-web04b7d-synthetic-readonly';
const STAGING_DB='99999999-9999-4999-8999-999999999999';
const STORM='STC-STAGE-SYNTH';
const BASE='https://isolated-staging.invalid';
const compatibilityDate='2026-08-05';
const mf=new Miniflare({
  scriptPath:WORKER_ENTRY,
  modules:true,
  // Included backend/worker.js is ESM even without package.json "type": "module".
  modulesRules:[{type:'ESModule',include:['**/*.js']}],
  compatibilityDate,
  d1Databases:{DB:STAGING_DB},
  bindings:{STAGING_REVIEW_MODE:MODE}
});
async function request(path,method='GET') {
  const res=await mf.dispatchFetch(BASE+path,{method});
  return {status:res.status,body:await res.json()};
}
const completed=[];
try {
  const db=await mf.getD1Database('DB');
  await db.prepare('CREATE TABLE storms(id TEXT PRIMARY KEY,merged_into_id TEXT)').run();
  await db.prepare(`CREATE TABLE advisories(
    id TEXT PRIMARY KEY, storm_id TEXT NOT NULL, agency TEXT NOT NULL,
    issued_at TEXT NOT NULL, fetched_at TEXT, source_code TEXT,
    source_url TEXT, raw_object_key TEXT, parser_version TEXT,
    point_count INTEGER, ingest_status TEXT NOT NULL)`).run();
  await db.prepare('CREATE INDEX idx_advisories_storm_time ON advisories(storm_id, issued_at DESC)').run();
  await db.prepare('INSERT INTO storms(id,merged_into_id) VALUES (?,?)').bind(STORM,null).run();
  const sql=`INSERT INTO advisories(
    id,storm_id,agency,issued_at,fetched_at,source_code,source_url,
    raw_object_key,parser_version,point_count,ingest_status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`;
  const insert=[];
  for(let i=0;i<205;i++){
    const rowId='advisory-'+String(i).padStart(6,'0');
    const issuedAt=new Date(Date.parse('2026-08-05T18:00:00.000Z')-Math.floor(i/2)*60000).toISOString();
    insert.push(db.prepare(sql).bind(rowId,STORM,
      ['JMA','CMA','HKO','CWA'][i%4],issuedAt,issuedAt,
      'synthetic','https://example.invalid',null,'fixture',1,'complete'));
  }
  for(let i=0;i<insert.length;i+=40)await db.batch(insert.slice(i,i+40));
  const before=await db.prepare('SELECT COUNT(*) AS n FROM advisories').first();
  assert.equal(before.n,205);
  const health=await request('/__staging__/health');
  assert.equal(health.status,200,JSON.stringify(health.body));
  assert.deepEqual(health.body,{ok:true,stage:'synthetic-readonly'});
  completed.push('health');

  // No admin, collector, proxy, R2 probe, generic health or write entrypoint exposed.
  const deniedPaths=['/health','/probe/database','/probe/cwa',
    '/api/admin/collect','/api/admin/repair-identities',
    '/api/history/storms','/api/history/latest?agency=JMA'];
  for(const path of deniedPaths) {
    const result=await request(path);
    assert.equal(result.status,404,path);
  }
  for(const method of ['POST','PUT','PATCH','DELETE']){
    const result=await request('/api/admin/collect',method);
    assert.equal(result.status,405,method);
  }
  completed.push('route-denials');

  const path='/api/history/storms/'+STORM+'/advisories';
  const legacy=await request(path+'?limit=200');
  assert.equal(legacy.status,200,JSON.stringify(legacy.body));
  assert.deepEqual(Object.keys(legacy.body).sort(),['advisories','stormId','version']);
  assert.equal(legacy.body.advisories.length,200);
  completed.push('legacy-shape');

  const all=[];
  let cursor=null,pages=0;
  do{
    const q='?paging=cursor&limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):'');
    const current=await request(path+q);
    assert.equal(current.status,200,JSON.stringify(current.body));
    assert.equal(current.body.pagination.count,current.body.advisories.length);
    for(const row of current.body.advisories){
      if(all.length){
        const prev=all.at(-1);
        assert.ok(prev.issued_at>row.issued_at
          ||(prev.issued_at===row.issued_at&&prev.id>row.id));
      }
      all.push(row);
    }
    pages++;
    assert.ok(pages<10);
    if(!current.body.pagination.hasMore)break;
    cursor=current.body.pagination.nextCursor;
  }while(true);
  assert.equal(pages,3);
  assert.equal(all.length,205);
  assert.equal(new Set(all.map(x=>x.id)).size,205);
  completed.push('cursor-keyset');

  const bad=await request(path+'?paging=cursor&limit=100&cursor=v1.bad');
  assert.equal(bad.status,400);
  completed.push('cursor-validation');

  const after=await db.prepare('SELECT COUNT(*) AS n FROM advisories').first();
  assert.equal(after.n,205);
  completed.push('no-sql-write-observed');
  console.log(JSON.stringify({contract:'storm-web04b7e-isolated-staging-workerd/v1',
    workerd: true,compatibilityDate,advisories:all.length,pages,
    assertions:completed,productionAccess:false,stagingDeployed:false,
    cronExportExpected:false,r2BindingDeclared:false,adminSecretsDeclared:false}));
}finally{
  await mf.dispose();
}
