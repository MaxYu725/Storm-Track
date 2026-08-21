import assert from 'node:assert/strict';
import {
  createSignalPromotionRepository,
  profileFingerprint,
  promotionConfirmation,
  rollbackConfirmation
} from '../workers/storm-analysis/src/signal-promotion-repository.js';
import { handleRequest } from '../workers/storm-analysis/src/index.js';

function expectCode(error, code) { assert.equal(error?.code, code); return true; }

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.params = []; }
  bind(...params) { this.params = params; return this; }
  async first() { return this.db.first(this.sql, this.params); }
  async all() { return { results: this.db.all(this.sql, this.params) }; }
}

class MockD1 {
  constructor({ withChampion = true } = {}) {
    this.state = { state_id: 1, champion_profile_id: withChampion ? 'old' : null, generation: 4, updated_at: null };
    this.profiles = new Map([
      ...(withChampion ? [['old', {
        profile_id: 'old', profile_version: 'hko-signal-calibration-profile/v1', role: 'champion',
        training_window_start: '2010-01-01', training_window_end: '2020-01-01', storm_count: 20, sample_count: 100,
        profile_json: JSON.stringify({ schemaVersion: 'hko-signal-calibration-profile/v1', id: 'old' }), metrics_json: JSON.stringify({ brier: 0.2 }),
        created_at: '2020-01-01', activated_at: '2020-01-01', retired_at: null
      }]] : []),
      ['new', {
        profile_id: 'new', profile_version: 'hko-signal-calibration-profile/v1', role: 'challenger',
        training_window_start: '2010-01-01', training_window_end: '2025-01-01', storm_count: 30, sample_count: 160,
        profile_json: JSON.stringify({ schemaVersion: 'hko-signal-calibration-profile/v1', id: 'new' }), metrics_json: JSON.stringify({ brier: 0.15 }),
        created_at: '2026-08-20', activated_at: null, retired_at: null
      }]
    ]);
    this.trainingRuns = new Map([['train-1', {
      run_id: 'train-1', challenger_profile_id: 'new', status: 'completed', eligible_for_promotion: 1,
      gate_json: JSON.stringify({ eligibleForPromotion: true }), metrics_json: '{}', result_json: '{}',
      dataset_fingerprint: 'dataset-1', input_fingerprint: 'input-1', completed_at: '2026-08-20'
    }]]);
    this.events = new Map();
    this.batchCount = 0;
  }
  prepare(sql) { return new Statement(this, sql); }
  first(sql, params) {
    if (sql.includes('FROM signal_calibration_state')) return { ...this.state };
    if (sql.includes('FROM signal_calibration_profiles WHERE profile_id')) return this.profiles.get(String(params[0])) ? { ...this.profiles.get(String(params[0])) } : null;
    if (sql.includes('FROM signal_calibration_training_runs WHERE run_id')) return this.trainingRuns.get(String(params[0])) ? { ...this.trainingRuns.get(String(params[0])) } : null;
    if (sql.includes('FROM signal_profile_promotion_events WHERE event_id')) return this.events.get(String(params[0])) ? { ...this.events.get(String(params[0])) } : null;
    return null;
  }
  all(sql) {
    if (sql.includes("FROM signal_calibration_profiles WHERE role = 'champion'")) {
      return Array.from(this.profiles.values()).filter(row => row.role === 'champion').map(row => ({ ...row }));
    }
    return [];
  }
  async batch(statements) {
    this.batchCount += 1;
    const snapshot = {
      state: { ...this.state },
      profiles: new Map(Array.from(this.profiles, ([k, v]) => [k, { ...v }])),
      events: new Map(Array.from(this.events, ([k, v]) => [k, { ...v }]))
    };
    try {
      for (const statement of statements) this.apply(statement.sql, statement.params);
      return statements.map(() => ({ success: true }));
    } catch (error) {
      this.state = snapshot.state;
      this.profiles = snapshot.profiles;
      this.events = snapshot.events;
      throw error;
    }
  }
  apply(sql, p) {
    if (sql.includes("SET role='retired'")) {
      const row = this.profiles.get(String(p[0]));
      if (row?.role === 'champion') { row.role = 'retired'; row.retired_at = 'now'; }
      return;
    }
    if (sql.includes("SET role='champion'")) {
      const row = this.profiles.get(String(p[0]));
      if (row?.role === 'challenger' || row?.role === 'retired') {
        if (row.profile_json === p[1] && (row.metrics_json ?? '') === (p[2] ?? '')) {
          row.role = 'champion'; row.activated_at = 'now'; row.retired_at = null;
        }
      }
      return;
    }
    if (sql.startsWith('UPDATE signal_calibration_state')) {
      const [championAfter, expectedGeneration, championBefore] = p;
      const before = this.state.champion_profile_id == null ? null : String(this.state.champion_profile_id);
      const expectedBefore = championBefore == null ? null : String(championBefore);
      if (this.state.generation === expectedGeneration && before === expectedBefore) {
        this.state.champion_profile_id = championAfter == null ? null : String(championAfter);
        this.state.generation += 1;
      }
      return;
    }
    if (sql.startsWith('UPDATE signal_profile_promotion_events SET rolled_back_by_event_id')) {
      const [rollbackId, promotionId, currentProfileId] = p;
      const event = this.events.get(String(promotionId));
      if (event?.action === 'promote' && !event.rolled_back_by_event_id && String(event.champion_after_profile_id) === String(currentProfileId)) {
        event.rolled_back_by_event_id = rollbackId;
      }
      return;
    }
    if (sql.startsWith('INSERT INTO signal_profile_promotion_events')) {
      if (sql.includes("?1, 'promote'")) {
        const [eventId, candidateId, candidateJson, candidateMetrics, previousId, runId, genBefore, genAfter,
          candidateFp, previousFp, reason, actor, gateJson] = p;
        const candidate = this.profiles.get(String(candidateId));
        const run = this.trainingRuns.get(String(runId));
        const previousOk = previousId == null || this.profiles.get(String(previousId))?.role === 'retired';
        if (!candidate || candidate.role !== 'champion' || candidate.profile_json !== candidateJson || (candidate.metrics_json ?? '') !== (candidateMetrics ?? '')
          || !run || run.status !== 'completed' || run.eligible_for_promotion !== 1 || run.challenger_profile_id !== candidateId || (run.gate_json ?? '') !== (gateJson ?? '')
          || this.state.generation !== genAfter || String(this.state.champion_profile_id) !== String(candidateId) || !previousOk) {
          throw new Error('promotion guard failed');
        }
        this.events.set(String(eventId), {
          event_id: eventId, action: 'promote', subject_profile_id: candidateId,
          champion_before_profile_id: previousId, champion_after_profile_id: candidateId,
          source_training_run_id: runId, rollback_of_event_id: null, rolled_back_by_event_id: null,
          state_generation_before: genBefore, state_generation_after: genAfter,
          subject_profile_fingerprint: candidateFp, champion_before_fingerprint: previousFp, champion_after_fingerprint: candidateFp,
          gate_json: run.gate_json, reason, actor_label: actor, created_at: 'now'
        });
        return;
      }
      const [eventId, currentId, currentJson, currentMetrics, restoreId, sourceRunId, promotionId, genBefore, genAfter,
        currentFp, restoreFp, gateJson, reason, actor] = p;
      const current = this.profiles.get(String(currentId));
      const promotion = this.events.get(String(promotionId));
      const restoreOk = restoreId == null || this.profiles.get(String(restoreId))?.role === 'champion';
      if (!current || current.role !== 'retired' || current.profile_json !== currentJson || (current.metrics_json ?? '') !== (currentMetrics ?? '')
        || !promotion || promotion.rolled_back_by_event_id
        || this.state.generation !== genAfter || (this.state.champion_profile_id ?? null) !== (restoreId ?? null) || !restoreOk) {
        throw new Error('rollback guard failed');
      }
      this.events.set(String(eventId), {
        event_id: eventId, action: 'rollback', subject_profile_id: currentId,
        champion_before_profile_id: currentId, champion_after_profile_id: restoreId,
        source_training_run_id: sourceRunId, rollback_of_event_id: promotionId, rolled_back_by_event_id: null,
        state_generation_before: genBefore, state_generation_after: genAfter,
        subject_profile_fingerprint: currentFp, champion_before_fingerprint: currentFp, champion_after_fingerprint: restoreFp,
        gate_json: gateJson, reason, actor_label: actor, created_at: 'now'
      });
      return;
    }
  }
}

