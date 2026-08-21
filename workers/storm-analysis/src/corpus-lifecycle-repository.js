import { createBackfillRepository, validateImportPlan } from './backfill-repository.js';

export const CORPUS_CAPTURE_VERSION = 'corpus-lifecycle-capture/v1';
export const LIFECYCLE_STATES = Object.freeze(['active', 'quiescent', 'frozen']);
export const IDENTITY_REVIEW_STATES = Object.freeze(['unreviewed', 'reviewed', 'rejected']);
const MAX_MERGE_DEPTH = 32;

function httpError(status, code, message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function nonEmpty(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw httpError(400, 'invalid-corpus-request', `${name} must be a non-empty string`);
  return value.trim();
}

function iso(value, name) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw httpError(400, 'invalid-corpus-request', `${name} must be a valid timestamp`);
  return new Date(parsed).toISOString();
}

function normalizeLifecycleState(value, name = 'lifecycle state') {
  const normalized = value === 'closed' ? 'frozen' : String(value || '').trim().toLowerCase();
  if (!LIFECYCLE_STATES.includes(normalized)) throw httpError(400, 'invalid-lifecycle-state', `${name} must be active, quiescent or frozen`);
  return normalized;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function immutableSnapshotMatch(existing, planned) {
  return existing
    && existing.storm_key === planned.values.storm_key
    && existing.as_of === planned.values.as_of
    && existing.fingerprint === planned.values.fingerprint
    && existing.payload_hash === planned.values.payload_hash;
}

export function classifySnapshotAgainstExisting(planned, existingById, existingAtCutoff) {
  if (existingById) {
    if (!immutableSnapshotMatch(existingById, planned)) {
      throw httpError(409, 'snapshot-id-conflict', `snapshot ${planned.primaryKey} already exists with different immutable content`, {
        snapshotId: planned.primaryKey,
        stormKey: planned.values.storm_key,
        asOf: planned.values.as_of
      });
    }
    return { disposition: 'existing', canonicalSnapshotId: existingById.snapshot_id, reason: 'same-id-same-fingerprint' };
  }
  if (existingAtCutoff) {
    if (!immutableSnapshotMatch(existingAtCutoff, planned)) {
      throw httpError(409, 'snapshot-cutoff-conflict', `storm ${planned.values.storm_key} already has different snapshot content at ${planned.values.as_of}`, {
        plannedSnapshotId: planned.primaryKey,
        existingSnapshotId: existingAtCutoff.snapshot_id,
        stormKey: planned.values.storm_key,
        asOf: planned.values.as_of
      });
    }
    return { disposition: 'existing', canonicalSnapshotId: existingAtCutoff.snapshot_id, reason: 'same-cutoff-same-fingerprint' };
  }
  return { disposition: 'appended', canonicalSnapshotId: planned.primaryKey, reason: 'new-cutoff' };
}

export function validateLifecycleTransition(fromState, toState) {
  const from = normalizeLifecycleState(fromState, 'fromState');
  const to = normalizeLifecycleState(toState, 'toState');
  if (from === to) return { from, to, noop: true };
  const allowed = (from === 'active' && (to === 'quiescent' || to === 'frozen'))
    || (from === 'quiescent' && (to === 'active' || to === 'frozen'));
  if (!allowed) throw httpError(409, 'invalid-lifecycle-transition', `cannot transition capture window from ${from} to ${to}`);
  return { from, to, noop: false };
}

export function validateCaptureRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw httpError(400, 'invalid-corpus-request', 'request body must be a corpus lifecycle capture object');
  if (input.schemaVersion !== CORPUS_CAPTURE_VERSION) throw httpError(400, 'unsupported-corpus-version', `schemaVersion must be ${CORPUS_CAPTURE_VERSION}`);
  const generatedAt = iso(input.generatedAt, 'generatedAt');
  const evidenceSha256 = nonEmpty(input.evidenceSha256, 'evidenceSha256');
  const fingerprint = nonEmpty(input.captureFingerprint, 'captureFingerprint');
  if (!/^[0-9a-f]{64}$/i.test(evidenceSha256) || !/^[0-9a-f]{64}$/i.test(fingerprint)) {
    throw httpError(400, 'invalid-corpus-request', 'evidenceSha256 and captureFingerprint must be SHA-256 hex strings');
  }
  const plan = validateImportPlan(input.plan);
  for (const table of ['truth_datasets', 'truth_points', 'signal_outcomes']) {
    if (plan.tableCounts[table]) throw httpError(400, 'corpus-scope-violation', `AI-22 forecast capture cannot write ${table}`);
  }
  const snapshots = plan.rows.filter(row => row.table === 'forecast_snapshots');
  if (!snapshots.length) throw httpError(400, 'invalid-corpus-request', 'capture plan must contain forecast snapshots');
  const stormRows = new Map(plan.rows.filter(row => row.table === 'historical_storms').map(row => [row.primaryKey, row]));
  const stormKeys = Array.from(new Set(snapshots.map(row => row.values.storm_key))).sort();
  for (const stormKey of stormKeys) {
    if (!stormRows.has(stormKey)) throw httpError(400, 'missing-corpus-storm-row', `capture plan is missing historical_storms row for ${stormKey}`);
  }

  const captures = Array.isArray(input.captures) ? input.captures.map((item, index) => ({
    windowId: nonEmpty(item?.windowId, `captures[${index}].windowId`),
    stormKey: nonEmpty(item?.stormKey, `captures[${index}].stormKey`),
    initialState: normalizeLifecycleState(item?.initialState || 'active', `captures[${index}].initialState`)
  })) : [];
  if (captures.length !== stormKeys.length) throw httpError(400, 'capture-window-mismatch', 'captures must contain exactly one window for each storm in the plan');
  if (new Set(captures.map(item => item.windowId)).size !== captures.length) throw httpError(400, 'duplicate-capture-window', 'capture window ids must be unique within a run');
  const captureByStorm = new Map(captures.map(item => [item.stormKey, item]));
  if (captureByStorm.size !== captures.length || stormKeys.some(key => !captureByStorm.has(key))) {
    throw httpError(400, 'capture-window-mismatch', 'capture storm keys must exactly match forecast snapshot storm keys');
  }

  const identityProposals = Array.isArray(input.identityProposals) ? input.identityProposals.map((item, index) => {
    const reviewStatus = String(item?.reviewStatus || 'unreviewed').trim().toLowerCase();
    if (reviewStatus !== 'unreviewed') throw httpError(400, 'identity-review-required', 'capture requests may only record unreviewed identity proposals; reviewed decisions require the admin identity route');
    const stormKey = nonEmpty(item?.stormKey, `identityProposals[${index}].stormKey`);
    if (!stormKeys.includes(stormKey)) throw httpError(400, 'identity-storm-mismatch', `identity proposal ${index} targets a storm outside this capture`);
    return {
      bindingId: nonEmpty(item?.bindingId, `identityProposals[${index}].bindingId`),
      stormKey,
      identityType: nonEmpty(item?.identityType, `identityProposals[${index}].identityType`),
      identityValue: nonEmpty(item?.identityValue, `identityProposals[${index}].identityValue`),
      reviewStatus,
      source: item?.source == null ? null : String(item.source),
      evidenceSha256: item?.evidenceSha256 == null ? evidenceSha256 : nonEmpty(item.evidenceSha256, `identityProposals[${index}].evidenceSha256`),
      proposedAt: iso(item?.proposedAt || generatedAt, `identityProposals[${index}].proposedAt`),
      reviewedAt: null,
      reviewer: null,
      fingerprint: nonEmpty(item?.fingerprint, `identityProposals[${index}].fingerprint`)
    };
  }) : [];

  return { generatedAt, evidenceSha256, fingerprint, plan, captures, captureByStorm, identityProposals, stormKeys, snapshots, stormRows };
}

