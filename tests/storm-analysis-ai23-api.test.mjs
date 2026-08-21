import assert from 'node:assert/strict';
import { handleRequest } from '../workers/storm-analysis/src/index.js';
import { VERIFICATION_RESULT_REPOSITORY_VERSION } from '../workers/storm-analysis/src/verification-result-repository.js';

// CI probe branch only: canonical workflow checks out feature/ai-analysis-engine.
const rows = [{
  table: 'verification_results',
  primaryKey: 'verify_fixture',
  values: {
    verification_id: 'verify_fixture',
    storm_key: 'WP-2026-99',
    snapshot_id: 'snapshot_fixture',
    truth_dataset_id: 'truth_fixture',
    verification_version: 'forecast-verification/v1',
    verified_at: '2026-10-10T01:00:00.000Z',
    result_json: '{}',
    calibration_record_json: null,
    fingerprint: 'a'.repeat(64)
  }
}];

const calls = [];
const repository = {
  preview(received) {
    calls.push(['preview', received]);
    return {
      ok: true,
      dryRun: true,
      writesPerformed: false,
      repositoryVersion: VERIFICATION_RESULT_REPOSITORY_VERSION,
      rowCount: received.length
    };
  },
  async persist(received) {
    calls.push(['persist', received]);
    return {
      ok: true,
      status: 'completed',
      writesPerformed: true,
      repositoryVersion: VERIFICATION_RESULT_REPOSITORY_VERSION,
      requestedRowCount: received.length,
      insertedRowCount: received.length,
      alreadyPresentRowCount: 0
    };
  }
};
const dependencies = { createVerificationResultRepository: () => repository };
const env = { ANALYSIS_DB: {}, BACKFILL_TOKEN: 'backfill-secret', ANALYSIS_ADMIN_TOKEN: 'admin-secret' };

const health = await handleRequest(new Request('https://example.test/health'), env, dependencies);
assert.equal(health.status, 200);
const healthBody = await health.json();
assert.equal(healthBody.verificationPersistenceVersion, VERIFICATION_RESULT_REPOSITORY_VERSION);
assert.equal(healthBody.analysisAdminEnabled, true);
assert.equal(healthBody.productionStormWorkerModified, false);

for (const endpoint of ['/api/admin/verification/preview', '/api/admin/verification/persist']) {
  const wrongMethod = await handleRequest(new Request(`https://example.test${endpoint}`), env, dependencies);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST');

  const noToken = await handleRequest(new Request(`https://example.test${endpoint}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows })
  }), env, dependencies);
  assert.equal(noToken.status, 401);

  const backfillToken = await handleRequest(new Request(`https://example.test${endpoint}`, {
    method: 'POST', headers: { authorization: 'Bearer backfill-secret', 'content-type': 'application/json' }, body: JSON.stringify({ rows })
  }), env, dependencies);
  assert.equal(backfillToken.status, 401, `${endpoint} must not accept BACKFILL_TOKEN as admin authorization`);

  const invalidShape = await handleRequest(new Request(`https://example.test${endpoint}`, {
    method: 'POST', headers: { authorization: 'Bearer admin-secret', 'content-type': 'application/json' }, body: JSON.stringify(rows)
  }), env, dependencies);
  assert.equal(invalidShape.status, 400);
  assert.equal((await invalidShape.json()).error, 'invalid-verification-request');
}

const preview = await handleRequest(new Request('https://example.test/api/admin/verification/preview', {
  method: 'POST', headers: { authorization: 'Bearer admin-secret', 'content-type': 'application/json' }, body: JSON.stringify({ rows })
}), env, dependencies);
assert.equal(preview.status, 200);
assert.deepEqual(await preview.json(), {
  ok: true,
  preview: {
    ok: true,
    dryRun: true,
    writesPerformed: false,
    repositoryVersion: VERIFICATION_RESULT_REPOSITORY_VERSION,
    rowCount: 1
  }
});

const persist = await handleRequest(new Request('https://example.test/api/admin/verification/persist', {
  method: 'POST', headers: { authorization: 'Bearer admin-secret', 'content-type': 'application/json' }, body: JSON.stringify({ rows })
}), env, dependencies);
assert.equal(persist.status, 200);
assert.deepEqual(await persist.json(), {
  ok: true,
  persistence: {
    ok: true,
    status: 'completed',
    writesPerformed: true,
    repositoryVersion: VERIFICATION_RESULT_REPOSITORY_VERSION,
    requestedRowCount: 1,
    insertedRowCount: 1,
    alreadyPresentRowCount: 0
  }
});

assert.deepEqual(calls, [['preview', rows], ['persist', rows]]);

const disabled = await handleRequest(new Request('https://example.test/api/admin/verification/preview', {
  method: 'POST', headers: { authorization: 'Bearer admin-secret', 'content-type': 'application/json' }, body: JSON.stringify({ rows })
}), { ANALYSIS_DB: {} }, dependencies);
assert.equal(disabled.status, 503);
assert.equal((await disabled.json()).error, 'analysis-admin-disabled');

console.log('storm-analysis AI-23 verification API wiring tests passed');