{
  const db = new MockD1();
  const repo = createSignalPromotionRepository(db);
  const preview = await repo.previewPromotion({ trainingRunId: 'train-1', challengerProfileId: 'new' });
  assert.equal(preview.stateGeneration, 4);
  assert.equal(preview.currentChampionProfileId, 'old');
  assert.equal(preview.requiredConfirmation, promotionConfirmation('new', 'old', 4));
  assert.equal(preview.candidateFingerprint, await profileFingerprint(db.profiles.get('new')));
  assert.equal(preview.currentChampionFingerprint, await profileFingerprint(db.profiles.get('old')));

  await assert.rejects(() => repo.promote({
    eventId: 'promote-1', trainingRunId: 'train-1', challengerProfileId: 'new', reason: 'better calibration',
    expectedStateGeneration: 4, expectedCandidateFingerprint: preview.candidateFingerprint,
    expectedChampionFingerprint: preview.currentChampionFingerprint, expectedGateFingerprint: preview.gateFingerprint, confirmation: 'wrong'
  }), error => expectCode(error, 'promotion-confirmation-required'));

  const promoted = await repo.promote({
    eventId: 'promote-1', trainingRunId: 'train-1', challengerProfileId: 'new', reason: 'better calibration', actorLabel: 'operator',
    expectedStateGeneration: 4, expectedCandidateFingerprint: preview.candidateFingerprint,
    expectedChampionFingerprint: preview.currentChampionFingerprint, expectedGateFingerprint: preview.gateFingerprint, confirmation: preview.requiredConfirmation
  });
  assert.equal(promoted.status, 'completed');
  assert.equal(promoted.promotionPerformed, true);
  assert.equal(promoted.automaticPromotion, false);
  assert.equal(promoted.cacheInvalidationMode, 'profile-identity-change');
  assert.equal(db.state.champion_profile_id, 'new');
  assert.equal(db.state.generation, 5);
  assert.equal(db.profiles.get('old').role, 'retired');
  assert.equal(db.profiles.get('new').role, 'champion');

  const repeat = await repo.promote({
    eventId: 'promote-1', trainingRunId: 'train-1', challengerProfileId: 'new', reason: 'better calibration', actorLabel: 'operator'
  });
  assert.equal(repeat.status, 'already-promoted');
  assert.equal(repeat.writesPerformed, false);

  const rollbackPreview = await repo.previewRollback({ promotionEventId: 'promote-1' });
  assert.equal(rollbackPreview.requiredConfirmation, rollbackConfirmation('promote-1', 5));
  assert.equal(rollbackPreview.restoreChampionProfileId, 'old');

  await assert.rejects(() => repo.rollback({
    rollbackEventId: 'rollback-1', promotionEventId: 'promote-1', reason: 'regression',
    expectedStateGeneration: 5, expectedCurrentChampionFingerprint: 'stale',
    expectedRestoreChampionFingerprint: rollbackPreview.restoreChampionFingerprint,
    confirmation: rollbackPreview.requiredConfirmation
  }), error => expectCode(error, 'rollback-preview-stale'));

  const rolledBack = await repo.rollback({
    rollbackEventId: 'rollback-1', promotionEventId: 'promote-1', reason: 'regression', actorLabel: 'operator',
    expectedStateGeneration: 5, expectedCurrentChampionFingerprint: rollbackPreview.currentChampionFingerprint,
    expectedRestoreChampionFingerprint: rollbackPreview.restoreChampionFingerprint,
    confirmation: rollbackPreview.requiredConfirmation
  });
  assert.equal(rolledBack.status, 'completed');
  assert.equal(rolledBack.championProfileId, 'old');
  assert.equal(db.state.generation, 6);
  assert.equal(db.profiles.get('old').role, 'champion');
  assert.equal(db.profiles.get('new').role, 'retired');
  assert.equal(db.events.get('promote-1').rolled_back_by_event_id, 'rollback-1');
}

