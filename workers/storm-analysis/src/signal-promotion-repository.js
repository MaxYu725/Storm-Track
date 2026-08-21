const PROMOTION_VERSION = 'signal-profile-promotion/v1';

function httpError(status, code, message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}
function nonEmpty(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw httpError(400, 'invalid-promotion-request', `${name} is required`);
  return text;
}
function integer(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw httpError(400, 'invalid-promotion-request', `${name} must be a non-negative integer`);
  return number;
}
function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}
function stableClone(value) {
  if (Array.isArray(value)) return value.map(stableClone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableClone(value[key])]));
}
async function sha256Hex(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function profileFingerprint(row) {
  if (!row) return null;
  return sha256Hex(JSON.stringify(stableClone({
    profileId: row.profile_id ?? null,
    profileVersion: row.profile_version ?? null,
    trainingWindowStart: row.training_window_start ?? null,
    trainingWindowEnd: row.training_window_end ?? null,
    stormCount: Number(row.storm_count ?? 0),
    sampleCount: Number(row.sample_count ?? 0),
    profileJson: row.profile_json ?? null,
    metricsJson: row.metrics_json ?? null
  })));
}

function promotionConfirmation(challengerProfileId, championProfileId, generation) {
  return `PROMOTE ${challengerProfileId} FROM ${championProfileId ?? 'NONE'} GENERATION ${generation}`;
}
function rollbackConfirmation(promotionEventId, generation) {
  return `ROLLBACK ${promotionEventId} GENERATION ${generation}`;
}
function resultRows(result) { return Array.isArray(result?.results) ? result.results : []; }

export function createSignalPromotionRepository(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') {
    throw new Error('ANALYSIS_DB D1 binding is required');
  }

  async function getState() {
    return db.prepare(`SELECT state_id, champion_profile_id, generation, updated_at
      FROM signal_calibration_state WHERE state_id = 1 LIMIT 1`).first();
  }
  async function getRoleChampions() {
    return resultRows(await db.prepare(`SELECT profile_id, profile_version, role, training_window_start, training_window_end,
      storm_count, sample_count, profile_json, metrics_json, created_at, activated_at, retired_at
      FROM signal_calibration_profiles WHERE role = 'champion'
      ORDER BY COALESCE(activated_at, created_at) DESC, created_at DESC`).all());
  }
  async function getProfile(profileId) {
    return db.prepare(`SELECT profile_id, profile_version, role, training_window_start, training_window_end,
      storm_count, sample_count, profile_json, metrics_json, created_at, activated_at, retired_at
      FROM signal_calibration_profiles WHERE profile_id = ?1 LIMIT 1`).bind(String(profileId)).first();
  }
  async function getTrainingRun(runId) {
    return db.prepare(`SELECT run_id, challenger_profile_id, status, eligible_for_promotion, gate_json, metrics_json, result_json,
      dataset_fingerprint, input_fingerprint, completed_at
      FROM signal_calibration_training_runs WHERE run_id = ?1 LIMIT 1`).bind(String(runId)).first();
  }
  async function getEvent(eventId) {
    return db.prepare(`SELECT event_id, action, subject_profile_id, champion_before_profile_id, champion_after_profile_id,
      source_training_run_id, rollback_of_event_id, rolled_back_by_event_id, state_generation_before, state_generation_after,
      subject_profile_fingerprint, champion_before_fingerprint, champion_after_fingerprint, gate_json, reason, actor_label, created_at
      FROM signal_profile_promotion_events WHERE event_id = ?1 LIMIT 1`).bind(String(eventId)).first();
  }
  async function assertStateConsistent() {
    const [state, champions] = await Promise.all([getState(), getRoleChampions()]);
    if (!state) throw httpError(503, 'promotion-state-unavailable', 'signal_calibration_state is not initialized; apply AI-15 migration first');
    const stateChampion = state.champion_profile_id == null ? null : String(state.champion_profile_id);
    const consistent = stateChampion == null
      ? champions.length === 0
      : champions.length === 1 && String(champions[0].profile_id) === stateChampion;
    if (!consistent) {
      throw httpError(409, 'champion-state-inconsistent', 'signal calibration role state does not match promotion state', {
        stateChampionProfileId: stateChampion,
        roleChampionProfileIds: champions.map(row => String(row.profile_id))
      });
    }
    return { state, champion: champions[0] ?? null };
  }

  async function previewPromotion(input) {
    const trainingRunId = nonEmpty(input?.trainingRunId, 'trainingRunId');
    const challengerProfileId = nonEmpty(input?.challengerProfileId, 'challengerProfileId');
    const [{ state, champion }, challenger, trainingRun] = await Promise.all([
      assertStateConsistent(), getProfile(challengerProfileId), getTrainingRun(trainingRunId)
    ]);
    if (!challenger) throw httpError(404, 'challenger-profile-not-found', `signal calibration profile ${challengerProfileId} was not found`);
    if (challenger.role !== 'challenger') throw httpError(409, 'profile-not-challenger', 'profile must still have challenger role');
    if (!trainingRun) throw httpError(404, 'training-run-not-found', `training run ${trainingRunId} was not found`);
    if (trainingRun.status !== 'completed' || Number(trainingRun.eligible_for_promotion) !== 1 || String(trainingRun.challenger_profile_id) !== challengerProfileId) {
      throw httpError(409, 'challenger-not-eligible', 'training run does not certify this Challenger as eligible for promotion');
    }
    const [candidateFingerprint, championFingerprint, gateFingerprint] = await Promise.all([
      profileFingerprint(challenger),
      profileFingerprint(champion),
      sha256Hex(String(trainingRun.gate_json ?? ''))
    ]);
    const generation = Number(state.generation);
    return {
      schemaVersion: PROMOTION_VERSION,
      dryRun: true,
      writesPerformed: false,
      trainingRunId,
      challengerProfileId,
      candidateFingerprint,
      currentChampionProfileId: champion?.profile_id ?? null,
      currentChampionFingerprint: championFingerprint,
      gateFingerprint,
      stateGeneration: generation,
      gate: parseJson(trainingRun.gate_json),
      requiredConfirmation: promotionConfirmation(challengerProfileId, champion?.profile_id ?? null, generation),
      semantics: {
        eligibleTrainingRunRequired: true,
        profileContentFingerprintRequired: true,
        stateGenerationCasRequired: true,
        explicitConfirmationRequired: true,
        automaticPromotion: false
      }
    };
  }

  async function promote(input) {
    const eventId = nonEmpty(input?.eventId, 'eventId');
    const reason = nonEmpty(input?.reason, 'reason');
    const actorLabel = input?.actorLabel == null ? null : String(input.actorLabel).trim() || null;
    const trainingRunId = nonEmpty(input?.trainingRunId, 'trainingRunId');
    const challengerProfileId = nonEmpty(input?.challengerProfileId, 'challengerProfileId');
    const existing = await getEvent(eventId);
    if (existing) {
      const same = existing.action === 'promote'
        && String(existing.subject_profile_id) === challengerProfileId
        && String(existing.source_training_run_id) === trainingRunId
        && String(existing.reason) === reason
        && String(existing.actor_label ?? '') === String(actorLabel ?? '');
      if (!same) throw httpError(409, 'promotion-event-id-conflict', 'eventId already exists with different promotion content');
      return { status: 'already-promoted', schemaVersion: PROMOTION_VERSION, eventId, writesPerformed: false, championProfileId: existing.champion_after_profile_id };
    }

    const preview = await previewPromotion({ trainingRunId, challengerProfileId });
    const expectedGeneration = integer(input?.expectedStateGeneration, 'expectedStateGeneration');
    const expectedCandidateFingerprint = nonEmpty(input?.expectedCandidateFingerprint, 'expectedCandidateFingerprint');
    const expectedChampionFingerprint = input?.expectedChampionFingerprint == null || input.expectedChampionFingerprint === ''
      ? null : String(input.expectedChampionFingerprint);
    const expectedGateFingerprint = nonEmpty(input?.expectedGateFingerprint, 'expectedGateFingerprint');
    if (expectedGeneration !== preview.stateGeneration
      || expectedCandidateFingerprint !== preview.candidateFingerprint
      || expectedChampionFingerprint !== preview.currentChampionFingerprint
      || expectedGateFingerprint !== preview.gateFingerprint) {
      throw httpError(409, 'promotion-preview-stale', 'promotion state changed after preview', {
        expectedStateGeneration: expectedGeneration,
        actualStateGeneration: preview.stateGeneration,
        expectedCandidateFingerprint,
        actualCandidateFingerprint: preview.candidateFingerprint,
        expectedChampionFingerprint,
        actualChampionFingerprint: preview.currentChampionFingerprint,
        expectedGateFingerprint,
        actualGateFingerprint: preview.gateFingerprint
      });
    }
    if (String(input?.confirmation || '') !== preview.requiredConfirmation) {
      throw httpError(400, 'promotion-confirmation-required', 'confirmation must exactly match the promotion preview phrase');
    }

    const [challenger, trainingRun] = await Promise.all([getProfile(challengerProfileId), getTrainingRun(trainingRunId)]);
    const previousChampionId = preview.currentChampionProfileId;
    const previousChampion = previousChampionId ? await getProfile(previousChampionId) : null;
    const [transactionCandidateFingerprint, transactionChampionFingerprint, transactionGateFingerprint] = await Promise.all([
      profileFingerprint(challenger),
      profileFingerprint(previousChampion),
      sha256Hex(String(trainingRun?.gate_json ?? ''))
    ]);
    if (transactionCandidateFingerprint !== preview.candidateFingerprint
      || transactionChampionFingerprint !== preview.currentChampionFingerprint
      || transactionGateFingerprint !== preview.gateFingerprint) {
      throw httpError(409, 'promotion-preview-stale', 'promotion content changed before transaction preparation');
    }
    const nextGeneration = expectedGeneration + 1;
    const statements = [];
    if (previousChampionId) {
      statements.push(db.prepare(`UPDATE signal_calibration_profiles SET role='retired', retired_at=CURRENT_TIMESTAMP
        WHERE profile_id=?1 AND role='champion'`).bind(previousChampionId));
    }
    statements.push(db.prepare(`UPDATE signal_calibration_profiles SET role='champion', activated_at=CURRENT_TIMESTAMP, retired_at=NULL
      WHERE profile_id=?1 AND role='challenger' AND profile_json=?2 AND COALESCE(metrics_json,'')=COALESCE(?3,'')`)
      .bind(challengerProfileId, challenger.profile_json, challenger.metrics_json ?? null));
    statements.push(db.prepare(`UPDATE signal_calibration_state SET champion_profile_id=?1, generation=generation+1, updated_at=CURRENT_TIMESTAMP
      WHERE state_id=1 AND generation=?2 AND champion_profile_id IS ?3`)
      .bind(challengerProfileId, expectedGeneration, previousChampionId));
    statements.push(db.prepare(`INSERT INTO signal_profile_promotion_events
      (event_id, action, subject_profile_id, champion_before_profile_id, champion_after_profile_id,
       source_training_run_id, rollback_of_event_id, state_generation_before, state_generation_after,
       subject_profile_fingerprint, champion_before_fingerprint, champion_after_fingerprint, gate_json,
       transition_guard, reason, actor_label)
      VALUES (
       ?1, 'promote',
       (SELECT profile_id FROM signal_calibration_profiles WHERE profile_id=?2 AND role='champion' AND profile_json=?3 AND COALESCE(metrics_json,'')=COALESCE(?4,'')),
       ?5, ?2,
       (SELECT run_id FROM signal_calibration_training_runs WHERE run_id=?6 AND status='completed' AND eligible_for_promotion=1 AND challenger_profile_id=?2 AND COALESCE(gate_json,'')=COALESCE(?13,'')),
       NULL, ?7,
       (SELECT generation FROM signal_calibration_state WHERE state_id=1 AND generation=?8 AND champion_profile_id=?2),
       ?9, ?10, ?9,
       ?13,
       (SELECT 1 WHERE ?5 IS NULL OR EXISTS(SELECT 1 FROM signal_calibration_profiles WHERE profile_id=?5 AND role='retired' AND profile_json=?14 AND COALESCE(metrics_json,'')=COALESCE(?15,''))),
       ?11, ?12
      )`)
      .bind(
        eventId, challengerProfileId, challenger.profile_json, challenger.metrics_json ?? null,
        previousChampionId, trainingRunId, expectedGeneration, nextGeneration,
        preview.candidateFingerprint, preview.currentChampionFingerprint, reason, actorLabel, trainingRun?.gate_json ?? null,
        previousChampion?.profile_json ?? null, previousChampion?.metrics_json ?? null
      ));

    try { await db.batch(statements); }
    catch (error) {
      const wrapped = httpError(409, 'promotion-transaction-conflict', 'promotion preconditions changed before the atomic transition could commit');
      wrapped.cause = error;
      throw wrapped;
    }
    const after = await assertStateConsistent();
    if (String(after.state.champion_profile_id) !== challengerProfileId || Number(after.state.generation) !== nextGeneration) {
      throw httpError(500, 'promotion-write-inconsistent', 'promotion transaction completed but champion state verification failed');
    }
    return {
      status: 'completed', schemaVersion: PROMOTION_VERSION, eventId,
      championProfileId: challengerProfileId,
      previousChampionProfileId: previousChampionId,
      stateGeneration: nextGeneration,
      writesPerformed: true,
      promotionPerformed: true,
      automaticPromotion: false,
      cacheInvalidationMode: 'profile-identity-change'
    };
  }

  async function previewRollback(input) {
    const promotionEventId = nonEmpty(input?.promotionEventId, 'promotionEventId');
    const promotion = await getEvent(promotionEventId);
    if (!promotion || promotion.action !== 'promote') throw httpError(404, 'promotion-event-not-found', `promotion event ${promotionEventId} was not found`);
    if (promotion.rolled_back_by_event_id) throw httpError(409, 'promotion-already-rolled-back', 'promotion event has already been rolled back', { rollbackEventId: promotion.rolled_back_by_event_id });
    const { state, champion } = await assertStateConsistent();
    if (String(state.champion_profile_id ?? '') !== String(promotion.champion_after_profile_id ?? '')) {
      throw httpError(409, 'rollback-not-current-champion', 'only the promotion that produced the current Champion can be rolled back');
    }
    const restoreProfile = promotion.champion_before_profile_id ? await getProfile(promotion.champion_before_profile_id) : null;
    if (promotion.champion_before_profile_id && (!restoreProfile || restoreProfile.role !== 'retired')) {
      throw httpError(409, 'rollback-target-unavailable', 'previous Champion is not available in retired state');
    }
    const [currentFingerprint, restoreFingerprint] = await Promise.all([
      profileFingerprint(champion), profileFingerprint(restoreProfile)
    ]);
    const generation = Number(state.generation);
    return {
      schemaVersion: PROMOTION_VERSION,
      dryRun: true,
      writesPerformed: false,
      promotionEventId,
      currentChampionProfileId: champion?.profile_id ?? null,
      currentChampionFingerprint: currentFingerprint,
      restoreChampionProfileId: restoreProfile?.profile_id ?? null,
      restoreChampionFingerprint: restoreFingerprint,
      stateGeneration: generation,
      requiredConfirmation: rollbackConfirmation(promotionEventId, generation),
      semantics: {
        immediateCurrentPromotionOnly: true,
        stateGenerationCasRequired: true,
        explicitConfirmationRequired: true,
        automaticRollback: false
      }
    };
  }

  async function rollback(input) {
    const rollbackEventId = nonEmpty(input?.rollbackEventId, 'rollbackEventId');
    const promotionEventId = nonEmpty(input?.promotionEventId, 'promotionEventId');
    const reason = nonEmpty(input?.reason, 'reason');
    const actorLabel = input?.actorLabel == null ? null : String(input.actorLabel).trim() || null;
    const existing = await getEvent(rollbackEventId);
    if (existing) {
      const same = existing.action === 'rollback'
        && String(existing.rollback_of_event_id) === promotionEventId
        && String(existing.reason) === reason
        && String(existing.actor_label ?? '') === String(actorLabel ?? '');
      if (!same) throw httpError(409, 'promotion-event-id-conflict', 'rollbackEventId already exists with different content');
      return { status: 'already-rolled-back', schemaVersion: PROMOTION_VERSION, eventId: rollbackEventId, writesPerformed: false, championProfileId: existing.champion_after_profile_id ?? null };
    }

    const preview = await previewRollback({ promotionEventId });
    const expectedGeneration = integer(input?.expectedStateGeneration, 'expectedStateGeneration');
    const expectedCurrentFingerprint = nonEmpty(input?.expectedCurrentChampionFingerprint, 'expectedCurrentChampionFingerprint');
    const expectedRestoreFingerprint = input?.expectedRestoreChampionFingerprint == null || input.expectedRestoreChampionFingerprint === ''
      ? null : String(input.expectedRestoreChampionFingerprint);
    if (expectedGeneration !== preview.stateGeneration
      || expectedCurrentFingerprint !== preview.currentChampionFingerprint
      || expectedRestoreFingerprint !== preview.restoreChampionFingerprint) {
      throw httpError(409, 'rollback-preview-stale', 'rollback state changed after preview');
    }
    if (String(input?.confirmation || '') !== preview.requiredConfirmation) {
      throw httpError(400, 'rollback-confirmation-required', 'confirmation must exactly match the rollback preview phrase');
    }

    const promotion = await getEvent(promotionEventId);
    const currentProfileId = preview.currentChampionProfileId;
    const restoreProfileId = preview.restoreChampionProfileId;
    const currentProfile = await getProfile(currentProfileId);
    const restoreProfile = restoreProfileId ? await getProfile(restoreProfileId) : null;
    const [transactionCurrentFingerprint, transactionRestoreFingerprint] = await Promise.all([
      profileFingerprint(currentProfile),
      profileFingerprint(restoreProfile)
    ]);
    if (transactionCurrentFingerprint !== preview.currentChampionFingerprint
      || transactionRestoreFingerprint !== preview.restoreChampionFingerprint) {
      throw httpError(409, 'rollback-preview-stale', 'rollback content changed before transaction preparation');
    }
    const nextGeneration = expectedGeneration + 1;
    const statements = [
      db.prepare(`UPDATE signal_calibration_profiles SET role='retired', retired_at=CURRENT_TIMESTAMP
        WHERE profile_id=?1 AND role='champion'`).bind(currentProfileId)
    ];
    if (restoreProfileId) {
      statements.push(db.prepare(`UPDATE signal_calibration_profiles SET role='champion', activated_at=CURRENT_TIMESTAMP, retired_at=NULL
        WHERE profile_id=?1 AND role='retired' AND profile_json=?2 AND COALESCE(metrics_json,'')=COALESCE(?3,'')`)
        .bind(restoreProfileId, restoreProfile.profile_json, restoreProfile.metrics_json ?? null));
    }
    statements.push(db.prepare(`UPDATE signal_calibration_state SET champion_profile_id=?1, generation=generation+1, updated_at=CURRENT_TIMESTAMP
      WHERE state_id=1 AND generation=?2 AND champion_profile_id=?3`)
      .bind(restoreProfileId, expectedGeneration, currentProfileId));
    statements.push(db.prepare(`INSERT INTO signal_profile_promotion_events
      (event_id, action, subject_profile_id, champion_before_profile_id, champion_after_profile_id,
       source_training_run_id, rollback_of_event_id, state_generation_before, state_generation_after,
       subject_profile_fingerprint, champion_before_fingerprint, champion_after_fingerprint, gate_json,
       transition_guard, reason, actor_label)
      VALUES (
       ?1, 'rollback',
       (SELECT profile_id FROM signal_calibration_profiles WHERE profile_id=?2 AND role='retired' AND profile_json=?3 AND COALESCE(metrics_json,'')=COALESCE(?4,'')),
       ?2, ?5, ?6,
       (SELECT event_id FROM signal_profile_promotion_events WHERE event_id=?7 AND action='promote' AND rolled_back_by_event_id IS NULL),
       ?8,
       (SELECT generation FROM signal_calibration_state WHERE state_id=1 AND generation=?9 AND champion_profile_id IS ?5),
       ?10, ?10, ?11, ?12,
       (SELECT 1 WHERE ?5 IS NULL OR EXISTS(SELECT 1 FROM signal_calibration_profiles WHERE profile_id=?5 AND role='champion')),
       ?13, ?14
      )`)
      .bind(
        rollbackEventId, currentProfileId, currentProfile.profile_json, currentProfile.metrics_json ?? null,
        restoreProfileId, promotion.source_training_run_id ?? null, promotionEventId,
        expectedGeneration, nextGeneration,
        preview.currentChampionFingerprint, preview.restoreChampionFingerprint, promotion.gate_json ?? null,
        reason, actorLabel
      ));
    statements.push(db.prepare(`UPDATE signal_profile_promotion_events SET rolled_back_by_event_id=?1
      WHERE event_id=?2 AND action='promote' AND rolled_back_by_event_id IS NULL AND champion_after_profile_id=?3`)
      .bind(rollbackEventId, promotionEventId, currentProfileId));

    try { await db.batch(statements); }
    catch (error) {
      const wrapped = httpError(409, 'rollback-transaction-conflict', 'rollback preconditions changed before the atomic transition could commit');
      wrapped.cause = error;
      throw wrapped;
    }
    const after = await assertStateConsistent();
    const actualChampion = after.state.champion_profile_id == null ? null : String(after.state.champion_profile_id);
    if (actualChampion !== restoreProfileId || Number(after.state.generation) !== nextGeneration) {
      throw httpError(500, 'rollback-write-inconsistent', 'rollback transaction completed but champion state verification failed');
    }
    return {
      status: 'completed', schemaVersion: PROMOTION_VERSION,
      eventId: rollbackEventId, rollbackOfEventId: promotionEventId,
      championProfileId: restoreProfileId,
      retiredProfileId: currentProfileId,
      stateGeneration: nextGeneration,
      writesPerformed: true,
      rollbackPerformed: true,
      automaticRollback: false,
      cacheInvalidationMode: 'profile-identity-change'
    };
  }

  return Object.freeze({
    getState,
    getEvent,
    previewPromotion,
    promote,
    previewRollback,
    rollback
  });
}

export { PROMOTION_VERSION, promotionConfirmation, rollbackConfirmation };