async function first(db, sql, ...params) {
  return db.prepare(sql).bind(...params).first();
}

async function getWindow(db, windowId) {
  return first(db, 'SELECT window_id, storm_key, lifecycle_state, opened_at, quiescent_at, frozen_at, last_capture_run_id, last_capture_at, updated_at FROM corpus_capture_windows WHERE window_id = ?1 LIMIT 1', windowId);
}

async function getHistoricalStorm(db, stormKey) {
  return first(db, 'SELECT storm_key, name_tc, name_en, season, basin, backfill_mode, agency_skill_eligible, updated_at FROM historical_storms WHERE storm_key = ?1 LIMIT 1', stormKey);
}

async function getSnapshotById(db, snapshotId) {
  return first(db, 'SELECT snapshot_id, storm_key, as_of, fingerprint, payload_hash FROM forecast_snapshots WHERE snapshot_id = ?1 LIMIT 1', snapshotId);
}

async function getSnapshotAtCutoff(db, stormKey, asOf) {
  return first(db, 'SELECT snapshot_id, storm_key, as_of, fingerprint, payload_hash FROM forecast_snapshots WHERE storm_key = ?1 AND as_of = ?2 ORDER BY snapshot_id LIMIT 1', stormKey, asOf);
}

function preserveExistingStormMetadata(plan, existingStorms) {
  const next = clone(plan);
  for (const row of next.rows) {
    if (row.table !== 'historical_storms') continue;
    const existing = existingStorms.get(row.primaryKey);
    if (!existing) continue;
    row.values = {
      storm_key: existing.storm_key,
      name_tc: existing.name_tc,
      name_en: existing.name_en,
      season: existing.season,
      basin: existing.basin,
      backfill_mode: existing.backfill_mode,
      agency_skill_eligible: existing.agency_skill_eligible,
      updated_at: existing.updated_at
    };
  }
  return next;
}

