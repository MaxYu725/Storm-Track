import assert from 'node:assert/strict';
import { buildWeightedConsensusTrack, buildWeightedHongKongImpact } from '../workers/storm-analysis/src/weighted-consensus.js';
import { buildAnalysisCacheIdentity, createAnalysisCacheRepository } from '../workers/storm-analysis/src/analysis-cache-repository.js';
import { runAnalysisWithCache, handleRequest } from '../workers/storm-analysis/src/index.js';

const H=60*60*1000, base=Date.parse('2026-08-21T00:00:00Z');
const point=(h,lat,lon)=>({timeMs:base+h*H,time:new Date(base+h*H).toISOString(),lat,lon});
function interp(track,t){if(t<track[0].timeMs||t>track.at(-1).timeMs)return null;const exact=track.find(p=>p.timeMs===t);if(exact)return exact;for(let i=1;i<track.length;i++){if(t<=track[i].timeMs){const a=track[i-1],b=track[i],r=(t-a.timeMs)/(b.timeMs-a.timeMs);return point((t-base)/H,a.lat+(b.lat-a.lat)*r,a.lon+(b.lon-a.lon)*r)}}return null}
const impactEngine={
  buildSourceTrack(source){return source?.track||[]}, interpolateTrackAtTime:interp,
  haversineKm(a,b,c,d){return Math.hypot(c-a,d-b)*100},
  calculateContinuousNearest(track){return {...track.reduce((x,y)=>y.distanceToHongKongKm<x.distanceToHongKongKm?y:x),distanceKm:Math.min(...track.map(x=>x.distanceToHongKongKm)),method:'test'}},
  calculateBandIntervals(track,threshold){return threshold>=500?[{enterTime:track[0].time,exitTime:track.at(-1).time,durationHours:(track.at(-1).timeMs-track[0].timeMs)/H,startsInside:true,endsInside:true}]:[]}
};
const snapshot={referencePoint:{lat:0,lon:0},comparison:{referenceBaseTime:new Date(base).toISOString()},sources:{
  HKO:{track:[point(0,10,100),point(24,8,110),point(48,6,120)]},
  JMA:{track:[point(0,12,100),point(24,9,110),point(48,4,120)]},
  CMA:{track:[point(0,11,100),point(24,10,110)]}, CWA:{track:[]}
}};
const eq={HKO:.25,CMA:.25,JMA:.25,CWA:.25};
const model={modelVersion:'champion-10',weights:{schemaVersion:'storm-analysis-model-weights/v1',defaultWeights:eq,buckets:{'0-12h':eq,'12-24h':eq,'24-48h':{HKO:.2,CMA:.1,JMA:.6,CWA:.1},'48-72h':{HKO:.2,CMA:.1,JMA:.6,CWA:.1},'72-120h':eq,'120h+':eq}}};
{
  const track=buildWeightedConsensusTrack(snapshot,model,impactEngine,{stepHours:12});
  assert.equal(track.available,true); assert.deepEqual(track.points.map(p=>p.leadHours),[0,12,24,36,48]);
  const p36=track.points.find(p=>p.leadHours===36); assert.deepEqual(p36.agencies,['HKO','JMA']);
  assert.ok(Math.abs(p36.weights.HKO-.25)<1e-12); assert.ok(Math.abs(p36.weights.JMA-.75)<1e-12);
  const p24=track.points.find(p=>p.leadHours===24); assert.equal(p24.bucketId,'24-48h'); assert.equal(p24.agencyCount,3);
  const impact=buildWeightedHongKongImpact(track,snapshot.referencePoint,impactEngine);
  assert.equal(impact.available,true); assert.equal(impact.distanceBands['500'].intervals.length,1); assert.equal(impact.semantics.aiGenerated,false);
}

