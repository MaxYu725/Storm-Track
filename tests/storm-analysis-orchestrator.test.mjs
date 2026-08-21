import assert from 'node:assert/strict';
import { createModelRepository, bucketForLeadHours, selectWeightsForLead, BUILTIN_MODEL_VERSION } from '../workers/storm-analysis/src/model-repository.js';
import { createAnalysisOrchestrator } from '../workers/storm-analysis/src/analysis-orchestrator.js';
import { handleRequest } from '../workers/storm-analysis/src/index.js';

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.params = []; }
  bind(...params) { this.params = params; return this; }
  async first() {
    this.db.calls.push({ sql: this.sql, params: this.params });
    if (this.sql.includes("role = 'champion'")) return this.db.champion;
    if (this.sql.includes('model_version = ?1')) return this.db.byVersion.get(this.params[0]) || null;
    return null;
  }
}

class MockD1 {
  constructor() { this.calls = []; this.champion = null; this.byVersion = new Map(); }
  prepare(sql) { return new Statement(this, sql); }
}

assert.equal(bucketForLeadHours(0), '0-12h');
assert.equal(bucketForLeadHours(24), '24-48h');
assert.equal(bucketForLeadHours(120), '120h+');

{
  const model = await createModelRepository(new MockD1()).getChampion();
  assert.equal(model.modelVersion, BUILTIN_MODEL_VERSION);
  assert.equal(model.persisted, false);
  assert.equal(selectWeightsForLead(model, 24).weights.HKO, 0.25);
}

{
  const db = new MockD1();
  db.champion = {
    model_version: 'champion-7', role: 'champion',
    weights_json: JSON.stringify({
      defaultWeights: { HKO: 1, CMA: 1, JMA: 1, CWA: 1 },
      buckets: { '24-48h': { weights: { HKO: 0.1, CMA: 0.2, JMA: 0.6, CWA: 0.1 } } }
    }),
    metrics_json: '{"trackMaeKm":80}', created_at: '2026-08-20', activated_at: '2026-08-21'
  };
  const model = await createModelRepository(db).getChampion();
  assert.equal(model.persisted, true);
  assert.equal(model.weights.buckets['24-48h'].JMA, 0.6);
  assert.equal(model.metrics.trackMaeKm, 80);
}

{
  const calls = [];
  const engines = {
    snapshot: {
      buildStormAnalysisSnapshot(group, options) {
        calls.push('snapshot');
        return {
          schemaVersion: 'storm-analysis-snapshot/v1', generatedAt: options.generatedAt || '2026-08-21T00:00:00Z',
          storm: { key: group.key }, referencePoint: { lat: 22.3, lon: 114.2 },
          comparison: { leadHours: 24, entries: [{ agency: 'HKO', lat: 20, lon: 179 }, { agency: 'JMA', lat: 22, lon: -179 }] }
        };
      },
      haversineKm() { return 123; }
    },
    impact: { buildHongKongImpact(snapshot) { calls.push('impact'); return { schemaVersion: 'hk-impact/v1', sourceSnapshotVersion: snapshot.schemaVersion }; } },
    signal: { buildHkoSignalRiskInputs(snapshot, impact, group) { calls.push('signal'); return { schemaVersion: 'hko-signal-risk-inputs/v1', sourceSnapshotVersion: snapshot.schemaVersion, sourceImpactVersion: impact.schemaVersion, groupKey: group.key }; } }
  };
  const modelRepository = {
    async getChampion() {
      return {
        modelVersion: 'champion-x', role: 'champion', persisted: true,
        weights: {
          schemaVersion: 'storm-analysis-model-weights/v1', defaultWeights: { HKO: 0.25, CMA: 0.25, JMA: 0.25, CWA: 0.25 },
          buckets: { '24-48h': { HKO: 0.25, CMA: 0.1, JMA: 0.55, CWA: 0.1 } }
        }
      };
    }
  };
  const result = await createAnalysisOrchestrator({ modelRepository, engines }).run({ sourceGroup: { key: 'storm-x' }, generatedAt: '2026-08-21T00:00:00Z' });
  assert.deepEqual(calls, ['snapshot', 'impact', 'signal']);
  assert.equal(result.model.modelVersion, 'champion-x');
  assert.equal(result.deterministic.weightedComparison.available, true);
  assert.ok(Math.abs(result.deterministic.weightedComparison.weights.HKO - 0.3125) < 1e-12);
  assert.ok(Math.abs(result.deterministic.weightedComparison.weights.JMA - 0.6875) < 1e-12);
  assert.ok(Math.abs(Math.abs(result.deterministic.weightedComparison.lon) - 180) < 1);
  assert.equal(result.semantics.aiGenerated, false);
  assert.equal(result.semantics.unweightedAnalysisPreserved, true);
}

{
  const env = { ANALYSIS_DB: new MockD1() };
  const modelRepositoryFactory = () => ({
    async getChampion() { return { modelVersion: 'champion-route', role: 'champion', persisted: true, weights: { schemaVersion: 'storm-analysis-model-weights/v1', defaultWeights: { HKO: 0.25, CMA: 0.25, JMA: 0.25, CWA: 0.25 }, buckets: {} } }; },
    async getByVersion(version) { return version === 'known' ? { modelVersion: 'known' } : null; }
  });
  const orchestratorFactory = () => ({ async run(body) { return { schemaVersion: 'storm-analysis-orchestration/v1', storm: { key: body.sourceGroup.key } }; } });
  const dependencies = { createModelRepository: modelRepositoryFactory, createAnalysisOrchestrator: orchestratorFactory };

  let response = await handleRequest(new Request('https://example.test/api/models/champion'), env, dependencies);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).model.modelVersion, 'champion-route');

  response = await handleRequest(new Request('https://example.test/api/models/known'), env, dependencies);
  assert.equal(response.status, 200);

  response = await handleRequest(new Request('https://example.test/api/models/missing'), env, dependencies);
  assert.equal(response.status, 404);

  response = await handleRequest(new Request('https://example.test/api/analysis/run', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceGroup: { key: 'route-storm' } })
  }), env, dependencies);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).analysis.storm.key, 'route-storm');
}

console.log('storm-analysis-orchestrator tests: OK');
