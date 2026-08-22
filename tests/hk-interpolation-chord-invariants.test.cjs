'use strict';

const assert = require('node:assert/strict');
const threat = require('../analysis/hk-threat-assessment.js');
const basic = require('../analysis/basic-hk-signal-forecast.js');

const BASE = '2026-08-21T00:00:00.000Z';
const HK = { lat: 22.3023, lon: 114.1746 };
const time = hours => new Date(Date.parse(BASE) + hours * 3600000).toISOString();

const endpoint0 = { lat: 16.0, lon: 108.0, wind: 35 };
const endpoint24 = { lat: 28.0, lon: 120.0, wind: 35 };
const safeMid = { lat: 22.0, lon: 124.0, wind: 35 };

function point(hour, state, kind = 'forecast') {
  return {
    time: time(hour),
    lat: state.lat,
    lon: state.lon,
    maximumWind: state.wind,
    kind
  };
}

function sparseSource(latOffset = 0, lonOffset = 0) {
  const a = { ...endpoint0, lat: endpoint0.lat + latOffset, lon: endpoint0.lon + lonOffset };
  const b = { ...endpoint24, lat: endpoint24.lat + latOffset, lon: endpoint24.lon + lonOffset };
  return { state: 'ok', positions: [point(0, a, 'analysis')], forecast: [point(24, b)] };
}

function resolvedSource(latOffset = 0, lonOffset = 0) {
  const a = { ...endpoint0, lat: endpoint0.lat + latOffset, lon: endpoint0.lon + lonOffset };
  const m = { ...safeMid, lat: safeMid.lat + latOffset, lon: safeMid.lon + lonOffset };
  const b = { ...endpoint24, lat: endpoint24.lat + latOffset, lon: endpoint24.lon + lonOffset };
  return { state: 'ok', positions: [point(0, a, 'analysis')], forecast: [point(12, m), point(24, b)] };
}

function snapshot({ resolved }) {
  return {
    generatedAt: BASE,
    referencePoint: HK,
    sources: {
      HKO: resolved ? resolvedSource(0.05, 0.04) : sparseSource(0.05, 0.04),
      CMA: resolvedSource(0, 0),
      CWA: resolved ? resolvedSource(-0.05, -0.04) : sparseSource(-0.05, -0.04),
      JMA: { state: 'missing' }
    }
  };
}

const impact = {
  generatedAt: BASE,
  uncertainty: { level: 'moderate', method: 'fixture' },
  closestApproach: {
    distanceRangeKm: { min: 40, max: 900 },
    agencyTimeWindow: { start: time(12), end: time(12), spanHours: 0 },
    consensus: { distanceKm: 700, time: time(24), lat: 28, lon: 120 }
  },
  distanceBands: {}
};

const signalInputs = {
  generatedAt: BASE,
  coverage: { usableAgencyCount: 3 },
  agencies: {},
  featureVector: {
    usableAgencyCount: 3,
    currentDistanceMedianKm: 900,
    currentMaximumWindMedianMs: 35,
    closestMaximumWindMedianMs: 35,
    windRadiusAgencyCount: 0,
    latestWindFieldCoverageAgencyCount: 0,
    closestTimeWindFieldCoverageAgencyCount: 0,
    latestStrongWindFieldCoverageAgencyCount: 0,
    closestTimeStrongWindFieldCoverageAgencyCount: 0,
    latestGaleWindFieldCoverageAgencyCount: 0,
    closestTimeGaleWindFieldCoverageAgencyCount: 0,
    unknownThresholdWindFieldCoverageAgencyCount: 0
  }
};

function run(resolved) {
  const snap = snapshot({ resolved });
  const assessment = threat.buildHkThreatAssessment({ snapshot: snap, impact, signalInputs });
  const forecast = basic.buildBasicHkSignalForecast({
    generatedAt: BASE,
    impact,
    weightedImpact: null,
    signalInputs,
    threatAssessment: assessment
  });
  return { assessment, forecast };
}

const ambiguous = run(false);
const resolved = run(true);
const ambiguous12 = ambiguous.assessment.timeline.find(item => item.label === '+12h');
const resolved12 = resolved.assessment.timeline.find(item => item.label === '+12h');

assert.ok(ambiguous12 && resolved12, 'both variants should expose +12h');
assert.equal(ambiguous12.exactOfficialSupportCount, 1, 'only CMA should directly support the +12h position in sparse variant');
assert.equal(resolved12.exactOfficialSupportCount, 3, 'resolved variant should have three exact +12h positions');
assert.ok(ambiguous12.interpolationReliability < resolved12.interpolationReliability - 0.2,
  `ambiguous chord must carry lower reliability: ambiguous=${ambiguous12.interpolationReliability.toFixed(3)} resolved=${resolved12.interpolationReliability.toFixed(3)}`);

// Two interpolated chords passing close to Hong Kong are a genuine scenario that must
// remain visible, but they are not two independent official confirmations. They must not
// by themselves escalate any warning-signal prediction to "likely".
assert.notEqual(ambiguous.forecast.signals.T1.likelihood, 'likely',
  `interpolated chord majority must not manufacture likely T1; got ${ambiguous.forecast.signals.T1.likelihood}`);
assert.notEqual(ambiguous.forecast.signals.T3.likelihood, 'likely',
  `interpolated chord majority must not manufacture likely T3; got ${ambiguous.forecast.signals.T3.likelihood}`);
assert.notEqual(ambiguous.forecast.signals.T8.likelihood, 'likely',
  `interpolated chord majority must not manufacture likely T8; got ${ambiguous.forecast.signals.T8.likelihood}`);

// Raw physical concern must remain visible even when escalation credibility is reduced.
assert.ok(ambiguous.forecast.signals.T1.riskIndex >= 0.35,
  'interpolated proximity scenario should remain visible as at least possible raw T1 risk');

// Once official intermediate points resolve the curve away from Hong Kong, the threat
// should not increase and confidence should recover.
assert.ok(resolved.forecast.signals.T1.riskIndex <= ambiguous.forecast.signals.T1.riskIndex + 1e-9);
assert.ok(resolved.forecast.signals.T3.riskIndex <= ambiguous.forecast.signals.T3.riskIndex + 1e-9);
assert.ok(resolved.forecast.signals.T8.riskIndex <= ambiguous.forecast.signals.T8.riskIndex + 1e-9);
assert.ok(resolved.assessment.summary.confidenceIndex > ambiguous.assessment.summary.confidenceIndex,
  'official intermediate points should restore confidence after interpolation ambiguity is resolved');

console.log('HK interpolation chord invariants: OK');
