(function attachStormCaseIdentity(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StormCaseIdentity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormCaseIdentity() {
  'use strict';

  const VERSION = 'storm-case-identity/v1';
  const AGENCY_PRIORITY = Object.freeze(['JMA', 'CMA', 'CWA', 'HKO']);
  const MAX_NAME_GAP_HOURS = 24 * 7;
  const MAX_PHYSICAL_GAP_HOURS = 30;
  const MAX_PHYSICAL_DISTANCE_KM = 300;
  const EARTH_RADIUS_KM = 6371.0088;

  function normalizeName(value) {
    return String(value || '').trim().toUpperCase().replace(/[\s()（）._\-/]+/g, '');
  }

  function isGenericName(value) {
    const text = normalizeName(value);
    if (!text) return true;
    if (/^(UNNAMED|NAMELESS|TROPICALDEPRESSION|TROPICALSTORM|TD|TS|熱帶低氣壓|熱帶低壓|热带低气压|热带低压|熱帶風暴|热带风暴|未命名熱帶氣旋|未命名热带气旋|未命名)\d*$/.test(text)) return true;
    return /^(?:(?:TROPICALDEPRESSION|TROPICALSTORM|熱帶低氣壓|熱帶低壓|热带低气压|热带低压|熱帶風暴|热带风暴))?(?:TC|TD|TS)\d+[A-Z]?$/.test(text);
  }

  function parseTimeMs(value) {
    if (!value) return NaN;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : NaN;
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const values = [lat1, lon1, lat2, lon2].map(Number);
    if (!values.every(Number.isFinite)) return Infinity;
    const [aLat, aLon, bLat, bLon] = values.map(value => value * Math.PI / 180);
    const dLat = bLat - aLat;
    const dLon = bLon - aLon;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(aLat) * Math.cos(bLat) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function sourceIdsByAgency(observation) {
    const result = {};
    Object.entries(observation?.sources || {}).forEach(([key, source]) => {
      const agency = String(source?.agency || key || '').trim().toUpperCase();
      const sourceId = String(source?.sourceId || '').trim();
      if (!agency || !sourceId) return;
      if (!result[agency]) result[agency] = [];
      if (!result[agency].includes(sourceId)) result[agency].push(sourceId);
    });
    Object.values(result).forEach(values => values.sort());
    return result;
  }

  function sourceTokens(sourceIds) {
    return Object.entries(sourceIds || {})
      .flatMap(([agency, ids]) => (ids || []).map(id => `${agency}:${id}`))
      .sort();
  }

  function specificNames(observation) {
    const values = [observation?.group?.nameEn, observation?.group?.nameTc]
      .map(normalizeName)
      .filter(value => value && !isGenericName(value));
    return [...new Set(values)].sort();
  }

  function representativePoint(observation) {
    const points = Object.values(observation?.sources || {})
      .map(source => source?.current)
      .filter(point => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lon)));
    if (!points.length) return null;
    const lat = points.reduce((sum, point) => sum + Number(point.lat), 0) / points.length;
    const lon = points.reduce((sum, point) => sum + Number(point.lon), 0) / points.length;
    const times = points.map(point => parseTimeMs(point?.time)).filter(Number.isFinite);
    return {
      lat,
      lon,
      time: times.length ? new Date(Math.max(...times)).toISOString() : null
    };
  }

  function buildFeatures(record, observation) {
    const sourceIds = sourceIdsByAgency(observation);
    return {
      capturedAt: record?.capturedAt || observation?.observedAt || null,
      captureFingerprint: record?.captureFingerprint || null,
      groupKey: String(observation?.group?.key || '').trim() || null,
      displayName: observation?.group?.displayName || null,
      sourceIds,
      sourceTokens: sourceTokens(sourceIds),
      names: specificNames(observation),
      representative: representativePoint(observation)
    };
  }

  function intersectCount(left, right) {
    const rightSet = new Set(right || []);
    return (left || []).reduce((count, item) => count + (rightSet.has(item) ? 1 : 0), 0);
  }

  function agencyConflict(features, stormCase) {
    return Object.entries(features.sourceIds || {}).some(([agency, ids]) => {
      const known = stormCase.sourceIdsByAgency?.[agency] || [];
      if (!known.length) return false;
      return !ids.some(id => known.includes(id));
    });
  }

  function continuityMetrics(features, stormCase) {
    const current = features.representative;
    const previous = stormCase.lastRepresentative;
    if (!current || !previous) return { gapHours: Infinity, distanceKm: Infinity };
    const currentMs = parseTimeMs(current.time || features.capturedAt);
    const previousMs = parseTimeMs(previous.time || stormCase.lastSeen);
    const gapHours = Number.isFinite(currentMs) && Number.isFinite(previousMs)
      ? Math.abs(currentMs - previousMs) / 3600000
      : Infinity;
    return {
      gapHours,
      distanceKm: haversineKm(current.lat, current.lon, previous.lat, previous.lon)
    };
  }

  function matchCase(features, stormCase) {
    const sourceOverlap = intersectCount(features.sourceTokens, stormCase.sourceTokens);
    const nameOverlap = intersectCount(features.names, stormCase.names);
    const conflict = agencyConflict(features, stormCase);
    const specificNameConflict = features.names.length > 0 && stormCase.names.length > 0 && nameOverlap === 0;
    const continuity = continuityMetrics(features, stormCase);

    // A formal cyclone name is a stronger identity boundary than a recycled or
    // previously mis-attributed agency source ID. Generic -> named transitions
    // remain allowed because the pre-name case has no specific names yet.
    if (specificNameConflict) {
      return { matched: false, reason: 'specific-name-conflict', score: -Infinity, ...continuity };
    }

    if (sourceOverlap > 0) {
      return {
        matched: true,
        reason: 'source-id-overlap',
        score: 1000 + sourceOverlap * 50 + nameOverlap * 5,
        ...continuity
      };
    }

    if (conflict) return { matched: false, reason: 'agency-source-id-conflict', score: -Infinity, ...continuity };

    if (nameOverlap > 0 && continuity.gapHours <= MAX_NAME_GAP_HOURS) {
      return {
        matched: true,
        reason: 'specific-name-continuity',
        score: 700 + nameOverlap * 20 - Math.min(continuity.gapHours, 168),
        ...continuity
      };
    }

    const sameCapture = features.captureFingerprint
      && stormCase.lastCaptureFingerprint === features.captureFingerprint;
    if (!sameCapture
        && continuity.gapHours <= MAX_PHYSICAL_GAP_HOURS
        && continuity.distanceKm <= MAX_PHYSICAL_DISTANCE_KM) {
      return {
        matched: true,
        reason: 'physical-continuity',
        score: 400 + (MAX_PHYSICAL_DISTANCE_KM - continuity.distanceKm)
          - continuity.gapHours * 2,
        ...continuity
      };
    }

    return { matched: false, reason: 'no-continuity-evidence', score: -Infinity, ...continuity };
  }

  function sanitizeToken(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  }

  function fallbackHash(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0').toUpperCase();
  }

  function createCaseId(features) {
    const year = (() => {
      const ms = parseTimeMs(features.capturedAt);
      return Number.isFinite(ms) ? new Date(ms).getUTCFullYear() : 'UNK';
    })();
    for (const agency of AGENCY_PRIORITY) {
      const sourceId = features.sourceIds?.[agency]?.[0];
      if (sourceId) return `STC-${year}-${agency}-${sanitizeToken(sourceId)}`;
    }
    const key = sanitizeToken(features.groupKey || features.displayName || 'UNKNOWN');
    return `STC-${year}-${key || 'UNKNOWN'}-${fallbackHash(features.capturedAt)}`;
  }

  function addUnique(target, values) {
    for (const value of values || []) if (value != null && value !== '' && !target.includes(value)) target.push(value);
    target.sort();
  }

  function updateCase(stormCase, features) {
    stormCase.lastSeen = features.capturedAt || stormCase.lastSeen;
    stormCase.lastCaptureFingerprint = features.captureFingerprint || stormCase.lastCaptureFingerprint;
    if (features.representative) stormCase.lastRepresentative = features.representative;
    addUnique(stormCase.groupKeys, features.groupKey ? [features.groupKey] : []);
    addUnique(stormCase.displayNames, features.displayName ? [features.displayName] : []);
    addUnique(stormCase.names, features.names);
    addUnique(stormCase.sourceTokens, features.sourceTokens);
    Object.entries(features.sourceIds || {}).forEach(([agency, ids]) => {
      if (!stormCase.sourceIdsByAgency[agency]) stormCase.sourceIdsByAgency[agency] = [];
      addUnique(stormCase.sourceIdsByAgency[agency], ids);
    });
  }

  function newCase(features) {
    const stormCase = {
      caseId: createCaseId(features),
      firstSeen: features.capturedAt,
      lastSeen: features.capturedAt,
      firstCaptureFingerprint: features.captureFingerprint,
      lastCaptureFingerprint: features.captureFingerprint,
      groupKeys: [],
      displayNames: [],
      names: [],
      sourceTokens: [],
      sourceIdsByAgency: {},
      lastRepresentative: features.representative || null
    };
    updateCase(stormCase, features);
    return stormCase;
  }

  function normalizeRecords(records) {
    return [...(records || [])]
      .filter(record => record && typeof record === 'object')
      .sort((left, right) => {
        const time = parseTimeMs(left.capturedAt) - parseTimeMs(right.capturedAt);
        if (Number.isFinite(time) && time !== 0) return time;
        return String(left.captureFingerprint || '').localeCompare(String(right.captureFingerprint || ''));
      });
  }

  function reconcileProspectiveRecords(records) {
    const cases = [];
    const index = [];
    const normalized = normalizeRecords(records);

    for (const record of normalized) {
      const observations = [...(record.observations || [])]
        .sort((left, right) => String(left?.group?.key || '').localeCompare(String(right?.group?.key || '')));
      for (const observation of observations) {
        const features = buildFeatures(record, observation);
        const candidates = cases
          .map(stormCase => ({ stormCase, match: matchCase(features, stormCase) }))
          .filter(item => item.match.matched)
          .sort((left, right) => right.match.score - left.match.score
            || left.stormCase.caseId.localeCompare(right.stormCase.caseId));

        let stormCase = candidates[0]?.stormCase || null;
        let resolution = candidates[0]?.match || null;
        if (!stormCase) {
          stormCase = newCase(features);
          cases.push(stormCase);
          resolution = { reason: 'new-case', score: null, gapHours: null, distanceKm: null };
        } else {
          updateCase(stormCase, features);
        }

        index.push({
          resolverVersion: VERSION,
          capturedAt: record.capturedAt || null,
          captureFingerprint: record.captureFingerprint || null,
          observationSchemaVersion: observation?.schemaVersion || null,
          rawGroupKey: features.groupKey,
          rawDisplayName: features.displayName,
          caseId: stormCase.caseId,
          resolution: {
            reason: resolution.reason,
            score: Number.isFinite(resolution.score) ? resolution.score : null,
            gapHours: Number.isFinite(resolution.gapHours) ? resolution.gapHours : null,
            distanceKm: Number.isFinite(resolution.distanceKm) ? resolution.distanceKm : null
          },
          sourceTokens: features.sourceTokens,
          specificNames: features.names
        });
      }
    }

    const publicCases = cases.map(stormCase => ({
      caseId: stormCase.caseId,
      firstSeen: stormCase.firstSeen,
      lastSeen: stormCase.lastSeen,
      groupKeys: stormCase.groupKeys,
      displayNames: stormCase.displayNames,
      names: stormCase.names,
      sourceTokens: stormCase.sourceTokens,
      sourceIdsByAgency: stormCase.sourceIdsByAgency,
      lastRepresentative: stormCase.lastRepresentative
    })).sort((left, right) => left.caseId.localeCompare(right.caseId));

    return {
      schemaVersion: VERSION,
      reconciledThrough: normalized.at(-1)?.capturedAt || null,
      caseCount: publicCases.length,
      cases: publicCases,
      index
    };
  }

  return Object.freeze({
    VERSION,
    AGENCY_PRIORITY,
    normalizeName,
    isGenericName,
    sourceIdsByAgency,
    representativePoint,
    reconcileProspectiveRecords
  });
});
