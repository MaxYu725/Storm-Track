'use strict';

const assert = require('node:assert/strict');
const threat = require('../analysis/hk-threat-assessment.js');
const basic = require('../analysis/basic-hk-signal-forecast.js');

const BASE = '2026-08-21T00:00:00.000Z';
const HK = { lat: 22.3023, lon: 114.1746 };
const time = hours => new Date(Date.parse(BASE) + hours * 3600000).toISOString();

function point(hour, lat, lon, wind = 35, kind = 'forecast') {
  return { time: time(hour), lat, lon, maximumWind: wind, kind };
}

// HKO has a real +12h point directly over/near Hong Kong, while CMA/CWA only have
// sparse endpoints that remain safely east of Hong Kong. This is intentionally the
// inverse of the interpolation-chord test: exact minority danger must not disappear
// merely because two low-information scenarios look benign.
const snapshot = {
  generatedAt: BASE,
  referencePoint: HK,
  sources: {
    HKO: {
      state: 'ok',
      positions: [point(0, 22.3, 120.0, 35, 'analysis')],
      forecast: [
        point(12, 22.3023, 114.1746, 35),
        point(24, 22.3, 120.0, 35)
      ]
    },
    CMA: {
      state: 'ok',
      positions: [point(0, 22.1, 120.0, 35, 'analysis')],
      forecast: [point(24, 22.1, 122.0, 35)]
    },
    CWA: {
      state: 'ok',
      positions: [point(0, 22.5, 120.0, 35, 'analysis')],
      forecast: [point(24, 22.5, 122.0, 35)]
    },
    JMA: { state: 'missing' }
  }
};

const impact = {
  generatedAt: BASE,
  trend: { aggregate: 'uncertain' },
  uncertainty: { level: 'high', method: 'fixture' },
  closestApproach: {
    distanceRangeKm: { min: 0, max: 900 },
    agencyTimeWindow: { start: time(12), end: time(24), spanHours: 12 },
    // Consensus deliberately stays benign: the minority agency scenario must be
    // preserved separately rather than smuggled in through the consensus minimum.
    consensus: { distanceKm: 720, time: time(24), lat: 22.3, lon: 121.0 }
  },
  distanceBands: {}
};

const signalInputs = {
  generatedAt: BASE,
  coverage: { usableAgencyCount: 3 },
  agencies: {},
  featureVector: {
    usableAgencyCount: 3,
    currentDistanceMedianKm: 600,
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

const assessment = threat.buildHkThreatAssessment({ snapshot, impact, signalInputs });
const forecast = basic.buildBasicHkSignalForecast({
  generatedAt: BASE,
  impact,
  weightedImpact: null,
  signalInputs,
  threatAssessment: assessment
});

const plus12 = assessment.timeline.find(item => item.label === '+12h');
assert.ok(plus12, 'fixture should expose +12h checkpoint');
assert.equal(plus12.exactOfficialSupportCount, 1,
  'only HKO should have an exact official +12h point');
assert.ok(plus12.interpolationReliability < 0.8,
  'two sparse benign agencies should make checkpoint interpolation reliability visibly imperfect');

// The exact minority scenario is severe enough to remain visible. Reliability weighting
// should prevent interpolated benign majority from erasing it entirely.
assert.notEqual(forecast.signals.T1.likelihood, 'unlikely',
  `exact minority T1 threat must remain visible; got ${forecast.signals.T1.likelihood}`);
assert.notEqual(forecast.signals.T3.likelihood, 'unlikely',
  `exact minority T3 threat must remain visible; got ${forecast.signals.T3.likelihood}`);
assert.notEqual(forecast.signals.T8.likelihood, 'unlikely',
  `exact minority T8 threat must remain visible; got ${forecast.signals.T8.likelihood}`);

// One exact dangerous agency is important evidence, but absent corroborating direct
// wind-field data it should not automatically manufacture a high-confidence majority.
assert.notEqual(forecast.signals.T3.likelihood, 'likely',
  `one exact minority track alone should not manufacture likely T3; got ${forecast.signals.T3.likelihood}`);
assert.notEqual(forecast.signals.T8.likelihood, 'likely',
  `one exact minority track alone should not manufacture likely T8; got ${forecast.signals.T8.likelihood}`);

assert.equal(forecast.semantics.minorityAgencyThreatScenarioPreserved, true,
  'forecast semantics should explicitly preserve minority agency threat scenarios');

console.log('HK minority exact threat preservation: OK');
