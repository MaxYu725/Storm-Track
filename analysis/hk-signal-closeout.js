(function attachHkSignalCloseout(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HkSignalCloseout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHkSignalCloseout() {
  'use strict';

  const VERSION = 'hk-signal-closeout/v1';
  const POLICY_VERSION = 'hk-signal-closeout-policy/v1';
  const INACTIVE_GRACE_HOURS = 24;
  const SIGNALS = Object.freeze(['T1', 'T3', 'T8']);
  const POSITIVE_STATES = new Set(['possible', 'likely']);
  const HEALTHY_SOURCE_STATES = new Set(['ok', 'empty']);

  const POLICY = Object.freeze({
    version: POLICY_VERSION,
    inactiveGraceHours: INACTIVE_GRACE_HOURS,
    noSignalCase: 'A case that has carried an HKO source may close without TC1 only after it disappears from a healthy settled prospective capture and remains absent for at least 24 hours.',
    warnedCase: 'Once an HKO warning episode has started, missing higher signals close only on HKO CANCEL or CLEAR_DETECTED.',
    unresolvedTruthGuard: 'Any unresolved or ambiguous eligible HKO signal event in the relevant interval blocks automatic negative closeout.',
    negativeScoring: 'Not-issued signals receive no A/B/C/D timing grade; forecast evidence is retained as correct-negative, transient-false-alarm, or stable-false-alarm.',
    immutableEvidence: 'Closeout is derived from trusted beta-prospective-recorder/v2 observations and HKO truth events; raw corpora are never rewritten.'
  });

  function parseTimeMs(value) {
    const ms = Date.parse(value || '');
    return Number.isFinite(ms) ? ms : NaN;
  }

  function normalizeSignal(signal) {
    const value = String(signal || '').toUpperCase();
    if (!SIGNALS.includes(value)) throw new Error(`unsupported signal: ${signal}`);
    return value;
  }

  function isPositive(value) {
    return POSITIVE_STATES.has(String(value || '').toLowerCase());
  }

  function signalPrediction(observation, signal) {
    const key = normalizeSignal(signal);
    const item = observation?.analysis?.basicForecast?.signals?.[key] || null;
    return {
      signal: key,
      likelihood: item?.likelihood ? String(item.likelihood).toLowerCase() : null,
      riskIndex: Number.isFinite(Number(item?.riskIndex)) ? Number(item.riskIndex) : null,
      confidenceIndex: Number.isFinite(Number(item?.confidenceIndex)) ? Number(item.confidenceIndex) : null,
      persistenceHours: Number.isFinite(Number(item?.persistenceHours)) ? Number(item.persistenceHours) : null,
      estimatedWindow: item?.estimatedWindow && typeof item.estimatedWindow === 'object'
        ? { start: item.estimatedWindow.start || null, end: item.estimatedWindow.end || null }
        : null
    };
  }

  function stablePositiveStart(timeline, signal) {
    for (let index = 0; index < timeline.length; index += 1) {
      if (!isPositive(signalPrediction(timeline[index].observation, signal).likelihood)) continue;
      if (timeline.slice(index).every(row => isPositive(signalPrediction(row.observation, signal).likelihood))) {
        return timeline[index];
      }
    }
    return null;
  }

  function summarizeNegativeForecast(timeline, signal, closedAt) {
    const key = normalizeSignal(signal);
    const closedMs = parseTimeMs(closedAt);
    const rows = [...(timeline || [])]
      .filter(row => Number.isFinite(parseTimeMs(row?.capturedAt)))
      .filter(row => !Number.isFinite(closedMs) || parseTimeMs(row.capturedAt) < closedMs)
      .sort((a, b) => parseTimeMs(a.capturedAt) - parseTimeMs(b.capturedAt));

    if (!rows.length) {
      return {
        classification: 'insufficient-forecast-evidence',
        snapshotCount: 0,
        positiveSnapshotCount: 0,
        firstPositiveAt: null,
        firstStablePositiveAt: null,
        maxRiskIndex: null,
        finalPreClose: null
      };
    }

    const predictions = rows.map(row => ({ row, prediction: signalPrediction(row.observation, key) }));
    const positive = predictions.filter(item => isPositive(item.prediction.likelihood));
    const firstPositive = positive[0]?.row || null;
    const stable = stablePositiveStart(rows, key);
    const final = predictions[predictions.length - 1];
    const risks = predictions.map(item => item.prediction.riskIndex).filter(Number.isFinite);
    const stableAtClose = Boolean(stable && isPositive(final.prediction.likelihood));
    const classification = positive.length === 0
      ? 'correct-negative'
      : (stableAtClose ? 'stable-false-alarm' : 'transient-false-alarm');

    return {
      classification,
      snapshotCount: rows.length,
      positiveSnapshotCount: positive.length,
      firstPositiveAt: firstPositive?.capturedAt || null,
      firstStablePositiveAt: stable?.capturedAt || null,
      maxRiskIndex: risks.length ? Math.max(...risks) : null,
      finalPreClose: {
        capturedAt: final.row.capturedAt,
        captureFingerprint: final.row.captureFingerprint || null,
        likelihood: final.prediction.likelihood,
        riskIndex: final.prediction.riskIndex,
        confidenceIndex: final.prediction.confidenceIndex,
        persistenceHours: final.prediction.persistenceHours,
        estimatedWindow: final.prediction.estimatedWindow
      }
    };
  }

  function recordHealthy(record) {
    const states = Array.isArray(record?.sourceStates) ? record.sourceStates : [];
    if (states.length !== 4) return false;
    return states.every(item => HEALTHY_SOURCE_STATES.has(String(item?.state || '').toLowerCase()));
  }

  function observationKey(fingerprint, groupKey) {
    return `${fingerprint || ''}\u0000${groupKey || ''}`;
  }

  function caseCaptureKey(caseId, fingerprint) {
    return `${caseId || ''}\u0000${fingerprint || ''}`;
  }

  function buildIdentityMap(caseIndex) {
    return new Map((caseIndex || []).map(row => [observationKey(row.captureFingerprint, row.rawGroupKey), row.caseId]));
  }

  function recordCaseIds(record, identityMap) {
    const ids = new Set();
    for (const observation of record?.observations || []) {
      const groupKey = observation?.group?.key || null;
      const caseId = identityMap.get(observationKey(record.captureFingerprint, groupKey));
      if (caseId) ids.add(caseId);
    }
    return ids;
  }

  function buildCaseTimelines(records, caseIndex) {
    const identityMap = buildIdentityMap(caseIndex);
    const trustedFingerprints = new Set((records || []).map(record => record?.captureFingerprint).filter(Boolean));
    const counts = new Map();
    for (const row of caseIndex || []) {
      if (!row?.caseId || !row?.captureFingerprint || !trustedFingerprints.has(row.captureFingerprint)) continue;
      const captureKey = caseCaptureKey(row.caseId, row.captureFingerprint);
      counts.set(captureKey, (counts.get(captureKey) || 0) + 1);
    }
    const ambiguous = new Set([...counts.entries()].filter(([, count]) => count > 1).map(([captureKey]) => captureKey));
    const timelines = new Map();
    for (const record of [...(records || [])].sort((a, b) => parseTimeMs(a.capturedAt) - parseTimeMs(b.capturedAt))) {
      for (const observation of record?.observations || []) {
        const groupKey = observation?.group?.key || null;
        const caseId = identityMap.get(observationKey(record.captureFingerprint, groupKey));
        if (!caseId) continue;
        if (ambiguous.has(caseCaptureKey(caseId, record.captureFingerprint))) continue;
        if (!timelines.has(caseId)) timelines.set(caseId, []);
        timelines.get(caseId).push({
          caseId,
          capturedAt: record.capturedAt,
          captureFingerprint: record.captureFingerprint,
          rawGroupKey: groupKey,
          observation
        });
      }
    }
    return { identityMap, timelines };
  }

  function eligibleUnresolvedEvaluation(item) {
    return (item?.status === 'unresolved' || item?.status === 'ambiguous')
      && SIGNALS.includes(String(item?.signal || '').toUpperCase())
      && Number.isFinite(parseTimeMs(item?.truth?.eventTime));
  }

  function unresolvedBetween(evaluations, startMs, endMs) {
    return (evaluations || []).some(item => {
      if (!eligibleUnresolvedEvaluation(item)) return false;
      const ms = parseTimeMs(item.truth.eventTime);
      return ms >= startMs && ms <= endMs;
    });
  }

  function resolvedSignalsForCase(evaluations, caseId) {
    return new Set((evaluations || [])
      .filter(item => item?.caseId === caseId && (item.status === 'evaluated' || item.status === 'not-issued'))
      .map(item => String(item.signal || '').toUpperCase())
      .filter(signal => SIGNALS.includes(signal)));
  }

  function evaluatedSignalsForCase(evaluations, caseId) {
    return (evaluations || [])
      .filter(item => item?.caseId === caseId && item.status === 'evaluated')
      .filter(item => SIGNALS.includes(String(item?.signal || '').toUpperCase()))
      .sort((a, b) => parseTimeMs(a.truth?.eventTime) - parseTimeMs(b.truth?.eventTime));
  }

  function findHealthyAbsence({ caseId, records, identityMap, lastPresentMs }) {
    for (const record of [...(records || [])].sort((a, b) => parseTimeMs(a.capturedAt) - parseTimeMs(b.capturedAt))) {
      const capturedMs = parseTimeMs(record?.capturedAt);
      if (!Number.isFinite(capturedMs) || capturedMs <= lastPresentMs || !recordHealthy(record)) continue;
      if (!recordCaseIds(record, identityMap).has(caseId)) return record;
    }
    return null;
  }

  function clearEventAfter({ lastSignalMs, truthEvents, evaluations, caseId }) {
    const events = [...(truthEvents || [])]
      .filter(event => ['CANCEL', 'CLEAR_DETECTED'].includes(String(event?.eventType || '')))
      .filter(event => parseTimeMs(event?.eventTime) > lastSignalMs)
      .sort((a, b) => parseTimeMs(a.eventTime) - parseTimeMs(b.eventTime));

    for (const event of events) {
      const clearMs = parseTimeMs(event.eventTime);
      const competing = (evaluations || []).some(item => {
        const ms = parseTimeMs(item?.truth?.eventTime);
        if (!Number.isFinite(ms) || ms <= lastSignalMs || ms >= clearMs) return false;
        if (eligibleUnresolvedEvaluation(item)) return true;
        return item?.status === 'evaluated' && item?.caseId && item.caseId !== caseId;
      });
      if (!competing) return event;
    }
    return null;
  }

  function makeCloseout({ caseId, signal, closedAt, evidenceAt, reason, timeline, graceHours = null }) {
    const summary = summarizeNegativeForecast(timeline, signal, closedAt);
    return {
      schemaVersion: VERSION,
      policyVersion: POLICY_VERSION,
      status: 'not-issued',
      officialOutcome: 'not-issued',
      caseId,
      signal: normalizeSignal(signal),
      closedAt,
      evidenceAt,
      closeoutReason: reason,
      graceHours,
      forecastOutcome: summary.classification,
      forecastEvidence: summary,
      timingGrade: null,
      rubricGradeApplied: false
    };
  }

  function deriveCloseouts({ caseRegistry, caseIndex, records, truthEvents, evaluations, asOf }) {
    const asOfMs = parseTimeMs(asOf);
    if (!Number.isFinite(asOfMs)) throw new Error('deriveCloseouts requires a valid asOf time');
    const trusted = (records || [])
      .filter(record => record?.schemaVersion === 'beta-prospective-recorder/v2')
      .filter(record => Number.isFinite(parseTimeMs(record?.capturedAt)))
      .sort((a, b) => parseTimeMs(a.capturedAt) - parseTimeMs(b.capturedAt));
    const { identityMap, timelines } = buildCaseTimelines(trusted, caseIndex);
    const closeouts = [];
    const blocked = [];

    for (const item of caseRegistry?.cases || []) {
      const caseId = item?.caseId;
      if (!caseId || !(item?.sourceTokens || []).some(token => String(token).startsWith('HKO:'))) continue;
      const timeline = timelines.get(caseId) || [];
      if (!timeline.length) continue;
      const resolved = resolvedSignalsForCase(evaluations, caseId);
      const issued = evaluatedSignalsForCase(evaluations, caseId);

      if (issued.length) {
        const lastSignalMs = Math.max(...issued.map(row => parseTimeMs(row.truth.eventTime)).filter(Number.isFinite));
        const clear = clearEventAfter({ lastSignalMs, truthEvents, evaluations, caseId });
        if (!clear) continue;
        const clearMs = parseTimeMs(clear.eventTime);
        if (unresolvedBetween(evaluations, lastSignalMs, clearMs)) {
          blocked.push({ caseId, reason: 'unresolved-truth-event-before-clear', from: new Date(lastSignalMs).toISOString(), to: clear.eventTime });
          continue;
        }
        for (const signal of SIGNALS) {
          if (resolved.has(signal)) continue;
          closeouts.push(makeCloseout({
            caseId,
            signal,
            closedAt: clear.eventTime,
            evidenceAt: clear.observedAt || clear.eventTime,
            reason: 'hko-warning-episode-cleared',
            timeline
          }));
        }
        continue;
      }

      const lastPresentMs = Math.max(...timeline.map(row => parseTimeMs(row.capturedAt)).filter(Number.isFinite));
      const absence = findHealthyAbsence({ caseId, records: trusted, identityMap, lastPresentMs });
      if (!absence) continue;
      const absenceMs = parseTimeMs(absence.capturedAt);
      const closedMs = absenceMs + INACTIVE_GRACE_HOURS * 3600000;
      if (asOfMs < closedMs) continue;
      const parsedFirstSeenMs = parseTimeMs(item.firstSeen);
      const firstSeenMs = Number.isFinite(parsedFirstSeenMs)
        ? parsedFirstSeenMs
        : (timeline.length ? parseTimeMs(timeline[0]?.capturedAt) : lastPresentMs);
      if (unresolvedBetween(evaluations, Number.isFinite(firstSeenMs) ? firstSeenMs : lastPresentMs, closedMs)) {
        blocked.push({ caseId, reason: 'unresolved-truth-event-during-no-signal-case', from: item.firstSeen || timeline[0]?.capturedAt || null, to: new Date(closedMs).toISOString() });
        continue;
      }
      for (const signal of SIGNALS) {
        if (resolved.has(signal)) continue;
        closeouts.push(makeCloseout({
          caseId,
          signal,
          closedAt: new Date(closedMs).toISOString(),
          evidenceAt: absence.capturedAt,
          reason: 'case-inactive-after-healthy-absence',
          timeline,
          graceHours: INACTIVE_GRACE_HOURS
        }));
      }
    }

    closeouts.sort((a, b) => parseTimeMs(a.closedAt) - parseTimeMs(b.closedAt) || a.caseId.localeCompare(b.caseId) || a.signal.localeCompare(b.signal));
    return {
      policyVersion: POLICY_VERSION,
      policy: POLICY,
      asOf,
      closeouts,
      blocked
    };
  }

  return Object.freeze({
    VERSION,
    POLICY_VERSION,
    POLICY,
    INACTIVE_GRACE_HOURS,
    SIGNALS,
    signalPrediction,
    summarizeNegativeForecast,
    recordHealthy,
    deriveCloseouts
  });
});