{
  const db = new MockD1({ withChampion: false });
  const repo = createSignalPromotionRepository(db);
  const preview = await repo.previewPromotion({ trainingRunId: 'train-1', challengerProfileId: 'new' });
  assert.equal(preview.currentChampionProfileId, null);
  assert.equal(preview.currentChampionFingerprint, null);
  const result = await repo.promote({
    eventId: 'bootstrap-1', trainingRunId: 'train-1', challengerProfileId: 'new', reason: 'initial champion',
    expectedStateGeneration: 4, expectedCandidateFingerprint: preview.candidateFingerprint,
    expectedChampionFingerprint: null, expectedGateFingerprint: preview.gateFingerprint, confirmation: preview.requiredConfirmation
  });
  assert.equal(result.previousChampionProfileId, null);
  const rb = await repo.previewRollback({ promotionEventId: 'bootstrap-1' });
  assert.equal(rb.restoreChampionProfileId, null);
  await repo.rollback({
    rollbackEventId: 'bootstrap-rb', promotionEventId: 'bootstrap-1', reason: 'remove initial champion',
    expectedStateGeneration: 5, expectedCurrentChampionFingerprint: rb.currentChampionFingerprint,
    expectedRestoreChampionFingerprint: null, confirmation: rb.requiredConfirmation
  });
  assert.equal(db.state.champion_profile_id, null);
  assert.equal(Array.from(db.profiles.values()).filter(row => row.role === 'champion').length, 0);
}


