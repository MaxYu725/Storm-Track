import assert from 'node:assert/strict';
import { createBackfillRepository, previewImportPlan, validateImportPlan } from '../workers/storm-analysis/src/backfill-repository.js';
import { handleRequest } from '../workers/storm-analysis/src/index.js';

function samplePlan() {
  return {
    schemaVersion: 'historical-backfill-import/v1',
    runId: 'backfill_test',
    generatedAt: '2026-08-21T00:00:00.000Z',
    source: 'test',
    rows: [
      {
        table: 'backfill_runs', primaryKey: 'backfill_test', values: {
          run_id: 'backfill_test', import_version: 'historical-backfill-import/v1', source: 'test',
          generated_at: '2026-08-21T00:00:00.000Z', fingerprint: 'run-fingerprint', status: 'planned'
        }
      },
      {
        table: 'historical_storms', primaryKey: 'storm-1', values: {
          storm_key: 'storm-1', name_tc: '測試', name_en: 'TEST', season: 2026, basin: 'WNP',
          backfill_mode: 'truth-only', agency_skill_eligible: 0, updated_at: '2026-08-21T00:00:00.000Z'
        }
      },
      {
        table: 'truth_datasets', primaryKey: 'truth-1', values: {
          dataset_id: 'truth-1', storm_key: 'storm-1', source: 'test truth', source_url: null,
          source_version: 'v1', retrieved_at: null, fingerprint: 'truth-fingerprint'
        }
      },
      {
        table: 'truth_points', primaryKey: 'point-1', values: {
          point_id: 'point-1', dataset_id: 'truth-1', valid_time: '2026-08-20T00:00:00.000Z',
          lat: 20, lon: 120, maximum_wind_json: '30', pressure_json: '980', intensity: 'TY',
          source_point_id: null, fingerprint: 'point-fingerprint'
        }
      }
    ]
  };
}

class MockStatement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.params = []; }
  bind(...params) { this.params = params; return this; }
  async first() {
    this.db.calls.push({ type: 'first', sql: this.sql, params: this.params });
    if (this.sql.includes('WHERE run_id')) return this.db.existingRunById;
    if (this.sql.includes('WHERE fingerprint')) return this.db.existingRunByFingerprint;
    return null;
  }
  async run() {
    this.db.calls.push({ type: 'run', sql: this.sql, params: this.params });
    if (this.db.failStatusUpdate && this.sql.startsWith('UPDATE backfill_runs')) throw new Error('status failure');
    return { success: true, meta: { changes: 1 } };
  }
}

class MockD1 {
  constructor() { this.calls = []; this.existingRunById = null; this.existingRunByFingerprint = null; this.failBatch = false; this.failStatusUpdate = false; }
  prepare(sql) { return new MockStatement(this, sql); }
  async batch(statements) {
    this.calls.push({ type: 'batch', statements: statements.map(item => ({ sql: item.sql, params: item.params })) });
    if (this.failBatch) throw new Error('batch failure');
    return statements.map(() => ({ success: true, meta: { changes: 1 } }));
  }
}

(function testDryRunAndOrdering() {
  const plan = samplePlan();
  plan.rows.reverse();
  const validated = validateImportPlan(plan);
  assert.equal(validated.rows[0].table, 'backfill_runs');
  assert.equal(validated.rows[1].table, 'historical_storms');
  const preview = previewImportPlan(plan);
  assert.equal(preview.dryRun, true);
  assert.equal(preview.writesPerformed, false);
  assert.equal(preview.tableCounts.truth_points, 1);
})();

(function testUnsupportedTablesAndColumnsRejected() {
  const tablePlan = samplePlan();
  tablePlan.rows.push({ table: 'model_versions', primaryKey: 'x', values: { model_version: 'x' } });
  assert.throws(() => validateImportPlan(tablePlan), /unsupported table/);
  const columnPlan = samplePlan();
  columnPlan.rows[1].values.not_a_column = true;
  assert.throws(() => validateImportPlan(columnPlan), /unsupported columns/);
})();

