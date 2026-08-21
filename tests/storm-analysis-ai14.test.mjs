import assert from 'node:assert/strict';
import { previewPersistedSignalCalibrationTraining, runPersistedSignalCalibrationTraining } from '../workers/storm-analysis/src/signal-training-runner.js';
import { createOutcomeCurationRepository, validateOutcomeCuration } from '../workers/storm-analysis/src/outcome-curation-repository.js';
import { handleRequest, constantTimeSecretEqual } from '../workers/storm-analysis/src/index.js';

function expectCode(error, code) { assert.equal(error?.code, code); return true; }

const dataset = {
  datasetFingerprint: 'dataset-fp-1',
  coverage: { eligibleStorms: 3, eligibleCases: 4, rejectedCases: [{ caseId: 'bad', reason: 'missing-signal-inputs' }], rejectedOutcomeStorms: [] },
  storms: [
    { stormKey: 's1', cases: [{ asOf: '2020-01-01T00:00:00Z' }] },
    { stormKey: 's2', cases: [{ asOf: '2021-01-01T00:00:00Z' }] },
    { stormKey: 's3', cases: [{ asOf: '2022-01-01T00:00:00Z' }, { asOf: '2022-01-01T06:00:00Z' }] }
  ]
};
const champion = { profileId: 'champion-1', role: 'champion', persisted: true, profile: { schemaVersion: 'hko-signal-calibration-profile/v1' } };
const adapter = { async loadTrainingDataset() { return dataset; } };
const signalRiskRepository = { async getChampion() { return champion; } };

{
  const preview = await previewPersistedSignalCalibrationTraining({}, {
    challengerProfileId: 'challenger-1',
    trainerOptions: { minimumTrainingStorms: 2 },
    championProfileProvenance: { holdoutIndependent: true }
  }, { adapter, signalRiskRepository });
  assert.equal(preview.dryRun, true);
  assert.equal(preview.writesPerformed, false);
  assert.equal(preview.dataset.datasetFingerprint, 'dataset-fp-1');
  assert.equal(preview.dataset.coverage.rejectedCases.length, 1);
  assert.equal(preview.walkForwardPreview.potentialHoldoutStormCount, 1);
  assert.equal(preview.limits.runAllowedBySize, true);
  assert.equal(preview.championHoldoutIndependenceConfirmed, true);
}

{
  await assert.rejects(
    () => runPersistedSignalCalibrationTraining({}, {
      runId: 'run-1', challengerProfileId: 'challenger-1', expectedDatasetFingerprint: 'old-fp'
    }, { adapter, signalRiskRepository, trainer: { runSignalCalibrationWalkForward() {}, TRAINER_VERSION: 'v' }, calibration: { buildHkoSignalCalibrationProfile() {} } }),
    error => expectCode(error, 'training-dataset-changed')
  );
}

{
  await assert.rejects(
    () => runPersistedSignalCalibrationTraining({}, {
      runId: 'run-size', challengerProfileId: 'challenger-1', expectedDatasetFingerprint: 'dataset-fp-1', maximumCases: 2
    }, { adapter, signalRiskRepository, trainer: { runSignalCalibrationWalkForward() {}, TRAINER_VERSION: 'v' }, calibration: { buildHkoSignalCalibrationProfile() {} } }),
    error => expectCode(error, 'training-dataset-too-large')
  );
}

