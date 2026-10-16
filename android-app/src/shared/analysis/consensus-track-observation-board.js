(function attachConsensusTrackObservationBoard(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ConsensusTrackObservationBoard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createConsensusTrackObservationBoard() {
  'use strict';

  const VERSION = 'consensus-track-observation-board/v1';
  const MAX_TIMELINE_ROWS = 18;
  const ACTIVE_HORIZON_HOURS = 48;
  const TARGET_LEADS = Object.freeze([24, 48, 72, 96, 120]);
  const TRUSTED_SCHEMAS = new Set([
    'storm-consensus-track-prospective/v1',
    'storm-consensus-track-prospective/v2'
  ]);
  const EARTH_RADIUS_KM = 6371;

  function finite(value) {
    if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function timeMs(value) {
    const ms = Date.parse(value || '');
    return Number.isFinite(ms) ? ms : null;
  }

  function hoursBetween(left, right) {
    const a = timeMs(left);
    const b = timeMs(right);
    return Number.isFinite(a) && Number.isFinite(b) ? (a - b) / 3600000 : null;
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const values = [lat1, lon1, lat2, lon2].map(finite);
    if (values.some(value => value == null)) return null;
    const [aLat, aLon, bLat, bLon] = values;
    const toRad = degree => degree * Math.PI / 180;
    const dLat = toRad(bLat - aLat);
    const dLon = toRad(bLon - aLon);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function observationKey(fingerprint, groupKey) {
    return `${fingerprint || ''}\u0000${groupKey || ''}`;
  }

  function caseCaptureKey(caseId, fingerprint) {
    return `${caseId || ''}\u0000${fingerprint || ''}`;
  }

  function observationPath(capturedAt, fingerprint) {
    const ms = timeMs(capturedAt);
    if (!Number.isFinite(ms) || !fingerprint) return null;
    const iso = new Date(ms).toISOString();
    const year = iso.slice(0, 4);
    const month = iso.slice(5, 7);
    const day = iso.slice(8, 10);
    const stamp = `${year}${month}${day}T${iso.slice(11, 19).replaceAll(':', '')}Z`;
    return `observations/${year}/${month}/${day}/${stamp}-${String(fingerprint).slice(0, 12)}.json`;
  }

  function sampleSummary(sample) {
    if (!sample || typeof sample !== 'object') return null;
    const leadHours = finite(sample.leadHours);
    if (leadHours == null) return null;
    const consensusLat = finite(sample.consensusLat);
    const consensusLon = finite(sample.consensusLon);
    return {
      leadHours,
      validTime: Number.isFinite(timeMs(sample.validTime)) ? new Date(timeMs(sample.validTime)).toISOString() : null,
      agencyCount: finite(sample.agencyCount),
      agencies: Array.isArray(sample.agencies) ? [...sample.agencies].filter(Boolean).sort() : [],
      interpolatedAgencyCount: finite(sample.interpolatedAgencyCount),
      spreadKm: finite(sample.spreadKm),
      consensusLat,
      consensusLon,
      hasConsensus: consensusLat != null && consensusLon != null
    };
  }

  function groupRow(record, group, identity) {
    const samples = (Array.isArray(group?.samples) ? group.samples : [])
      .map(sampleSummary)
      .filter(Boolean)
      .sort((a, b) => a.leadHours - b.leadHours);
    const sampleByLead = Object.fromEntries(samples.map(sample => [String(sample.leadHours), sample]));
    const sourceAgencies = Array.isArray(group?.sourceAgencies)
      ? [...group.sourceAgencies].filter(Boolean).sort()
      : Object.keys(group?.sourceReferences || {}).sort();
    return {
      caseId: identity.caseId,
      capturedAt: record.capturedAt,
      captureFingerprint: record.captureFingerprint,
      schemaVersion: record.schemaVersion,
      rawGroupKey: group?.key || null,
      displayName: group?.displayName || group?.nameEn || group?.key || identity.caseId,
      referenceBaseTime: Number.isFinite(timeMs(group?.referenceBaseTime)) ? new Date(timeMs(group.referenceBaseTime)).toISOString() : null,
      referenceMethod: group?.referenceMethod || null,
      configuredHorizonHours: finite(group?.configuredHorizonHours),
      stepHours: finite(group?.stepHours),
      consensusPointCount: finite(group?.consensusPointCount),
      supportedThroughHours: finite(group?.supportedThroughHours),
      continuousConsensusThroughHours: finite(group?.continuousConsensusThroughHours),
      sourceAgencies,
      samples,
      leadSamples: Object.fromEntries(TARGET_LEADS.map(lead => [String(lead), sampleByLead[String(lead)] || null])),
      movement: null
    };
  }

  function sameValidTimeMovement(previous, current) {
    const previousByValidTime = new Map((previous?.samples || [])
      .filter(sample => sample.hasConsensus && sample.validTime)
      .map(sample => [sample.validTime, sample]));
    const distances = [];
    for (const sample of current?.samples || []) {
      if (!sample.hasConsensus || !sample.validTime) continue;
      const before = previousByValidTime.get(sample.validTime);
      if (!before) continue;
      const distanceKm = haversineKm(before.consensusLat, before.consensusLon, sample.consensusLat, sample.consensusLon);
      if (!Number.isFinite(distanceKm)) continue;
      distances.push({
        validTime: sample.validTime,
        previousLeadHours: before.leadHours,
        currentLeadHours: sample.leadHours,
        distanceKm,
        previousSpreadKm: before.spreadKm,
        currentSpreadKm: sample.spreadKm
      });
    }
    if (!distances.length) {
      return {
        matchedValidTimeCount: 0,
        meanKm: null,
        maxKm: null,
        maxValidTime: null,
        referenceShiftHours: hoursBetween(current?.referenceBaseTime, previous?.referenceBaseTime)
      };
    }
    const meanKm = distances.reduce((sum, item) => sum + item.distanceKm, 0) / distances.length;
    const max = distances.reduce((best, item) => !best || item.distanceKm > best.distanceKm ? item : best, null);
    return {
      matchedValidTimeCount: distances.length,
      meanKm,
      maxKm: max.distanceKm,
      maxValidTime: max.validTime,
      referenceShiftHours: hoursBetween(current?.referenceBaseTime, previous?.referenceBaseTime)
    };
  }

  function withMovement(rows) {
    return rows.map((row, index) => index === 0
      ? { ...row, movement: null }
      : { ...row, movement: sameValidTimeMovement(rows[index - 1], row) });
  }

  function deriveObservationBoard({ records = [], caseIndex = [] } = {}) {
    const trustedRecords = records
      .filter(record => TRUSTED_SCHEMAS.has(record?.schemaVersion))
      .filter(record => Number.isFinite(timeMs(record?.capturedAt)))
      .sort((a, b) => timeMs(a.capturedAt) - timeMs(b.capturedAt));
    const trustedFingerprints = new Set(trustedRecords.map(record => record.captureFingerprint).filter(Boolean));

    const caseCaptureRows = new Map();
    for (const row of caseIndex) {
      if (!row?.caseId || !row?.captureFingerprint || !trustedFingerprints.has(row.captureFingerprint)) continue;
      const key = caseCaptureKey(row.caseId, row.captureFingerprint);
      if (!caseCaptureRows.has(key)) caseCaptureRows.set(key, []);
      caseCaptureRows.get(key).push(row);
    }
    const excludedAmbiguousCaseCaptures = [...caseCaptureRows.entries()]
      .filter(([, rows]) => rows.length > 1)
      .map(([key, rows]) => ({
        key,
        caseId: rows[0].caseId,
        captureFingerprint: rows[0].captureFingerprint,
        capturedAt: rows[0].capturedAt || null,
        rawGroupKeys: [...new Set(rows.map(row => row.rawGroupKey).filter(Boolean))].sort()
      }));
    const excludedKeys = new Set(excludedAmbiguousCaseCaptures.map(item => item.key));

    const identityByObservation = new Map();
    for (const row of caseIndex) identityByObservation.set(observationKey(row.captureFingerprint, row.rawGroupKey), row);

    const timelines = new Map();
    for (const record of trustedRecords) {
      for (const group of Array.isArray(record?.groups) ? record.groups : []) {
        const identity = identityByObservation.get(observationKey(record.captureFingerprint, group?.key));
        if (!identity?.caseId) continue;
        if (excludedKeys.has(caseCaptureKey(identity.caseId, record.captureFingerprint))) continue;
        if (!timelines.has(identity.caseId)) timelines.set(identity.caseId, []);
        timelines.get(identity.caseId).push(groupRow(record, group, identity));
      }
    }

    const latestTrustedAt = trustedRecords.at(-1)?.capturedAt || null;
    const latestTrustedMs = timeMs(latestTrustedAt);
    const storms = [];
    for (const [caseId, rawRows] of timelines) {
      const rows = withMovement(rawRows.sort((a, b) => timeMs(a.capturedAt) - timeMs(b.capturedAt)));
      const latest = rows.at(-1);
      if (!latest) continue;
      if (Number.isFinite(latestTrustedMs) && latestTrustedMs - timeMs(latest.capturedAt) > ACTIVE_HORIZON_HOURS * 3600000) continue;
      storms.push({
        caseId,
        displayName: latest.displayName || latest.rawGroupKey || caseId,
        rawGroupKey: latest.rawGroupKey,
        has120hConsensus: Boolean(latest.leadSamples['120']?.hasConsensus),
        latest,
        timeline: rows.slice(-MAX_TIMELINE_ROWS)
      });
    }
    storms.sort((a, b) => (b.latest.continuousConsensusThroughHours ?? -1) - (a.latest.continuousConsensusThroughHours ?? -1)
      || a.displayName.localeCompare(b.displayName));

    return {
      schemaVersion: VERSION,
      semantics: {
        mode: 'observation-only',
        scoring: false,
        calibration: false,
        probability: false,
        verificationTruthRead: false,
        modelMutation: false,
        movementComparison: 'exact-common-valid-times-only',
        source: 'storm-consensus-track-prospective/v1-v2 with storm-case-identity/v1 reconciliation'
      },
      prospective: {
        trustedRecordCount: trustedRecords.length,
        latestCapturedAt: latestTrustedAt,
        excludedAmbiguousCaseCaptureCount: excludedAmbiguousCaseCaptures.length,
        excludedAmbiguousCaseCaptures: excludedAmbiguousCaseCaptures.map(({ key, ...item }) => item)
      },
      summary: {
        activeStormCount: storms.length,
        full120hStormCount: storms.filter(storm => storm.has120hConsensus).length,
        maxTimelineRowsPerStorm: MAX_TIMELINE_ROWS,
        targetLeads: [...TARGET_LEADS]
      },
      storms
    };
  }

  return Object.freeze({
    VERSION,
    MAX_TIMELINE_ROWS,
    ACTIVE_HORIZON_HOURS,
    TARGET_LEADS,
    observationPath,
    deriveObservationBoard
  });
});