await (async function testRepositoryUsesPreparedStatementsAndBatches() {
  const db = new MockD1();
  const repository = createBackfillRepository(db, { batchSize: 2 });
  const result = await repository.importPlan(samplePlan());
  assert.equal(result.status, 'completed');
  assert.equal(result.completedBatches, 2);
  assert.equal(result.semantics.wholeRunAtomic, false);
  assert.ok(db.calls.some(call => call.type === 'first' && call.sql.includes('WHERE run_id = ?1')));
  assert.ok(db.calls.some(call => call.type === 'first' && call.sql.includes('WHERE fingerprint = ?1')));
  assert.ok(db.calls.some(call => call.type === 'batch'));
  assert.ok(db.calls.some(call => call.type === 'run' && call.sql.startsWith('UPDATE backfill_runs')));
})();

await (async function testCompletedFingerprintIsIdempotent() {
  const db = new MockD1();
  db.existingRunById = { run_id: 'backfill_test', fingerprint: 'run-fingerprint', status: 'completed' };
  const result = await createBackfillRepository(db).importPlan(samplePlan());
  assert.equal(result.status, 'already-imported');
  assert.equal(result.writesPerformed, false);
  assert.equal(db.calls.filter(call => call.type === 'batch').length, 0);
})();

await (async function testRunIdConflictRejected() {
  const db = new MockD1();
  db.existingRunById = { run_id: 'backfill_test', fingerprint: 'different', status: 'completed' };
  await assert.rejects(() => createBackfillRepository(db).importPlan(samplePlan()), error => error?.status === 409 && error?.code === 'run-id-conflict');
})();

await (async function testUnfinishedFingerprintOwnedByAnotherRunIsRejected() {
  const db = new MockD1();
  db.existingRunByFingerprint = { run_id: 'other-run', fingerprint: 'run-fingerprint', status: 'failed' };
  await assert.rejects(() => createBackfillRepository(db).importPlan(samplePlan()), error => error?.status === 409 && error?.code === 'run-fingerprint-conflict');
})();

await (async function testFailedBatchMarksRunFailed() {
  const db = new MockD1();
  db.failBatch = true;
  await assert.rejects(() => createBackfillRepository(db).importPlan(samplePlan()), error => error?.code === 'import-failed' && error?.details?.recoverableByRetry === true);
  const updates = db.calls.filter(call => call.type === 'run' && call.sql.startsWith('UPDATE backfill_runs'));
  assert.ok(updates.some(call => call.params[0] === 'failed'));
})();

await (async function testPlanEndpointDoesNotNeedDbAndNeverWrites() {
  const response = await handleRequest(new Request('https://example.test/api/backfill/plan', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(samplePlan())
  }), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.dryRun, true);
  assert.equal(body.writesPerformed, false);
})();

await (async function testImportEndpointRequiresSecret() {
  const response = await handleRequest(new Request('https://example.test/api/backfill/import', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(samplePlan())
  }), { ANALYSIS_DB: new MockD1() });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'import-disabled');
})();

await (async function testImportEndpointRejectsWrongTokenAndAcceptsCorrectToken() {
  const wrong = await handleRequest(new Request('https://example.test/api/backfill/import', {
    method: 'POST', headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' }, body: JSON.stringify(samplePlan())
  }), { ANALYSIS_DB: new MockD1(), BACKFILL_TOKEN: 'secret' });
  assert.equal(wrong.status, 401);

  const ok = await handleRequest(new Request('https://example.test/api/backfill/import', {
    method: 'POST', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' }, body: JSON.stringify(samplePlan())
  }), { ANALYSIS_DB: new MockD1(), BACKFILL_TOKEN: 'secret' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).status, 'completed');
})();

await (async function testHealthMakesIndependentBindingExplicit() {
  const response = await handleRequest(new Request('https://example.test/health'), { ANALYSIS_DB: new MockD1() });
  const body = await response.json();
  assert.equal(body.service, 'storm-analysis');
  assert.equal(body.analysisDbBound, true);
  assert.equal(body.productionStormWorkerModified, false);
})();

console.log('storm-analysis-worker tests: OK');