{
  let began = 0, completed = 0;
  const repository = {
    async beginRun(meta) { began += 1; assert.equal(meta.datasetFingerprint, 'dataset-fp-1'); return { status: 'running', runId: meta.runId }; },
    async completeRun(runId, result) { completed += 1; return { status: 'completed', runId, challengerProfileId: result.challenger.profileId, promotionPerformed: false }; },
    async failRun() { throw new Error('not expected'); }
  };
  const trainer = {
    TRAINER_VERSION: 'signal-calibration-walkforward-trainer/v1',
    async runSignalCalibrationWalkForward() {
      return {
        challenger: { profileId: 'challenger-1', eligibleForPromotion: true, promotionPerformed: false },
        replay: { eligibleStorms: 3, holdoutStormCount: 1, challengerPredictionCount: 4 }
      };
    }
  };
  const result = await runPersistedSignalCalibrationTraining({}, {
    runId: 'run-2', challengerProfileId: 'challenger-1', expectedDatasetFingerprint: 'dataset-fp-1',
    championProfileProvenance: { holdoutIndependent: true }
  }, { adapter, signalRiskRepository, repository, trainer, calibration: { buildHkoSignalCalibrationProfile() {} } });
  assert.equal(result.status, 'completed');
  assert.equal(result.semantics.previewFingerprintConfirmed, true);
  assert.equal(result.semantics.automaticPromotion, false);
  assert.equal(began, 1);
  assert.equal(completed, 1);
}

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.params = []; }
  bind(...params) { this.params = params; return this; }
  async first() {
    if (this.sql.includes('FROM signal_outcome_curations')) return this.db.curations.get(String(this.params[0])) || null;
    if (this.sql.includes('FROM signal_outcomes')) return String(this.params[0]) === this.db.outcome.outcome_id ? { ...this.db.outcome } : null;
    return null;
  }
}
class MockD1 {
  constructor() {
    this.outcome = { outcome_id: 'out-1', storm_key: 'storm-1', source: 'curated archive', source_url: null, signal_system_era: 'modern', highest_signal: 'T8', official_hko: 0, fingerprint: 'out-fp-1' };
    this.curations = new Map();
  }
  prepare(sql) { return new Statement(this, sql); }
  async batch(statements) {
    for (const statement of statements) {
      if (statement.sql.includes('INSERT INTO signal_outcome_curations')) {
        const [curationId, officialHko, evidenceUrl, reason, actorLabel, outcomeId, fingerprint] = statement.params;
        if (outcomeId === this.outcome.outcome_id && fingerprint === this.outcome.fingerprint) {
          if (this.curations.has(curationId)) throw new Error('duplicate curation');
          this.curations.set(curationId, {
            curation_id: curationId, outcome_id: outcomeId, storm_key: this.outcome.storm_key,
            expected_fingerprint: fingerprint, official_hko: officialHko, evidence_url: evidenceUrl,
            reason, actor_label: actorLabel, created_at: '2026-08-21T00:00:00Z'
          });
        }
      } else if (statement.sql.startsWith('UPDATE signal_outcomes')) {
        const [officialHko, outcomeId, fingerprint] = statement.params;
        if (outcomeId === this.outcome.outcome_id && fingerprint === this.outcome.fingerprint) this.outcome.official_hko = officialHko;
      }
    }
    return [];
  }
}

{
  assert.throws(() => validateOutcomeCuration({
    curationId: 'c1', outcomeId: 'out-1', expectedFingerprint: 'out-fp-1', officialHko: true, reason: 'verified', evidenceUrl: ''
  }, { outcome_id: 'out-1', fingerprint: 'out-fp-1', signal_system_era: 'modern', highest_signal: 'T8' }), error => expectCode(error, 'official-hko-evidence-required'));
}

{
  const db = new MockD1();
  const repository = createOutcomeCurationRepository(db);
  const result = await repository.curate({
    curationId: 'cur-1', outcomeId: 'out-1', expectedFingerprint: 'out-fp-1', officialHko: true,
    evidenceUrl: 'https://www.hko.gov.hk/example', reason: 'matched official HKO warning record', actorLabel: 'manual-review'
  });
  assert.equal(result.status, 'completed');
  assert.equal(db.outcome.official_hko, 1);
  assert.equal(db.curations.size, 1);
  const repeat = await repository.curate({
    curationId: 'cur-1', outcomeId: 'out-1', expectedFingerprint: 'out-fp-1', officialHko: true,
    evidenceUrl: 'https://www.hko.gov.hk/example', reason: 'matched official HKO warning record', actorLabel: 'manual-review'
  });
  assert.equal(repeat.status, 'already-curated');
  await assert.rejects(() => repository.curate({
    curationId: 'cur-1', outcomeId: 'out-1', expectedFingerprint: 'out-fp-1', officialHko: true,
    evidenceUrl: 'https://www.hko.gov.hk/example', reason: 'different reason', actorLabel: 'manual-review'
  }), error => expectCode(error, 'curation-id-conflict'));
  await assert.rejects(() => repository.curate({
    curationId: 'cur-2', outcomeId: 'out-1', expectedFingerprint: 'stale', officialHko: true,
    evidenceUrl: 'https://www.hko.gov.hk/example', reason: 'stale review'
  }), error => expectCode(error, 'signal-outcome-changed'));
}