async function classify(db, validated) {
  const windows = new Map();
  const existingStorms = new Map();
  for (const capture of validated.captures) {
    const window = await getWindow(db, capture.windowId);
    if (window && window.storm_key !== capture.stormKey) {
      throw httpError(409, 'capture-window-storm-conflict', `window ${capture.windowId} belongs to ${window.storm_key}, not ${capture.stormKey}`);
    }
    windows.set(capture.stormKey, window);
    const existingStorm = await getHistoricalStorm(db, capture.stormKey);
    if (existingStorm) existingStorms.set(capture.stormKey, existingStorm);
  }

  const classifications = [];
  for (const snapshot of validated.snapshots) {
    const byId = await getSnapshotById(db, snapshot.primaryKey);
    const atCutoff = byId ? null : await getSnapshotAtCutoff(db, snapshot.values.storm_key, snapshot.values.as_of);
    const result = classifySnapshotAgainstExisting(snapshot, byId, atCutoff);
    const window = windows.get(snapshot.values.storm_key);
    if (window?.lifecycle_state === 'frozen' && result.disposition === 'appended') {
      throw httpError(409, 'capture-window-frozen', `capture window ${window.window_id} is frozen and cannot accept new snapshots`, {
        stormKey: snapshot.values.storm_key,
        snapshotId: snapshot.primaryKey,
        asOf: snapshot.values.as_of
      });
    }
    classifications.push({
      stormKey: snapshot.values.storm_key,
      windowId: validated.captureByStorm.get(snapshot.values.storm_key).windowId,
      plannedSnapshotId: snapshot.primaryKey,
      canonicalSnapshotId: result.canonicalSnapshotId,
      asOf: snapshot.values.as_of,
      fingerprint: snapshot.values.fingerprint,
      disposition: result.disposition,
      reason: result.reason
    });
  }

  let sanitizedPlan = preserveExistingStormMetadata(validated.plan, existingStorms);
  const appendedIds = new Set(classifications.filter(item => item.disposition === 'appended').map(item => item.plannedSnapshotId));
  sanitizedPlan.rows = sanitizedPlan.rows.filter(row => row.table !== 'forecast_snapshots' || appendedIds.has(row.primaryKey));

  const byStorm = Object.fromEntries(validated.stormKeys.map(stormKey => {
    const rows = classifications.filter(item => item.stormKey === stormKey);
    return [stormKey, {
      windowId: validated.captureByStorm.get(stormKey).windowId,
      existingState: windows.get(stormKey)?.lifecycle_state ?? null,
      initialState: validated.captureByStorm.get(stormKey).initialState,
      planned: rows.length,
      appended: rows.filter(item => item.disposition === 'appended').length,
      existing: rows.filter(item => item.disposition === 'existing').length
    }];
  }));

  return { windows, existingStorms, classifications, sanitizedPlan, byStorm };
}

