(function attachHkoTruthGapAudit(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HkoTruthGapAudit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHkoTruthGapAudit() {
  'use strict';

  const VERSION = 'hko-truth-gap-audit/v1';
  const HEALTH_GAP_THRESHOLD_MINUTES = 90;
  const HISTORY_CONFIRMATION_DELAY_HOURS = 24;
  const SEEDED_GAPS = Object.freeze([
    Object.freeze({
      gapId: 'HKO-TG-20260828-012323-090001',
      from: '2026-08-28T01:23:23.742Z',
      to: '2026-08-28T09:00:01.300Z',
      source: 'incident-confirmed-pre-health-ledger-gap',
      reason: 'truth-recorder-schedule-gap'
    })
  ]);

  const POLICY = Object.freeze({
    version: VERSION,
    healthGapThresholdMinutes: HEALTH_GAP_THRESHOLD_MINUTES,
    historyConfirmationDelayHours: HISTORY_CONFIRMATION_DELAY_HOURS,
    source: 'Hong Kong Observatory Warnings & Signals Database tc.dat',
    clearRule: 'A truth-recorder gap is verified clear only after the official warning-history snapshot is at least 24 hours newer than the gap end, no TC warning record overlaps the gap, and the live HKO truth state is confirmed clear after the gap.',
    conflictRule: 'If official warning history contains a TC warning interval overlapping a recorder gap, the evaluator must flag a truth-history conflict and must not synthesize or score a missing truth event automatically.',
    immutableEvidence: 'History audit is derived corroboration only; it never rewrites HKO truth-events or prospective evidence.'
  });

  function parseTimeMs(value) {
    const ms = Date.parse(value || '');
    return Number.isFinite(ms) ? ms : NaN;
  }

  function overlap(aFrom, aTo, bFrom, bTo) {
    const values = [aFrom, aTo, bFrom, bTo].map(parseTimeMs);
    if (!values.every(Number.isFinite)) return false;
    const [aStart, aEnd, bStart, bEnd] = values;
    return aStart <= bEnd && aEnd >= bStart;
  }

  function autoHealthGaps(healthRecords, thresholdMinutes = HEALTH_GAP_THRESHOLD_MINUTES) {
    const rows = [...(healthRecords || [])]
      .filter(item => Number.isFinite(parseTimeMs(item?.retrievedAt)))
      .sort((a, b) => parseTimeMs(a.retrievedAt) - parseTimeMs(b.retrievedAt));
    const gaps = [];
    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1];
      const current = rows[index];
      const gapMinutes = (parseTimeMs(current.retrievedAt) - parseTimeMs(previous.retrievedAt)) / 60000;
      if (gapMinutes <= thresholdMinutes) continue;
      gaps.push({
        gapId: `HKO-TG-AUTO-${String(previous.retrievedAt).replace(/\D/g, '').slice(0, 14)}-${String(current.retrievedAt).replace(/\D/g, '').slice(0, 14)}`,
        from: previous.retrievedAt,
        to: current.retrievedAt,
        source: 'hko-warning-truth-health/v1',
        reason: 'truth-health-heartbeat-gap',
        gapMinutes
      });
    }
    return gaps;
  }

  function mergeGaps(seeded, automatic) {
    const result = [];
    for (const gap of [...(seeded || []), ...(automatic || [])]
      .filter(item => Number.isFinite(parseTimeMs(item?.from)) && Number.isFinite(parseTimeMs(item?.to)))
      .sort((a, b) => parseTimeMs(a.from) - parseTimeMs(b.from) || parseTimeMs(a.to) - parseTimeMs(b.to))) {
      const duplicate = result.find(item => overlap(item.from, item.to, gap.from, gap.to)
        && Math.abs(parseTimeMs(item.from) - parseTimeMs(gap.from)) <= 5 * 60000
        && Math.abs(parseTimeMs(item.to) - parseTimeMs(gap.to)) <= 5 * 60000);
      if (!duplicate) result.push({ ...gap });
    }
    return result;
  }

  function historyRecords(historySnapshot) {
    return Array.isArray(historySnapshot?.records) ? historySnapshot.records : [];
  }

  function overlappingHistoryRecords(gap, historySnapshot) {
    return historyRecords(historySnapshot).filter(record => overlap(
      record?.startAt,
      record?.endAt,
      gap?.from,
      gap?.to
    ));
  }

  function auditGap(gap, { historySnapshot = null, latestTruth = null } = {}) {
    const overlappingRecords = overlappingHistoryRecords(gap, historySnapshot);
    if (overlappingRecords.length) {
      return {
        ...gap,
        status: 'history-signal-overlap',
        verifiedClear: false,
        historyRetrievedAt: historySnapshot?.retrievedAt || null,
        overlappingRecordCount: overlappingRecords.length,
        overlappingRecords
      };
    }

    const historyRetrievedMs = parseTimeMs(historySnapshot?.retrievedAt);
    if (!Number.isFinite(historyRetrievedMs)) {
      return {
        ...gap,
        status: 'pending-history-snapshot',
        verifiedClear: false,
        historyRetrievedAt: null,
        overlappingRecordCount: 0,
        overlappingRecords: []
      };
    }

    const matureAtMs = parseTimeMs(gap.to) + HISTORY_CONFIRMATION_DELAY_HOURS * 3600000;
    if (historyRetrievedMs < matureAtMs) {
      return {
        ...gap,
        status: 'pending-history-maturity',
        verifiedClear: false,
        historyRetrievedAt: historySnapshot.retrievedAt,
        historyMatureAt: new Date(matureAtMs).toISOString(),
        overlappingRecordCount: 0,
        overlappingRecords: []
      };
    }

    const latestTruthMs = parseTimeMs(latestTruth?.retrievedAt);
    if (!Number.isFinite(latestTruthMs) || latestTruthMs < parseTimeMs(gap.to)) {
      return {
        ...gap,
        status: 'pending-live-truth-confirmation',
        verifiedClear: false,
        historyRetrievedAt: historySnapshot.retrievedAt,
        latestTruthRetrievedAt: latestTruth?.retrievedAt || null,
        overlappingRecordCount: 0,
        overlappingRecords: []
      };
    }

    if (latestTruth?.truth?.present === true) {
      return {
        ...gap,
        status: 'pending-current-tc-signal',
        verifiedClear: false,
        historyRetrievedAt: historySnapshot.retrievedAt,
        latestTruthRetrievedAt: latestTruth.retrievedAt,
        currentTruthCode: latestTruth?.truth?.code || null,
        overlappingRecordCount: 0,
        overlappingRecords: []
      };
    }

    return {
      ...gap,
      status: 'verified-clear',
      verifiedClear: true,
      historyRetrievedAt: historySnapshot.retrievedAt,
      historySourceSha256: historySnapshot?.source?.sha256 || null,
      latestTruthRetrievedAt: latestTruth.retrievedAt,
      overlappingRecordCount: 0,
      overlappingRecords: []
    };
  }

  function buildAudit({ healthRecords = [], historySnapshot = null, latestTruth = null } = {}) {
    const gaps = mergeGaps(SEEDED_GAPS, autoHealthGaps(healthRecords));
    const auditedGaps = gaps.map(gap => auditGap(gap, { historySnapshot, latestTruth }));
    const statusCounts = auditedGaps.reduce((counts, gap) => {
      counts[gap.status] = (counts[gap.status] || 0) + 1;
      return counts;
    }, {});
    return {
      schemaVersion: VERSION,
      policy: POLICY,
      seededGapCount: SEEDED_GAPS.length,
      autoGapCount: Math.max(0, gaps.length - SEEDED_GAPS.length),
      gapCount: auditedGaps.length,
      verifiedClearCount: auditedGaps.filter(gap => gap.verifiedClear).length,
      unresolvedCount: auditedGaps.filter(gap => !gap.verifiedClear).length,
      conflictCount: auditedGaps.filter(gap => gap.status === 'history-signal-overlap').length,
      statusCounts,
      historySnapshot: historySnapshot ? {
        schemaVersion: historySnapshot.schemaVersion || null,
        retrievedAt: historySnapshot.retrievedAt || null,
        fingerprint: historySnapshot.fingerprint || null,
        recordCount: Array.isArray(historySnapshot.records) ? historySnapshot.records.length : null,
        provisionalRecordCount: historySnapshot.provisionalRecordCount ?? null,
        source: historySnapshot.source || null
      } : null,
      gaps: auditedGaps
    };
  }

  function unresolvedForInterval(audit, from, to) {
    return (audit?.gaps || []).filter(gap => !gap.verifiedClear && overlap(gap.from, gap.to, from, to));
  }

  function conflictsForInterval(audit, from, to) {
    return (audit?.gaps || []).filter(gap => gap.status === 'history-signal-overlap' && overlap(gap.from, gap.to, from, to));
  }

  return Object.freeze({
    VERSION,
    POLICY,
    HEALTH_GAP_THRESHOLD_MINUTES,
    HISTORY_CONFIRMATION_DELAY_HOURS,
    SEEDED_GAPS,
    parseTimeMs,
    overlap,
    autoHealthGaps,
    mergeGaps,
    overlappingHistoryRecords,
    auditGap,
    buildAudit,
    unresolvedForInterval,
    conflictsForInterval
  });
});