{
  assert.equal(await constantTimeSecretEqual('abc', 'abc'), true);
  assert.equal(await constantTimeSecretEqual('abc', 'abd'), false);

  const db = {};
  const deps = {
    previewPersistedSignalCalibrationTraining: async (_db, body) => ({ dryRun: true, challengerProfileId: body.challengerProfileId }),
    runPersistedSignalCalibrationTraining: async (_db, body) => ({ status: 'completed', runId: body.runId, semantics: { promotionPerformed: false } }),
    createOutcomeCurationRepository: () => ({ curate: async body => ({ status: 'completed', curationId: body.curationId, promotionPerformed: false }) })
  };
  let response = await handleRequest(new Request('https://example.test/api/admin/signal-training/preview', {
    method: 'POST', body: JSON.stringify({ challengerProfileId: 'c' }), headers: { 'content-type': 'application/json' }
  }), { ANALYSIS_DB: db }, deps);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'analysis-admin-disabled');

  response = await handleRequest(new Request('https://example.test/api/admin/signal-training/preview', {
    method: 'POST', body: JSON.stringify({ challengerProfileId: 'c' }), headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' }
  }), { ANALYSIS_DB: db, ANALYSIS_ADMIN_TOKEN: 'secret' }, deps);
  assert.equal(response.status, 401);

  response = await handleRequest(new Request('https://example.test/api/admin/signal-training/preview', {
    method: 'POST', body: JSON.stringify({ challengerProfileId: 'c' }), headers: { authorization: 'Bearer secret', 'content-type': 'application/json' }
  }), { ANALYSIS_DB: db, ANALYSIS_ADMIN_TOKEN: 'secret' }, deps);
  let body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.preview.dryRun, true);

  response = await handleRequest(new Request('https://example.test/api/admin/signal-training/run', {
    method: 'POST', body: JSON.stringify({ runId: 'r1' }), headers: { authorization: 'Bearer secret', 'content-type': 'application/json' }
  }), { ANALYSIS_DB: db, ANALYSIS_ADMIN_TOKEN: 'secret' }, deps);
  body = await response.json();
  assert.equal(body.training.status, 'completed');
  assert.equal(body.training.semantics.promotionPerformed, false);

  response = await handleRequest(new Request('https://example.test/api/admin/signal-outcomes/curate', {
    method: 'POST', body: JSON.stringify({ curationId: 'cur-http' }), headers: { authorization: 'Bearer secret', 'content-type': 'application/json' }
  }), { ANALYSIS_DB: db, ANALYSIS_ADMIN_TOKEN: 'secret' }, deps);
  body = await response.json();
  assert.equal(body.curation.status, 'completed');

  response = await handleRequest(new Request('https://example.test/health'), { ANALYSIS_DB: db, ANALYSIS_ADMIN_TOKEN: 'secret' }, deps);
  body = await response.json();
  assert.equal(body.analysisAdminEnabled, true);
  assert.equal(body.promotionApiEnabled, true);
  assert.equal(body.automaticPromotionEnabled, false);

  response = await handleRequest(new Request('https://example.test/api/admin/signal-risk/promote', {
    method: 'POST', headers: { authorization: 'Bearer secret' }
  }), { ANALYSIS_DB: db, ANALYSIS_ADMIN_TOKEN: 'secret' }, deps);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'missing-body');
}

console.log('storm-analysis AI-14 tests: OK');