{
  const datelineSnapshot={...snapshot,sources:{HKO:{track:[point(0,10,179),point(24,8,179)]},JMA:{track:[point(0,10,-179),point(24,8,-179)]},CMA:{track:[]},CWA:{track:[]}}};
  const track=buildWeightedConsensusTrack(datelineSnapshot,model,impactEngine,{stepHours:24});
  assert.ok(Math.abs(Math.abs(track.points[0].lon)-180)<1);
}
{
  const inputA={sourceGroup:{key:'x',sources:{HKO:{bulletinTime:'2026-08-21T00:00:00Z'}}},generatedAt:'2026-08-21T01:00:00Z',compareLeadHours:24};
  const inputB={...inputA,generatedAt:'2026-08-21T02:00:00Z'};
  const a=await buildAnalysisCacheIdentity(inputA,model,'storm-analysis-orchestration/v2');
  const b=await buildAnalysisCacheIdentity(inputB,model,'storm-analysis-orchestration/v2');
  assert.equal(a.cacheKey,b.cacheKey);
  const c=await buildAnalysisCacheIdentity({...inputA,sourceGroup:{key:'y'}},model,'storm-analysis-orchestration/v2');
  assert.notEqual(a.cacheKey,c.cacheKey);
  const d=await buildAnalysisCacheIdentity(inputA,{...model,modelVersion:'champion-11'},'storm-analysis-orchestration/v2');
  assert.notEqual(a.cacheKey,d.cacheKey);
}
class Statement{constructor(db,sql){this.db=db;this.sql=sql;this.params=[]}bind(...x){this.params=x;return this}async first(){this.db.calls.push(['first',this.sql,this.params]);return this.db.row}async run(){this.db.calls.push(['run',this.sql,this.params]);return{success:true}}}
class Db{constructor(){this.calls=[];this.row=null}prepare(sql){return new Statement(this,sql)}}
{
  const db=new Db(),repo=createAnalysisCacheRepository(db); const identity={cacheKey:'k',advisoryFingerprint:'a',optionsFingerprint:'o',modelFingerprint:'mf',modelVersion:'m',orchestrationVersion:'v'};
  await repo.put(identity,{ok:true}); assert.ok(db.calls.some(x=>x[0]==='run'&&x[1].includes('ON CONFLICT(cache_key) DO NOTHING')));
  db.row={cache_key:'k',advisory_fingerprint:'a',model_fingerprint:'mf',model_version:'m',orchestration_version:'v',result_json:'{"ok":true}',created_at:'now'};
  assert.equal((await repo.get('k')).result.ok,true);
}
{
  let runs=0,puts=0; const modelRepo=()=>({async getChampion(){return model}}); const signalRepo=()=>({async getChampion(){return null}}); const orch=()=>({async run(){runs++;return{schemaVersion:'storm-analysis-orchestration/v2',value:runs}}});
  const cacheMiss=()=>({async get(){return null},async put(){puts++}}); const identity=async()=>({cacheKey:'k',advisoryFingerprint:'a',modelVersion:model.modelVersion,optionsFingerprint:'o'});
  let result=await runAnalysisWithCache({sourceGroup:{key:'x'}},{},{modelRepository:modelRepo,signalRiskRepository:signalRepo,orchestrator:orch,cacheRepository:cacheMiss,cacheIdentity:identity});
  assert.equal(result.cache.status,'miss-stored');assert.equal(runs,1);assert.equal(puts,1);
  const cacheHit=()=>({async get(){return{result:{schemaVersion:'storm-analysis-orchestration/v2',value:99},createdAt:'then'}},async put(){throw new Error('no')}});
  result=await runAnalysisWithCache({sourceGroup:{key:'x'}},{},{modelRepository:modelRepo,signalRiskRepository:signalRepo,orchestrator:orch,cacheRepository:cacheHit,cacheIdentity:identity});
  assert.equal(result.cache.status,'hit');assert.equal(result.analysis.value,99);assert.equal(runs,1);
}

{
  let runs=0; const modelRepo=()=>({async getChampion(){return model}}); const signalRepo=()=>({async getChampion(){return null}}); const orch=()=>({async run(){runs++;return{schemaVersion:'storm-analysis-orchestration/v2'}}});
  const brokenCache=()=>({async get(){throw new Error('missing table')},async put(){throw new Error('missing table')}}); const identity=async()=>({cacheKey:'broken',advisoryFingerprint:'adv',modelVersion:model.modelVersion,optionsFingerprint:'opt'});
  const result=await runAnalysisWithCache({sourceGroup:{key:'x'}},{},{modelRepository:modelRepo,signalRiskRepository:signalRepo,orchestrator:orch,cacheRepository:brokenCache,cacheIdentity:identity});
  assert.equal(runs,1); assert.equal(result.cache.status,'bypass-read-and-write-error');
}
{
  const deps={
    createModelRepository:()=>({async getChampion(){return model},async getByVersion(){return null}}),
    createSignalRiskRepository:()=>({async getChampion(){return null},async getById(){return null}}),
    createAnalysisOrchestrator:()=>({async run(){return{schemaVersion:'storm-analysis-orchestration/v2',deterministic:{weightedConsensusTrack:{available:true}}}}}),
    createAnalysisCacheRepository:()=>({async get(){return null},async put(){}}),
    buildAnalysisCacheIdentity:async()=>({cacheKey:'route',advisoryFingerprint:'adv',optionsFingerprint:'opt',modelVersion:model.modelVersion})
  };
  const response=await handleRequest(new Request('https://example.test/api/analysis/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sourceGroup:{key:'r'}})}),{ANALYSIS_DB:{}},deps);
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.analysis.schemaVersion,'storm-analysis-orchestration/v2');assert.equal(body.cache.status,'miss-stored');
  const health=await handleRequest(new Request('https://example.test/health'),{ANALYSIS_DB:{}},deps);const hb=await health.json();assert.equal(hb.deterministicAnalysisVersion,'storm-analysis-orchestration/v3');assert.equal(hb.analysisCacheVersion,'analysis-cache/v1');
}
console.log('storm-analysis AI-10 tests: OK');
