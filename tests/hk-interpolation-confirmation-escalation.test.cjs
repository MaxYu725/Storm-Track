'use strict';

const assert = require('node:assert/strict');
const threat = require('../analysis/hk-threat-assessment.js');
const basic = require('../analysis/basic-hk-signal-forecast.js');

const BASE = '2026-08-21T00:00:00.000Z';
const HK = { lat: 22.3023, lon: 114.1746 };
const time = hours => new Date(Date.parse(BASE) + hours * 3600000).toISOString();

function stateAt(hour, latOffset = 0, lonOffset = 0) {
  const ratio = hour / 24;
  return {
    lat: 16 + (28 - 16) * ratio + latOffset,
    lon: 108 + (120 - 108) * ratio + lonOffset,
    wind: 35
  };
}

function point(hour, state, kind = 'forecast') {
  return {
    time: time(hour),
    lat: state.lat,
    lon: state.lon,
    maximumWind: state.wind,
    kind
  };
}

function source({ confirmed, latOffset = 0, lonOffset = 0 }) {
  const current = stateAt(0, latOffset, lonOffset);
  const forecastHours = confirmed ? [6, 12, 18, 24] : [24];
  return {
    state: 'ok',
    positions: [point(0, current, 'analysis')],
    forecast: forecastHours.map(hour => point(hour, stateAt(hour, latOffset, lonOffset)))
  };
}

function snapshot(confirmed) {
  return {
    generatedAt: BASE,
    referencePoint: HK,
    sources: {
      // Stage 1: CMA already publishes an official +12h point while HKO/CWA still
      // require interpolation across a sparse 24h chord. Stage 2: all three agencies
      // publish intermediate points confirming the same dangerous geometry.
      HKO: source({ confirmed, latOffset: 0.04, lonOffset: 0.03 }),
      CMA: source({ confirmed: true, latOffset: 0, lonOffset: 0 }),
      CWA: source({ confirmed, latOffset: -0.04, lonOffset: -0.03 }),
      JMA: { state: 'missing' }
    }
  };
}

const impact = {
  generatedAt: BASE,
  trend: { aggregate: 'approaching' },
  uncertainty: { level: 'moderate', method: 'fixture' },
  closestApproach: {
    distanceRangeKm: { min: 10, max: 30 },
    agencyTimeWindow: { start: time(12), end: time(12), spanHours: 0 },
    consensus: {
      distanceKm: 20,
      time: time(12),
      lat: 22,
      lon: 114
    }
  },
  distanceBands: {}
};

const signalInputs = {
  generatedAt: BASE,
  coverage: { usableAgencyCount: 3 },
  agencies: {},
  featureVector: {
    usableAgencyCount: 3,
    currentDistanceMedianKm: 950,
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

function run(confirmed) {
  const assessment = threat.buildHkThreatAssessment({
    snapshot: snapshot(confirmed),
    impact,
    signalInputs
  });
  const forecast = basic.buildBasicHkSignalForecast({
    generatedAt: BASE,
    impact,
    weightedImpact: null,
    signalInputs,
    threatAssessment: assessment
  });
  return { assessment, forecast };
}

const sparse = run(false);
const confirmed = run(true);

const sparse12 = sparse.assessment.timeline.find(item => item.label === '+12h');
const confirmed12 = confirmed.assessment.timeline.find(item => item.label === '+12h');
assert.ok(sparse12 && confirmed12, 'both variants should expose +12h through CMA official timing');
assert.equal(sparse12.exactOfficialSupportCount, 1,
  'stage-one +12h should have one exact official point and two interpolated agency positions');
assert.equal(confirmed12.exactOfficialSupportCount, 3,
  'confirmed variant should have three exact official +12h positions');
assert.ok(confirmed12.interpolationReliability > sparse12.interpolationReliability + 0.2,
  `official confirmation should materially restore reliability: sparse=${sparse12.interpolationReliability.toFixed(3)} confirmed=${confirmed12.interpolationReliability.toFixed(3)}`);

// T1 may escalate earlier because one agency already directly confirms the close pass.
// Higher warning levels should preserve the danger as possible without treating two
// sparse interpolated trajectories as equivalent to additional official confirmations.
assert.notEqual(sparse.forecast.signals.T1.likelihood, 'unlikely',
  'partly confirmed dangerous scenario should remain visible for T1');
assert.notEqual(sparse.forecast.signals.T3.likelihood, 'unlikely',
  'partly confirmed dangerous scenario should remain visible at least as possible T3');
assert.notEqual(sparse.forecast.signals.T8.likelihood, 'unlikely',
  'partly confirmed dangerous scenario should remain visible at least as possible T8');
assert.notEqual(sparse.forecast.signals.T3.likelihood, 'likely',
  `partly interpolated route should not prematurely become likely T3; got ${sparse.forecast.signals.T3.likelihood}`);
assert.notEqual(sparse.forecast.signals.T8.likelihood, 'likely',
  `partly interpolated route should not prematurely become likely T8; got ${sparse.forecast.signals.T8.likelihood}`);

// Once all three agencies publish intermediate points confirming the same dangerous
// geometry, the interpolation penalty must lift. T8 may use reliable confirmed peak
// evidence as well as persistence, so a short but extreme close pass is not suppressed.
assert.equal(confirmed.forecast.signals.T1.likelihood, 'likely',
  `confirmed direct route should support likely T1; got ${confirmed.forecast.signals.T1.likelihood}`);
assert.equal(confirmed.forecast.signals.T3.likelihood, 'likely',
  `confirmed direct route should support likely T3; got ${confirmed.forecast.signals.T3.likelihood}`);
assert.equal(confirmed.forecast.signals.T8.likelihood, 'likely',
  `confirmed direct route should support likely T8; got ${confirmed.forecast.signals.T8.likelihood}`);
assert.ok(confirmed.assessment.summary.confidenceIndex > sparse.assessment.summary.confidenceIndex,
  'official intermediate confirmation should restore assessment confidence');

console.log('HK interpolation confirmation escalation: OK');