function bindingValues(input) {
  const reviewStatus = String(input?.reviewStatus || '').trim().toLowerCase();
  if (!IDENTITY_REVIEW_STATES.includes(reviewStatus)) throw httpError(400, 'invalid-identity-review-status', 'reviewStatus must be unreviewed, reviewed or rejected');
  const reviewed = reviewStatus === 'reviewed';
  return {
    bindingId: nonEmpty(input?.bindingId, 'bindingId'),
    stormKey: nonEmpty(input?.stormKey, 'stormKey'),
    identityType: nonEmpty(input?.identityType, 'identityType'),
    identityValue: nonEmpty(input?.identityValue, 'identityValue'),
    reviewStatus,
    source: input?.source == null ? null : String(input.source),
    evidenceSha256: input?.evidenceSha256 == null ? null : nonEmpty(input.evidenceSha256, 'evidenceSha256'),
    proposedAt: iso(input?.proposedAt, 'proposedAt'),
    reviewedAt: reviewed ? iso(input?.reviewedAt, 'reviewedAt') : null,
    reviewer: reviewed ? nonEmpty(input?.reviewer, 'reviewer') : null,
    fingerprint: nonEmpty(input?.fingerprint, 'fingerprint')
  };
}

function mergeValues(input) {
  const reviewStatus = String(input?.reviewStatus || '').trim().toLowerCase();
  if (!IDENTITY_REVIEW_STATES.includes(reviewStatus)) throw httpError(400, 'invalid-identity-review-status', 'reviewStatus must be unreviewed, reviewed or rejected');
  const reviewed = reviewStatus === 'reviewed';
  const fromStormKey = nonEmpty(input?.fromStormKey, 'fromStormKey');
  const toStormKey = nonEmpty(input?.toStormKey, 'toStormKey');
  if (fromStormKey === toStormKey) throw httpError(400, 'invalid-storm-merge', 'fromStormKey and toStormKey must be different');
  return {
    mergeId: nonEmpty(input?.mergeId, 'mergeId'), fromStormKey, toStormKey, reviewStatus,
    reason: input?.reason == null ? null : String(input.reason), source: input?.source == null ? null : String(input.source),
    evidenceSha256: input?.evidenceSha256 == null ? null : nonEmpty(input.evidenceSha256, 'evidenceSha256'),
    proposedAt: iso(input?.proposedAt, 'proposedAt'),
    reviewedAt: reviewed ? iso(input?.reviewedAt, 'reviewedAt') : null,
    reviewer: reviewed ? nonEmpty(input?.reviewer, 'reviewer') : null,
    fingerprint: nonEmpty(input?.fingerprint, 'fingerprint')
  };
}

