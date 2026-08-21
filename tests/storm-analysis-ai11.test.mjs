import assert from 'node:assert/strict';
import { createSignalRiskRepository } from '../workers/storm-analysis/src/signal-risk-repository.js';
import { buildAnalysisCacheIdentity } from '../workers/storm-analysis/src/analysis-cache-repository.js';
import { createAnalysisOrchestrator, ORCHESTRATION_VERSION } from '../workers/storm-analysis/src/analysis-orchestrator.js';
import { handleRequest, runAnalysisWithCache } from '../workers/storm-analysis/src/index.js';

const profile = {
  schemaVersion: 'hko-signal-calibration-profile/v1',
  profileId: 'profile-core',
  coverage: { distinctStorms: 12, eligibleSamples: 30 },
  config: { minimumStorms: 5 },
  cells: { global: { global: { stormCount: 12, sampleCount: 30, effectiveSampleCount: 12, probabilities: { T1: .9, T3: .6, T8: .2 } } }, distance: {}, distanceLead: {}, distanceLeadWind: {} }
};

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.params = []; }
  bind(...params) { this.params = params; return this; }
  async first() {
    this.db.calls.push({ sql: this.sql, params: this.params });
    if (this.sql.includes("role = 'champion'")) return this.db.champion;
    if (this.sql.includes('profile_id = ?1')) return this.db.byId.get(this.params[0]) || null;
    return null;
  }
}
class MockD1 {
  constructor() { this.calls = []; this.champion = null; this.byId = new Map(); }
  prepare(sql) { return new Statement(this, sql); }
}

{
  const db = new MockD1();
  db.champion = {
    profile_id: 'signal-profile-1', role: 'champion', training_window_start: '2020-01-01', training_window_end: '2025-12-31',
    storm_count: 12, sample_count: 30, profile_json: JSON.stringify(profile), metrics_json: '{"T8":{"brierScore":0.12}}',
    created_at: '2026-08-20', activated_at: '2026-08-21'
  };
  const result = await createSignalRiskRepository(db).getChampion();
  assert.equal(result.profileId, 'signal-profile-1');
  assert.equal(result.profile.schemaVersion, 'hko-signal-calibration-profile/v1');
  assert.equal(result.metrics.T8.brierScore, 0.12);
  assert.ok(db.calls.some(call => call.sql.includes("role = 'champion'")));
}

{
  const model = { modelVersion: 'm1', weights: { schemaVersion: 'storm-analysis-model-weights/v1', defaultWeights: { HKO: .25, CMA: .25, JMA: .25, CWA: .25 }, buckets: {} } };
  const input = { sourceGroup: { key: 'storm', sources: { HKO: { bulletinTime: '2026-08-21T00:00:00Z' } } } };
  const a = await buildAnalysisCacheIdentity(input, model, ORCHESTRATION_VERSION, { profileId: 'p1', profile });
  const b = await buildAnalysisCacheIdentity(input, model, ORCHESTRATION_VERSION, { profileId: 'p2', profile: { ...profile, profileId: 'changed' } });
  const c = await buildAnalysisCacheIdentity(input, model, ORCHESTRATION_VERSION, { profileId: 'p1', profile });
  assert.notEqual(a.cacheKey, b.cacheKey);
  assert.equal(a.cacheKey, c.cacheKey);
  assert.notEqual(a.signalProfileFingerprint, b.signalProfileFingerprint);
}

{
  const calls = [];
  const engines = {
    snapshot: {
      buildStormAnalysisSnapshot(group) { calls.push('snapshot'); return { schemaVersion: 'snap', generatedAt: '2026-08-21T00:00:00Z', storm: { key: group.key }, referencePoint: { lat: 22.3, lon: 114.2 }, sources: {}, comparison: { leadHours: 24, entries: [] } }; },
      haversineKm() { return 100; }
    },
    impact: { buildHongKongImpact() { calls.push('impact'); return { schemaVersion: 'impact', closestApproach: {} }; } },
    signal: { buildHkoSignalRiskInputs() { calls.push('signal'); return { schemaVersion: 'signal-inputs', officialHkoWarningContext: { provided: false } }; } },
    signalCalibration: {
      estimateHkoSignalRisk(profileArg, signalInputs, weightedImpact, weightedTrack) {
        calls.push('calibration');
        assert.equal(profileArg.schemaVersion, 'hko-signal-calibration-profile/v1');
        assert.equal(signalInputs.schemaVersion, 'signal-inputs');
        assert.equal(weightedImpact.schemaVersion, 'weighted-hk-impact/v1');
        assert.equal(weightedTrack.schemaVersion, 'weighted-consensus-track/v1');
        return { schemaVersion: 'hko-signal-risk-estimate/v1', available: true, probabilities: { T1: .9, T3: .6, T8: .2 } };
      }
    }
  };
  const modelRepository = { async getChampion() { return { modelVersion: 'm1', role: 'champion', persisted: true, weights: { schemaVersion: 'storm-analysis-model-weights/v1', defaultWeights: { HKO:.25,CMA:.25,JMA:.25,CWA:.25 }, buckets: {} } }; } };
  const signalRiskRepository = { async getChampion() { return { profileId: 'p1', role: 'champion', persisted: true, profile, stormCount: 12, sampleCount: 30 }; } };
  const result = await createAnalysisOrchestrator({ modelRepository, signalRiskRepository, engines }).run({ sourceGroup: { key: 'storm-x' } });
  assert.deepEqual(calls, ['snapshot', 'impact', 'signal', 'calibration']);
  assert.equal(result.schemaVersion, 'storm-analysis-orchestration/v3');
  assert.equal(result.deterministic.signalRisk.available, true);
  assert.equal(result.signalCalibration.profileId, 'p1');
  assert.equal(result.semantics.signalRiskProbabilitiesAreAppComputed, true);
  assert.equal(result.semantics.warningSignalPredictionIncluded, false);
}

