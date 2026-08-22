(function attachHkSignalObservationBoard(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HkSignalObservationBoard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHkSignalObservationBoard() {
  'use strict';

  const VERSION = 'hk-signal-observation-board/v1';
  const MAX_TIMELINE_ROWS = 18;
  const ACTIVE_HORIZON_HOURS = 48;

  function finite(value) {
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

  function observationKey(fingerprint, groupKey) {
    return `${fingerprint || ''}\u0000${groupKey || ''}`;
  }

  function caseCaptureKey(caseId, fingerprint) {
    return `${caseId || ''}\u0000${fingerprint || ''}`;
  }

  function observationPath(capturedAt, fingerprint) {
    const ms = timeMs(capturedAt);
    if (!Number.isFinite(ms) || !fingerprint) return null;
    const date = new Date(ms);
    const iso = date.toISOString();
    const year = iso.slice(0, 4);
    const month = iso.slice(5, 7);
    const day = iso.slice(8, 10);
    const stamp = `${year}${month}${day}T${iso.slice(11, 19).replaceAll(':', '')}Z`;
    return `observations/${year}/${month}/${day}/${stamp}-${String(fingerprint).slice(0, 12)}.json`;
  }

  function signalSummary(signal) {
    const window = signal?.estimatedWindow && typeof signal.estimatedWindow === 'object'
      ? { start: signal.estimatedWindow.start || null, end: signal.estimatedWindow.end || null }
      : null;
    return {
      likelihood: signal?.likelihood || null,
      riskIndex: finite(signal?.riskIndex),
      confidenceIndex: finite(signal?.confidenceIndex),
      persistenceHours: finite(signal?.persistenceHours),
      window,
      windowWidthHours: window?.start && window?.end ? hoursBetween(window.end, window.start) : null
    };
  }

  function agencyDiagnostics(observation) {
    const trendAgencies = observation?.analysis?.impact?.trend?.agencies || {};
    return Object.entries(observation?.sources || {}).map(([agency, source]) => {
      const trend = trendAgencies[agency] || {};
      return {
        agency,
        sourceId: source?.sourceId || null,
        bulletinTime: source?.bulletinTime || null,
        current: source?.current ? {
          time: source.current.time || null,
          lat: finite(source.current.lat),
          lon: finite(source.current.lon),
          maximumWind: source.current.maximumWind ?? null,
          pressure: source.current.pressure ?? null,
          intensity: source.current.intensity ?? null
        } : null,
        forecastEnd: source?.forecastEnd ? {
          time: source.forecastEnd.time || null,
          lat: finite(source.forecastEnd.lat),
          lon: finite(source.forecastEnd.lon),
          maximumWind: source.forecastEnd.maximumWind ?? null,
          pressure: source.forecastEnd.pressure ?? null,
          intensity: source.forecastEnd.intensity ?? null
        } : null,
        trend: {
          state: trend.state || 'unavailable',
          deltaKm: finite(trend.deltaKm),
          horizonHours: finite(trend.horizonHours),
          startDistanceKm: finite(trend.startDistanceKm),
          endDistanceKm: finite(trend.endDistanceKm)
        }
      };
    }).sort((a, b) => a.agency.localeCompare(b.agency));
  }

  function observationRow(record, observation, identity) {
    const feature = observation?.analysis?.signalInputs?.featureVector || {};
    const disagreement = observation?.analysis?.signalInputs?.disagreement || {};
    const impact = observation?.analysis?.impact || {};
    const basic = observation?.analysis?.basicForecast || {};
    return {
      caseId: identity.caseId,
      capturedAt: record.capturedAt,
      captureFingerprint: record.captureFingerprint,
      rawGroupKey: observation?.group?.key || null,
      displayName: observation?.group?.displayName || null,
      sourceAgencies: Array.isArray(observation?.sourceAgencies) ? [...observation.sourceAgencies] : [],
      signals: {
        T1: signalSummary(basic?.signals?.T1),
        T3: signalSummary(basic?.signals?.T3),
        T8: signalSummary(basic?.signals?.T8)
      },
      drivers: {
        comparisonSpreadKm: finite(disagreement.comparisonSpreadKm ?? feature.comparisonSpreadKm),
        closestDistanceMinKm: finite(feature.closestDistanceMinKm),
        closestDistanceMaxKm: finite(feature.closestDistanceMaxKm),
        closestDistanceSpanKm: finite(disagreement.closestDistanceSpanKm ?? feature.closestDistanceSpanKm),
        closestTimeSpreadHours: finite(disagreement.closestTimeSpreadHours ?? feature.closestTimeSpreadHours),
        consensusClosestDistanceKm: finite(feature.consensusClosestDistanceKm ?? impact?.closestApproach?.consensus?.distanceKm),
        consensusClosestLeadHours: finite(feature.consensusClosestLeadHours),
        currentDistanceMedianKm: finite(feature.currentDistanceMedianKm),
        derivedMotionSpeedMedianKmh: finite(feature.derivedMotionSpeedMedianKmh),
        currentMaximumWindMedianMs: finite(feature.currentMaximumWindMedianMs),
        closestMaximumWindMedianMs: finite(feature.closestMaximumWindMedianMs),
        usableAgencyCount: finite(feature.usableAgencyCount),
        windRadiusAgencyCount: finite(feature.windRadiusAgencyCount),
        uncertaintyLevel: impact?.uncertainty?.level || null,
        uncertaintyReasons: Array.isArray(impact?.uncertainty?.reasons) ? [...impact.uncertainty.reasons] : [],
        trend: impact?.trend?.aggregate || null
      },
      agencies: agencyDiagnostics(observation),
      deltas: null
    };
  }

  function withDeltas(rows) {
    return rows.map((row, index) => {
      if (index === 0) return { ...row, deltas: null };
      const previous = rows[index - 1];
      const delta = (a, b) => Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
      return {
        ...row,
        deltas: {
          t1RiskIndex: delta(row.signals.T1.riskIndex, previous.signals.T1.riskIndex),
          t1ConfidenceIndex: delta(row.signals.T1.confidenceIndex, previous.signals.T1.confidenceIndex),
          t1WindowStartHours: row.signals.T1.window?.start && previous.signals.T1.window?.start
            ? hoursBetween(row.signals.T1.window.start, previous.signals.T1.window.start) : null,
          t1WindowEndHours: row.signals.T1.window?.end && previous.signals.T1.window?.end
            ? hoursBetween(row.signals.T1.window.end, previous.signals.T1.window.end) : null,
          comparisonSpreadKm: delta(row.drivers.comparisonSpreadKm, previous.drivers.comparisonSpreadKm),
          consensusClosestDistanceKm: delta(row.drivers.consensusClosestDistanceKm, previous.drivers.consensusClosestDistanceKm),
          consensusClosestLeadHours: delta(row.drivers.consensusClosestLeadHours, previous.drivers.consensusClosestLeadHours)
        }
      };
    });
  }

  function deriveObservationBoard({ records = [], caseIndex = [] } = {}) {
    const trustedRecords = records
      .filter(record => record?.schemaVersion === 'beta-prospective-recorder/v2')
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
      }))
      .sort((a, b) => (timeMs(a.capturedAt) ?? 0) - (timeMs(b.capturedAt) ?? 0) || a.caseId.localeCompare(b.caseId));
    const excludedKeys = new Set(excludedAmbiguousCaseCaptures.map(item => item.key));

    const identityByObservation = new Map();
    for (const row of caseIndex) identityByObservation.set(observationKey(row.captureFingerprint, row.rawGroupKey), row);

    const timelines = new Map();
    for (const record of trustedRecords) {
      for (const observation of record?.observations || []) {
        const groupKey = observation?.group?.key || null;
        const identity = identityByObservation.get(observationKey(record.captureFingerprint, groupKey));
        if (!identity?.caseId) continue;
        if (excludedKeys.has(caseCaptureKey(identity.caseId, record.captureFingerprint))) continue;
        if (!timelines.has(identity.caseId)) timelines.set(identity.caseId, []);
        timelines.get(identity.caseId).push(observationRow(record, observation, identity));
      }
    }

    const latestTrustedAt = trustedRecords.at(-1)?.capturedAt || null;
    const latestTrustedMs = timeMs(latestTrustedAt);
    const storms = [];
    for (const [caseId, rawRows] of timelines) {
      const rows = withDeltas(rawRows.sort((a, b) => timeMs(a.capturedAt) - timeMs(b.capturedAt)));
      const latest = rows.at(-1);
      if (!latest) continue;
      if (Number.isFinite(latestTrustedMs) && latestTrustedMs - timeMs(latest.capturedAt) > ACTIVE_HORIZON_HOURS * 3600000) continue;
      storms.push({
        caseId,
        displayName: latest.displayName || latest.rawGroupKey || caseId,
        rawGroupKey: latest.rawGroupKey,
        hasT1Window: Boolean(latest.signals.T1.window?.start && latest.signals.T1.window?.end),
        latest,
        timeline: rows.slice(-MAX_TIMELINE_ROWS)
      });
    }
    storms.sort((a, b) => {
      const aw = a.hasT1Window ? 1 : 0;
      const bw = b.hasT1Window ? 1 : 0;
      if (aw !== bw) return bw - aw;
      return (b.latest.signals.T1.riskIndex ?? -1) - (a.latest.signals.T1.riskIndex ?? -1)
        || a.displayName.localeCompare(b.displayName);
    });

    return {
      schemaVersion: VERSION,
      semantics: {
        mode: 'observation-only',
        scoring: false,
        calibration: false,
        modelMutation: false,
        source: 'trusted beta-prospective-recorder/v2 observations with storm-case-identity/v1 reconciliation',
        ambiguousCapturePolicy: 'exclude the entire case/capture when multiple final frontend observations resolve to the same stable case'
      },
      prospective: {
        trustedRecordCount: trustedRecords.length,
        latestCapturedAt: latestTrustedAt,
        excludedAmbiguousCaseCaptureCount: excludedAmbiguousCaseCaptures.length,
        excludedAmbiguousCaseCaptures: excludedAmbiguousCaseCaptures.map(({ key, ...item }) => item)
      },
      summary: {
        activeStormCount: storms.length,
        t1WindowStormCount: storms.filter(storm => storm.hasT1Window).length,
        maxTimelineRowsPerStorm: MAX_TIMELINE_ROWS
      },
      storms
    };
  }

  return Object.freeze({
    VERSION,
    MAX_TIMELINE_ROWS,
    ACTIVE_HORIZON_HOURS,
    observationPath,
    deriveObservationBoard
  });
});