{
  const db = new MockD1();
  const repo = createSignalPromotionRepository(db);
  const preview = await repo.previewPromotion({ trainingRunId: 'train-1', challengerProfileId: 'new' });
  db.trainingRuns.get('train-1').gate_json = JSON.stringify({ eligibleForPromotion: true, changed: true });
  await assert.rejects(() => repo.promote({
    eventId: 'stale-gate', trainingRunId: 'train-1', challengerProfileId: 'new', reason: 'stale gate',
    expectedStateGeneration: preview.stateGeneration,
    expectedCandidateFingerprint: preview.candidateFingerprint,
    expectedChampionFingerprint: preview.currentChampionFingerprint,
    expectedGateFingerprint: preview.gateFingerprint,
    confirmation: preview.requiredConfirmation
  }), error => expectCode(error, 'promotion-preview-stale'));
}

{
  const db = new MockD1();
  db.trainingRuns.get('train-1').eligible_for_promotion = 0;
  const repo = createSignalPromotionRepository(db);
  await assert.rejects(() => repo.previewPromotion({ trainingRunId: 'train-1', challengerProfileId: 'new' }), error => expectCode(error, 'challenger-not-eligible'));
}

{
  const db = new MockD1();
  db.state.champion_profile_id = 'new';
  const repo = createSignalPromotionRepository(db);
  await assert.rejects(() => repo.previewPromotion({ trainingRunId: 'train-1', challengerProfileId: 'new' }), error => expectCode(error, 'champion-state-inconsistent'));
}


{
  const health = await handleRequest(new Request('https://example.com/health'), { ANALYSIS_DB: {}, ANALYSIS_ADMIN_TOKEN: 'secret' });
  const body = await health.json();
  assert.equal(health.status, 200);
  assert.equal(body.promotionApiEnabled, true);
  assert.equal(body.automaticPromotionEnabled, false);
  assert.equal(body.signalPromotionVersion, 'signal-profile-promotion/v1');
}

{
  const response = await handleRequest(
    new Request('https://example.com/api/admin/signal-risk/promotion/preview', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trainingRunId: 't', challengerProfileId: 'c' })
    }),
    { ANALYSIS_DB: {} }
  );
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error, 'analysis-admin-disabled');
}

{
  const calls = [];
  const repository = {
    async previewPromotion(body) { calls.push(['previewPromotion', body]); return { requiredConfirmation: 'PROMOTE' }; },
    async promote(body) { calls.push(['promote', body]); return { status: 'completed', automaticPromotion: false }; },
    async previewRollback(body) { calls.push(['previewRollback', body]); return { requiredConfirmation: 'ROLLBACK' }; },
    async rollback(body) { calls.push(['rollback', body]); return { status: 'completed', automaticRollback: false }; }
  };
  const dependencies = { createSignalPromotionRepository() { return repository; } };
  const env = { ANALYSIS_DB: {}, ANALYSIS_ADMIN_TOKEN: 'secret' };
  const routes = [
    ['/api/admin/signal-risk/promotion/preview', 'previewPromotion', 'preview'],
    ['/api/admin/signal-risk/promote', 'promote', 'promotion'],
    ['/api/admin/signal-risk/rollback/preview', 'previewRollback', 'preview'],
    ['/api/admin/signal-risk/rollback', 'rollback', 'rollback']
  ];
  for (const [path, method, resultKey] of routes) {
    const response = await handleRequest(new Request(`https://example.com${path}`, {
      method: 'POST', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' }, body: JSON.stringify({ marker: method })
    }), env, dependencies);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.ok(body[resultKey]);
  }
  assert.deepEqual(calls.map(item => item[0]), ['previewPromotion', 'promote', 'previewRollback', 'rollback']);
}

console.log('storm-analysis AI-15 tests: OK');