{
  const engines = {
    snapshot: { buildStormAnalysisSnapshot(group) { return { generatedAt:'2026-08-21T00:00:00Z', storm:{key:group.key}, referencePoint:{lat:22.3,lon:114.2}, sources:{}, comparison:{leadHours:24,entries:[]} }; }, haversineKm(){return 0;} },
    impact: { buildHongKongImpact(){return{};} },
    signal: { buildHkoSignalRiskInputs(){return{};} },
    signalCalibration: { estimateHkoSignalRisk(){ throw new Error('must not be called'); } }
  };
  const modelRepository = { async getChampion(){return{modelVersion:'m1',role:'champion',persisted:false,weights:{schemaVersion:'w',defaultWeights:{HKO:.25,CMA:.25,JMA:.25,CWA:.25},buckets:{}}};} };
  const result = await createAnalysisOrchestrator({ modelRepository, signalRiskRepository: { async getChampion(){return null;} }, engines }).run({ sourceGroup:{key:'x'} });
  assert.equal(result.deterministic.signalRisk.available, false);
  assert.equal(result.deterministic.signalRisk.reason, 'no-champion-calibration-profile');
}

const httpEnv = { ANALYSIS_DB: { prepare(){ throw new Error('not used'); } } };
const httpProfile = { profileId:'p1', role:'champion', persisted:true, profile:{schemaVersion:'hko-signal-calibration-profile/v1'} };
const httpDeps = {
  createSignalRiskRepository(){ return { async getChampion(){return httpProfile;}, async getById(id){return id==='p1'?httpProfile:null;} }; },
  createModelRepository(){ return { async getChampion(){return {modelVersion:'m1',weights:{}};}, async getByVersion(){return null;} }; },
  createAnalysisOrchestrator(){ return { async run(){return {schemaVersion:'storm-analysis-orchestration/v3'};} }; },
  createAnalysisCacheRepository(){ return { async get(){return null;}, async put(){} }; },
  async buildAnalysisCacheIdentity(){ return {cacheKey:'k',advisoryFingerprint:'a'}; }
};

let response = await handleRequest(new Request('https://example.test/health'), httpEnv, httpDeps);
let body = await response.json();
assert.equal(body.deterministicAnalysisVersion, 'storm-analysis-orchestration/v3');
assert.equal(body.analysisCacheVersion, 'analysis-cache/v2');
assert.equal(body.signalRiskCalibrationVersion, 'hko-signal-calibration-profile/v1');

response = await handleRequest(new Request('https://example.test/api/signal-risk/profiles/champion'), httpEnv, httpDeps);
body = await response.json();
assert.equal(response.status, 200);
assert.equal(body.available, true);
assert.equal(body.profile.profileId, 'p1');

response = await handleRequest(new Request('https://example.test/api/signal-risk/profiles/p1'), httpEnv, httpDeps);
assert.equal(response.status, 200);
response = await handleRequest(new Request('https://example.test/api/signal-risk/profiles/missing'), httpEnv, httpDeps);
assert.equal(response.status, 404);

{
  let cacheReads=0, cacheWrites=0, seenOptions=null;
  const factory = {
    modelRepository(){return{async getChampion(){return{modelVersion:'m1',weights:{schemaVersion:'w'}};}}},
    signalRiskRepository(){return{async getChampion(){throw new Error('missing table');}}},
    async cacheIdentity(){return{cacheKey:'degraded',advisoryFingerprint:'a'};},
    cacheRepository(){return{async get(){cacheReads++;return null;},async put(){cacheWrites++;}}},
    orchestrator(){return{async run(input,options){seenOptions=options;return{schemaVersion:'v3',deterministic:{signalRisk:{available:false}}};}}}
  };
  const result = await runAnalysisWithCache({sourceGroup:{key:'x'}}, {}, factory);
  assert.equal(result.cache.status, 'bypass-signal-profile-read-error');
  assert.equal(cacheReads, 0);
  assert.equal(cacheWrites, 0);
  assert.equal(seenOptions.signalCalibrationReadError, true);
  assert.equal(seenOptions.signalCalibrationProfile, null);
}

console.log('storm-analysis AI-11 tests: OK');