export function createCorpusLifecycleRepository(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('ANALYSIS_DB D1 binding is required');
  const backfillRepository = options.backfillRepository || createBackfillRepository(db, options.backfillOptions);

  async function recordIdentityBinding(input) {
    const value = bindingValues(input);
    const byId = await first(db, 'SELECT binding_id, storm_key, identity_type, identity_value, review_status, fingerprint FROM storm_identity_bindings WHERE binding_id = ?1 LIMIT 1', value.bindingId);
    if (byId) {
      if (byId.fingerprint !== value.fingerprint || byId.review_status !== value.reviewStatus || byId.storm_key !== value.stormKey) {
        throw httpError(409, 'identity-binding-id-conflict', `bindingId ${value.bindingId} already exists with different content`);
      }
      return { status: 'already-recorded', bindingId: byId.binding_id, reviewStatus: byId.review_status, canonical: byId.review_status === 'reviewed', writesPerformed: false };
    }
    if (value.reviewStatus === 'reviewed') {
      const reviewed = await first(db, "SELECT binding_id, storm_key, fingerprint FROM storm_identity_bindings WHERE identity_type = ?1 AND identity_value = ?2 AND review_status = 'reviewed' LIMIT 1", value.identityType, value.identityValue);
      if (reviewed) {
        if (reviewed.storm_key !== value.stormKey) throw httpError(409, 'reviewed-identity-conflict', `${value.identityType}:${value.identityValue} is already reviewed for ${reviewed.storm_key}`);
        return { status: 'already-reviewed', bindingId: reviewed.binding_id, reviewStatus: 'reviewed', canonical: true, writesPerformed: false };
      }
    }
    await db.prepare(`INSERT INTO storm_identity_bindings (
      binding_id, storm_key, identity_type, identity_value, review_status, source, evidence_sha256,
      proposed_at, reviewed_at, reviewer, fingerprint
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`)
      .bind(value.bindingId, value.stormKey, value.identityType, value.identityValue, value.reviewStatus, value.source, value.evidenceSha256, value.proposedAt, value.reviewedAt, value.reviewer, value.fingerprint).run();
    return { status: 'recorded', bindingId: value.bindingId, reviewStatus: value.reviewStatus, canonical: value.reviewStatus === 'reviewed', writesPerformed: true };
  }

  async function resolveStormKey(stormKey) {
    const original = nonEmpty(stormKey, 'stormKey');
    let current = original;
    const visited = new Set([current]);
    for (let depth = 0; depth < MAX_MERGE_DEPTH; depth += 1) {
      const row = await first(db, "SELECT to_storm_key FROM storm_identity_merges WHERE from_storm_key = ?1 AND review_status = 'reviewed' LIMIT 1", current);
      if (!row) return { inputStormKey: original, canonicalStormKey: current, merged: current !== original, depth };
      current = row.to_storm_key;
      if (visited.has(current)) throw httpError(409, 'reviewed-merge-cycle', `reviewed storm merge cycle detected at ${current}`);
      visited.add(current);
    }
    throw httpError(409, 'merge-depth-exceeded', `reviewed storm merge chain exceeds ${MAX_MERGE_DEPTH}`);
  }

  async function recordStormMerge(input) {
    const value = mergeValues(input);
    const byId = await first(db, 'SELECT merge_id, from_storm_key, to_storm_key, review_status, fingerprint FROM storm_identity_merges WHERE merge_id = ?1 LIMIT 1', value.mergeId);
    if (byId) {
      if (byId.fingerprint !== value.fingerprint || byId.review_status !== value.reviewStatus || byId.from_storm_key !== value.fromStormKey || byId.to_storm_key !== value.toStormKey) {
        throw httpError(409, 'storm-merge-id-conflict', `mergeId ${value.mergeId} already exists with different content`);
      }
      return { status: 'already-recorded', mergeId: value.mergeId, reviewStatus: value.reviewStatus, writesPerformed: false };
    }
    if (value.reviewStatus === 'reviewed') {
      const existing = await first(db, "SELECT merge_id, to_storm_key FROM storm_identity_merges WHERE from_storm_key = ?1 AND review_status = 'reviewed' LIMIT 1", value.fromStormKey);
      if (existing) {
        if (existing.to_storm_key !== value.toStormKey) throw httpError(409, 'reviewed-merge-conflict', `${value.fromStormKey} is already reviewed to merge into ${existing.to_storm_key}`);
        return { status: 'already-reviewed', mergeId: existing.merge_id, reviewStatus: 'reviewed', writesPerformed: false };
      }
      const target = await resolveStormKey(value.toStormKey);
      if (target.canonicalStormKey === value.fromStormKey) throw httpError(409, 'reviewed-merge-cycle', `reviewing ${value.fromStormKey} -> ${value.toStormKey} would create a merge cycle`);
    }
    await db.prepare(`INSERT INTO storm_identity_merges (
      merge_id, from_storm_key, to_storm_key, review_status, reason, source, evidence_sha256,
      proposed_at, reviewed_at, reviewer, fingerprint
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`)
      .bind(value.mergeId, value.fromStormKey, value.toStormKey, value.reviewStatus, value.reason, value.source, value.evidenceSha256, value.proposedAt, value.reviewedAt, value.reviewer, value.fingerprint).run();
    return { status: 'recorded', mergeId: value.mergeId, reviewStatus: value.reviewStatus, writesPerformed: true };
  }

  async function transitionWindow(input) {
    const windowId = nonEmpty(input?.windowId, 'windowId');
    const toState = normalizeLifecycleState(input?.toState, 'toState');
    const occurredAt = iso(input?.occurredAt, 'occurredAt');
    const reason = input?.reason == null ? null : String(input.reason);
    const window = await getWindow(db, windowId);
    if (!window) throw httpError(404, 'capture-window-not-found', `capture window ${windowId} was not found`);
    const transition = validateLifecycleTransition(window.lifecycle_state, toState);
    if (transition.noop) return { status: 'already-in-state', windowId, state: toState, writesPerformed: false };
    await db.prepare(`UPDATE corpus_capture_windows SET lifecycle_state = ?1,
      quiescent_at = CASE WHEN ?1 = 'quiescent' THEN ?2 ELSE quiescent_at END,
      frozen_at = CASE WHEN ?1 = 'frozen' THEN ?2 ELSE frozen_at END,
      updated_at = ?2 WHERE window_id = ?3`).bind(toState, occurredAt, windowId).run();
    const eventId = input?.eventId ? nonEmpty(input.eventId, 'eventId') : `lifecycle:${windowId}:${toState}:${occurredAt}`;
    await db.prepare('INSERT OR IGNORE INTO corpus_lifecycle_events (event_id, window_id, from_state, to_state, reason, occurred_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(eventId, windowId, window.lifecycle_state, toState, reason, occurredAt).run();
    return { status: 'transitioned', windowId, fromState: window.lifecycle_state, state: toState, writesPerformed: true };
  }

  async function previewCapture(input) {
    const validated = validateCaptureRequest(input);
    const state = await classify(db, validated);
    return {
      ok: true, dryRun: true, schemaVersion: CORPUS_CAPTURE_VERSION, runId: validated.plan.runId,
      generatedAt: validated.generatedAt, evidenceSha256: validated.evidenceSha256,
      stormCount: validated.stormKeys.length, snapshotCount: validated.snapshots.length,
      appendedSnapshotCount: state.classifications.filter(item => item.disposition === 'appended').length,
      existingSnapshotCount: state.classifications.filter(item => item.disposition === 'existing').length,
      storms: state.byStorm, classifications: state.classifications, writesPerformed: false,
      semantics: { appendOnlySnapshots: true, exactDuplicatesReusableAcrossRuns: true, conflictsAreFatal: true, frozenWindowsRejectAppend: true, truthWritten: false, trainingWritten: false, promotionWritten: false }
    };
  }

  async function capture(input) {
    const validated = validateCaptureRequest(input);
    const state = await classify(db, validated);
    const backfill = await backfillRepository.importPlan(state.sanitizedPlan);

    let windowsCreated = 0;
    let windowsResumed = 0;
    for (const captureSpec of validated.captures) {
      const existingWindow = state.windows.get(captureSpec.stormKey);
      if (!existingWindow) {
        const quiescentAt = captureSpec.initialState === 'quiescent' ? validated.generatedAt : null;
        const frozenAt = captureSpec.initialState === 'frozen' ? validated.generatedAt : null;
        await db.prepare(`INSERT INTO corpus_capture_windows (
          window_id, storm_key, lifecycle_state, opened_at, quiescent_at, frozen_at, last_capture_run_id, last_capture_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, ?4)`)
          .bind(captureSpec.windowId, captureSpec.stormKey, captureSpec.initialState, validated.generatedAt, quiescentAt, frozenAt).run();
        await db.prepare('INSERT OR IGNORE INTO corpus_lifecycle_events (event_id, window_id, from_state, to_state, reason, occurred_at) VALUES (?1, ?2, NULL, ?3, ?4, ?5)')
          .bind(`open:${captureSpec.windowId}:${validated.plan.runId}`, captureSpec.windowId, captureSpec.initialState, 'capture-window-opened', validated.generatedAt).run();
        windowsCreated += 1;
      }
    }

    const existingCaptureRun = await first(db, 'SELECT capture_run_id, fingerprint FROM corpus_capture_runs WHERE capture_run_id = ?1 LIMIT 1', validated.plan.runId);
    if (existingCaptureRun && existingCaptureRun.fingerprint !== validated.fingerprint) {
      throw httpError(409, 'capture-run-conflict', `capture run ${validated.plan.runId} already exists with a different fingerprint`);
    }
    await db.prepare(`INSERT OR IGNORE INTO corpus_capture_runs (
      capture_run_id, source_run_id, generated_at, evidence_sha256, fingerprint, status
    ) VALUES (?1, ?1, ?2, ?3, ?4, ?5)`)
      .bind(validated.plan.runId, validated.generatedAt, validated.evidenceSha256, validated.fingerprint, backfill.status === 'already-imported' ? 'already-imported' : 'completed').run();

    for (const stormKey of validated.stormKeys) {
      const summary = state.byStorm[stormKey];
      await db.prepare(`INSERT OR IGNORE INTO corpus_capture_run_storms (
        capture_run_id, window_id, storm_key, snapshots_planned, snapshots_appended, snapshots_existing
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
        .bind(validated.plan.runId, summary.windowId, stormKey, summary.planned, summary.appended, summary.existing).run();
      if (summary.appended > 0 && summary.existingState === 'quiescent') {
        await db.prepare("UPDATE corpus_capture_windows SET lifecycle_state = 'active', updated_at = ?1 WHERE window_id = ?2 AND lifecycle_state = 'quiescent'")
          .bind(validated.generatedAt, summary.windowId).run();
        await db.prepare('INSERT OR IGNORE INTO corpus_lifecycle_events (event_id, window_id, from_state, to_state, reason, occurred_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
          .bind(`resume:${summary.windowId}:${validated.plan.runId}`, summary.windowId, 'quiescent', 'active', 'new-snapshot-appended', validated.generatedAt).run();
        windowsResumed += 1;
      }
      await db.prepare(`UPDATE corpus_capture_windows SET last_capture_run_id = ?1, last_capture_at = ?2, updated_at = ?2
        WHERE window_id = ?3 AND (last_capture_at IS NULL OR last_capture_at <= ?2)`)
        .bind(validated.plan.runId, validated.generatedAt, summary.windowId).run();
    }

    for (const item of state.classifications) {
      await db.prepare(`INSERT OR IGNORE INTO corpus_snapshot_memberships (
        capture_run_id, window_id, snapshot_id, disposition, fingerprint
      ) VALUES (?1, ?2, ?3, ?4, ?5)`)
        .bind(validated.plan.runId, item.windowId, item.canonicalSnapshotId, item.disposition, item.fingerprint).run();
    }

    const identityResults = [];
    for (const proposal of validated.identityProposals) identityResults.push(await recordIdentityBinding(proposal));

    const semanticWrites = Boolean(backfill.writesPerformed || windowsCreated || windowsResumed || !existingCaptureRun || identityResults.some(item => item.writesPerformed));

    return {
      ok: true, status: backfill.status, schemaVersion: CORPUS_CAPTURE_VERSION, runId: validated.plan.runId,
      backfill, stormCount: validated.stormKeys.length, snapshotCount: validated.snapshots.length,
      appendedSnapshotCount: state.classifications.filter(item => item.disposition === 'appended').length,
      existingSnapshotCount: state.classifications.filter(item => item.disposition === 'existing').length,
      storms: state.byStorm, classifications: state.classifications, identityResults,
      writesPerformed: semanticWrites,
      semantics: { appendOnlySnapshots: true, historicalSnapshotRewrite: false, reviewedIdentityRequiredForCanonicalMapping: true, physicalStormRowsMerged: false, truthWritten: false, trainingWritten: false, promotionWritten: false }
    };
  }

  return Object.freeze({ previewCapture, capture, transitionWindow, recordIdentityBinding, recordStormMerge, resolveStormKey });
}
