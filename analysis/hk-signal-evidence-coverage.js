(function attachHkSignalEvidenceCoverage(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HkSignalEvidenceCoverage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHkSignalEvidenceCoverage() {
  'use strict';

  const VERSION = 'hk-signal-evidence-coverage/v1';
  const PROSPECTIVE_MAX_GAP_MINUTES = 60;
  const CHECKPOINT_MAX_AGE_MINUTES = 60;
  const TRUTH_HEALTH_MAX_GAP_MINUTES = 90;
  const HEALTHY_SOURCE_STATES = new Set(['ok', 'empty']);

  const POLICY = Object.freeze({
    version: VERSION,
    prospectiveMaxGapMinutes: PROSPECTIVE_MAX_GAP_MINUTES,
    checkpointMaxAgeMinutes: CHECKPOINT_MAX_AGE_MINUTES,
    truthHealthMaxGapMinutes: TRUTH_HEALTH_MAX_GAP_MINUTES,
    checkpointRule: 'A forecast checkpoint is scoreable only when its selected prospective snapshot is healthy and no older than the checkpoint freshness limit.',
    lifecycleRule: 'Stable-lead and reversal stability are scoreable only across continuous healthy prospective coverage with the case present throughout the claimed interval.',
    noSignalRule: 'A no-signal closeout requires at least 24 hours of overlapping continuous healthy prospective absence and HKO truth polling health; wall-clock time alone never advances absence coverage.',
    immutableEvidence: 'Coverage guards only qualify derived evaluation evidence; raw prospective and HKO truth corpora remain immutable.'
  });

  function parseTimeMs(value) {
    const ms = Date.parse(value || '');
    return Number.isFinite(ms) ? ms : NaN;
  }

  function minutesBetween(later, earlier) {
    const a = typeof later === 'number' ? later : parseTimeMs(later);
    const b = typeof earlier === 'number' ? earlier : parseTimeMs(earlier);
    return Number.isFinite(a) && Number.isFinite(b) ? (a - b) / 60000 : null;
  }

  function recordHealthy(record) {
    const states = Array.isArray(record?.sourceStates) ? record.sourceStates : [];
    if (states.length !== 4) return false;
    return states.every(item => HEALTHY_SOURCE_STATES.has(String(item?.state || '').toLowerCase()));
  }

  function sortRecords(records) {
    return [...(records || [])]
      .filter(record => Number.isFinite(parseTimeMs(record?.capturedAt)))
      .sort((a, b) => parseTimeMs(a.capturedAt) - parseTimeMs(b.capturedAt));
  }

  function observationKey(fingerprint, groupKey) {
    return `${fingerprint || ''}\u0000${groupKey || ''}`;
  }

  function buildIdentityMap(caseIndex) {
    return new Map((caseIndex || []).map(row => [
      observationKey(row?.captureFingerprint, row?.rawGroupKey),
      row?.caseId || null
    ]));
  }

  function recordCaseIds(record, identityMap) {
    const ids = new Set();
    for (const observation of record?.observations || []) {
      const groupKey = observation?.group?.key || null;
      const caseId = identityMap.get(observationKey(record?.captureFingerprint, groupKey));
      if (caseId) ids.add(caseId);
    }
    return ids;
  }

  function assessCheckpoint({ snapshotAt, targetAt, healthy = true, maxAgeMinutes = CHECKPOINT_MAX_AGE_MINUTES }) {
    const snapshotMs = parseTimeMs(snapshotAt);
    const targetMs = parseTimeMs(targetAt);
    if (!Number.isFinite(snapshotMs) || !Number.isFinite(targetMs)) {
      return {
        complete: false,
        reason: 'missing-checkpoint-time',
        snapshotAgeMinutes: null,
        maxAgeMinutes
      };
    }
    const ageMinutes = (targetMs - snapshotMs) / 60000;
    if (ageMinutes < 0) {
      return {
        complete: false,
        reason: 'snapshot-after-checkpoint',
        snapshotAgeMinutes: ageMinutes,
        maxAgeMinutes
      };
    }
    if (!healthy) {
      return {
        complete: false,
        reason: 'unhealthy-prospective-capture',
        snapshotAgeMinutes: ageMinutes,
        maxAgeMinutes
      };
    }
    if (ageMinutes > maxAgeMinutes) {
      return {
        complete: false,
        reason: 'stale-checkpoint-snapshot',
        snapshotAgeMinutes: ageMinutes,
        maxAgeMinutes
      };
    }
    return {
      complete: true,
      reason: 'covered',
      snapshotAgeMinutes: ageMinutes,
      maxAgeMinutes
    };
  }

  function assessCaseInterval({
    caseId,
    records,
    caseIndex,
    startAt,
    endAt,
    maxGapMinutes = PROSPECTIVE_MAX_GAP_MINUTES,
    requireCasePresent = true
  }) {
    const startMs = parseTimeMs(startAt);
    const endMs = parseTimeMs(endAt);
    if (!caseId || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
      return { complete: false, reason: 'invalid-coverage-interval', gaps: [] };
    }

    const identityMap = buildIdentityMap(caseIndex);
    const rows = sortRecords(records).filter(record => {
      const ms = parseTimeMs(record.capturedAt);
      return ms >= startMs && ms <= endMs;
    });
    if (!rows.length) {
      return { complete: false, reason: 'no-prospective-captures', gaps: [{ from: startAt, to: endAt, reason: 'no-captures' }] };
    }

    const gaps = [];
    let previousMs = startMs;
    for (const record of rows) {
      const currentMs = parseTimeMs(record.capturedAt);
      const gapMinutes = (currentMs - previousMs) / 60000;
      if (gapMinutes > maxGapMinutes) {
        gaps.push({
          from: new Date(previousMs).toISOString(),
          to: record.capturedAt,
          gapMinutes,
          reason: 'prospective-gap'
        });
      }
      if (!recordHealthy(record)) {
        gaps.push({
          at: record.capturedAt,
          reason: 'unhealthy-prospective-capture'
        });
      } else if (requireCasePresent && !recordCaseIds(record, identityMap).has(caseId)) {
        gaps.push({
          at: record.capturedAt,
          reason: 'case-not-present'
        });
      }
      previousMs = currentMs;
    }

    const tailGapMinutes = (endMs - previousMs) / 60000;
    if (tailGapMinutes > maxGapMinutes) {
      gaps.push({
        from: new Date(previousMs).toISOString(),
        to: new Date(endMs).toISOString(),
        gapMinutes: tailGapMinutes,
        reason: 'prospective-gap'
      });
    }

    return {
      complete: gaps.length === 0,
      reason: gaps.length ? 'prospective-coverage-incomplete' : 'covered',
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(endMs).toISOString(),
      maxGapMinutes,
      gaps
    };
  }

  function continuousProspectiveAbsenceSegments({
    caseId,
    records,
    caseIndex,
    afterAt,
    asOf,
    maxGapMinutes = PROSPECTIVE_MAX_GAP_MINUTES
  }) {
    const afterMs = parseTimeMs(afterAt);
    const asOfMs = parseTimeMs(asOf);
    if (!caseId || !Number.isFinite(afterMs) || !Number.isFinite(asOfMs)) return [];

    const identityMap = buildIdentityMap(caseIndex);
    const rows = sortRecords(records).filter(record => {
      const ms = parseTimeMs(record.capturedAt);
      return ms > afterMs && ms <= asOfMs;
    });
    const segments = [];
    let segment = null;

    function finish() {
      if (segment) segments.push(segment);
      segment = null;
    }

    for (const record of rows) {
      const currentMs = parseTimeMs(record.capturedAt);
      const healthy = recordHealthy(record);
      const present = healthy && recordCaseIds(record, identityMap).has(caseId);
      if (!healthy || present) {
        finish();
        continue;
      }

      if (!segment) {
        segment = {
          startAt: record.capturedAt,
          endAt: record.capturedAt,
          firstEvidenceAt: record.capturedAt,
          lastEvidenceAt: record.capturedAt,
          recordCount: 1
        };
        continue;
      }

      const gapMinutes = minutesBetween(currentMs, parseTimeMs(segment.endAt));
      if (!Number.isFinite(gapMinutes) || gapMinutes > maxGapMinutes) {
        finish();
        segment = {
          startAt: record.capturedAt,
          endAt: record.capturedAt,
          firstEvidenceAt: record.capturedAt,
          lastEvidenceAt: record.capturedAt,
          recordCount: 1
        };
        continue;
      }

      segment.endAt = record.capturedAt;
      segment.lastEvidenceAt = record.capturedAt;
      segment.recordCount += 1;
    }
    finish();
    return segments;
  }

  function continuousTruthHealthSegments({
    healthRecords,
    asOf,
    maxGapMinutes = TRUTH_HEALTH_MAX_GAP_MINUTES
  }) {
    const asOfMs = parseTimeMs(asOf);
    if (!Number.isFinite(asOfMs)) return [];
    const rows = [...(healthRecords || [])]
      .filter(row => Number.isFinite(parseTimeMs(row?.retrievedAt)))
      .filter(row => parseTimeMs(row.retrievedAt) <= asOfMs)
      .sort((a, b) => parseTimeMs(a.retrievedAt) - parseTimeMs(b.retrievedAt));
    const segments = [];
    let segment = null;

    function finish() {
      if (segment) segments.push(segment);
      segment = null;
    }

    for (const row of rows) {
      if (!segment) {
        segment = {
          startAt: row.retrievedAt,
          endAt: row.retrievedAt,
          firstEvidenceAt: row.retrievedAt,
          lastEvidenceAt: row.retrievedAt,
          recordCount: 1
        };
        continue;
      }
      const gapMinutes = minutesBetween(row.retrievedAt, segment.endAt);
      if (!Number.isFinite(gapMinutes) || gapMinutes > maxGapMinutes) {
        finish();
        segment = {
          startAt: row.retrievedAt,
          endAt: row.retrievedAt,
          firstEvidenceAt: row.retrievedAt,
          lastEvidenceAt: row.retrievedAt,
          recordCount: 1
        };
        continue;
      }
      segment.endAt = row.retrievedAt;
      segment.lastEvidenceAt = row.retrievedAt;
      segment.recordCount += 1;
    }
    finish();
    return segments;
  }

  function findJointNoSignalCoverage({
    caseId,
    records,
    caseIndex,
    truthHealthRecords,
    afterAt,
    asOf,
    durationHours = 24,
    prospectiveMaxGapMinutes = PROSPECTIVE_MAX_GAP_MINUTES,
    truthMaxGapMinutes = TRUTH_HEALTH_MAX_GAP_MINUTES
  }) {
    const prospectiveSegments = continuousProspectiveAbsenceSegments({
      caseId,
      records,
      caseIndex,
      afterAt,
      asOf,
      maxGapMinutes: prospectiveMaxGapMinutes
    });
    const truthSegments = continuousTruthHealthSegments({
      healthRecords: truthHealthRecords,
      asOf,
      maxGapMinutes: truthMaxGapMinutes
    });
    const durationMs = durationHours * 3600000;

    if (!prospectiveSegments.length) {
      return {
        complete: false,
        reason: 'no-continuous-prospective-absence',
        prospectiveSegments,
        truthSegments
      };
    }
    if (!truthSegments.length) {
      return {
        complete: false,
        reason: 'truth-health-history-unavailable',
        prospectiveSegments,
        truthSegments
      };
    }

    for (const prospective of prospectiveSegments) {
      const pStart = parseTimeMs(prospective.startAt);
      const pEnd = parseTimeMs(prospective.endAt);
      for (const truth of truthSegments) {
        const tStart = parseTimeMs(truth.startAt);
        const tEnd = parseTimeMs(truth.endAt);
        const overlapStart = Math.max(pStart, tStart);
        const overlapEnd = Math.min(pEnd, tEnd);
        if (overlapEnd - overlapStart < durationMs) continue;
        return {
          complete: true,
          reason: 'covered',
          coverageStartedAt: new Date(overlapStart).toISOString(),
          coverageThrough: new Date(overlapEnd).toISOString(),
          closedAt: new Date(overlapStart + durationMs).toISOString(),
          evidenceAt: new Date(overlapEnd).toISOString(),
          durationHours,
          prospectiveMaxGapMinutes,
          truthMaxGapMinutes,
          prospectiveSegment: prospective,
          truthSegment: truth
        };
      }
    }

    return {
      complete: false,
      reason: 'joint-coverage-shorter-than-grace',
      durationHours,
      prospectiveMaxGapMinutes,
      truthMaxGapMinutes,
      prospectiveSegments,
      truthSegments
    };
  }

  function summarizeProspectiveGaps(records, maxGapMinutes = PROSPECTIVE_MAX_GAP_MINUTES) {
    const rows = sortRecords(records);
    const gaps = [];
    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1];
      const current = rows[index];
      const gapMinutes = minutesBetween(current.capturedAt, previous.capturedAt);
      if (gapMinutes > maxGapMinutes) {
        gaps.push({
          from: previous.capturedAt,
          to: current.capturedAt,
          gapMinutes
        });
      }
    }
    return {
      maxGapMinutes,
      gapCount: gaps.length,
      gaps
    };
  }

  return Object.freeze({
    VERSION,
    POLICY,
    PROSPECTIVE_MAX_GAP_MINUTES,
    CHECKPOINT_MAX_AGE_MINUTES,
    TRUTH_HEALTH_MAX_GAP_MINUTES,
    parseTimeMs,
    minutesBetween,
    recordHealthy,
    buildIdentityMap,
    recordCaseIds,
    assessCheckpoint,
    assessCaseInterval,
    continuousProspectiveAbsenceSegments,
    continuousTruthHealthSegments,
    findJointNoSignalCoverage,
    summarizeProspectiveGaps
  });
});
