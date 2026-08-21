import assert from 'node:assert/strict';
import { handleRequest, TRUTH_AUGMENTATION_REPOSITORY_VERSION } from '../workers/storm-analysis/src/index.js';
import { VERIFICATION_RESULT_REPOSITORY_VERSION } from '../workers/storm-analysis/src/verification-result-repository.js';

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

const truthRequest = {
  stormKey: 'WP-2026-99',
  internationalNumber: '2699',
  identityBindingFingerprint: 'b'.repeat(64),
  plan: { schemaVersion: 'historical-backfill-import/v1', runId: 'mock-run', rows: [] }
};

const calls = [];
const verificationRepository = {
  preview(received) {
    calls.push(['verification-preview', received]);
    return {
      ok: true,
      dryRun: true,
      writesPerformed: false,
      repositoryVersion: VERIFICATION_RESULT_REPOSITORY_VERSION,
      rowCount: received.length
    };
  },
  async persist(received) {
    calls.push(['verification-persist', received]);
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
const truthRepository = {
  async preview(received) {
    calls.push(['truth-preview', received]);
    return {
      ok: true,
      dryRun: true,
      writesPerformed: false,
      repositoryVersion: TRUTH_AUGMENTATION_REPOSITORY_VERSION,
      stormKey: received.stormKey,
      internationalNumber: received.internationalNumber,
      exactSnapshotCount: 2,
      truthDatasetDisposition: 'appended',
      truthPointsAppended: 12
    };
  },
  async import(received) {
    calls.push(['truth-import', received]);
    return {
      ok: true,
      status: 'completed',
      writesPerformed: true,
      repositoryVersion: TRUTH_AUGMENTATION_REPOSITORY_VERSION,
      stormKey: received.stormKey,
      internationalNumber: received.internationalNumber,
      exactSnapshotCount: 2,
      truthDatasetDisposition: 'existing',
      truthPointsAppended: 0
    };
  }
};
const dependencies = {
  createVerificationResultRepository: () => verificationRepository,
  createTruthAugmentationRepository: () => truthRepository
};
const env = { ANALYSIS_DB: {}, BACKFILL_TOKEN: 'backfill-secret', ANALYSIS_ADMIN_TOKEN: 'admin-secret' };

const health = await handleRequest(new Request('https://example.test/health'), env, dependencies);
assert.equal(health.status, 200);
const healthBody = await health.json();
assert.equal(healthBody.verificationPersistenceVersion, VERIFICATION_RESULT_REPOSITORY_VERSION);
assert.equal(healthBody.truthAugmentationVersion, TRUTH_AUGMENTATION_REPOSITORY_VERSION);
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

const verificationPreview = await handleRequest(new Request('https://example.test/api/admin/verification/preview', {
  method: 'POST', headers: { authorization: 'Bearer admin-secret', 'content-type': 'application/json' }, body: JSON.stringify({ rows })
}), env, dependencies);
assert.equal(verificationPreview.status, 200);
assert.deepEqual(await verificationPreview.json(), {
  ok: true,
  preview: {
    ok: true,
    dryRun: true,
    writesPerformed: false,
    repositoryVersion: VERIFICATION_RESULT_REPOSITORY_VERSION,
    rowCount: 1
  }
});

const verificationPersist = await handleRequest(new Request('https://example.test/api/admin/verification/persist', {
  method: 'POST', headers: { authorization: 'Bearer admin-secret', 'content-type': 'application/json' }, body: JSON.stringify({ rows })
}), env, dependencies);
assert.equal(verificationPersist.status, 200);
assert.equal((await verificationPersist.json()).persistence.status, 'completed');

for (const endpoint of ['/api/admin/truth/augmentation/preview', '/api/admin/truth/augmentation/import']) {
  const wrongMethod = await handleRequest(new Request(`https://example.test${endpoint}`), env, dependencies);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST');

  const noToken = await handleRequest(new Request(`https://example.test${endpoint}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(truthRequest)
  }), env, dependencies);
  assert.equal(noToken.status, 401);

  const backfillToken = await handleRequest(new Request(`https://example.test${endpoint}`, {
    method: 'POST', headers: { authorization: 'Bearer backfill-secret', 'content-type': 'application/json' }, body: JSON.stringify(truthRequest)
  }), env, dependencies);
  assert.equal(backfillToken.status, 401, `${endpoint} must require ANALYSIS_ADMIN_TOKEN`);
}

const truthPreview = await handleRequest(new Request('https://example.test/api/admin/truth/augmentation/preview', {
  method: 'POST', headers: { authorization: 'Bearer admin-secret', 'content-type': 'application/json' }, body: JSON.stringify(truthRequest)
}), env, dependencies);
assert.equal(truthPreview.status, 200);
assert.deepEqual(await truthPreview.json(), {
  ok: true,
  preview: {
    ok: true,
    dryRun: true,
    writesPerformed: false,
    repositoryVersion: TRUTH_AUGMENTATION_REPOSITORY_VERSION,
    stormKey: 'WP-2026-99',
    internationalNumber: '2699',
    exactSnapshotCount: 2,
    truthDatasetDisposition: 'appended',
    truthPointsAppended: 12
  }
});

const truthImport = await handleRequest(new Request('https://example.test/api/admin/truth/augmentation/import', {
  method: 'POST', headers: { authorization: 'Bearer admin-secret', 'content-type': 'application/json' }, body: JSON.stringify(truthRequest)
}), env, dependencies);
assert.equal(truthImport.status, 200);
assert.equal((await truthImport.json()).augmentation.status, 'completed');

assert.deepEqual(calls, [
  ['verification-preview', rows],
  ['verification-persist', rows],
  ['truth-preview', truthRequest],
  ['truth-import', truthRequest]
]);

for (const endpoint of ['/api/admin/verification/preview', '/api/admin/truth/augmentation/preview']) {
  const disabled = await handleRequest(new Request(`https://example.test${endpoint}`, {
    method: 'POST', headers: { authorization: 'Bearer admin-secret', 'content-type': 'application/json' }, body: JSON.stringify(endpoint.includes('/truth/') ? truthRequest : { rows })
  }), { ANALYSIS_DB: {} }, dependencies);
  assert.equal(disabled.status, 503);
  assert.equal((await disabled.json()).error, 'analysis-admin-disabled');
}

console.log('storm-analysis AI-23 truth + verification API wiring tests passed');
