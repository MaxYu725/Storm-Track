'use strict';

const assert = require('node:assert/strict');
const threat = require('../analysis/hk-threat-assessment.js');
const basic = require('../analysis/basic-hk-signal-forecast.js');

const BASE = '2026-08-21T00:00:00.000Z';
const HK = { lat: 22.3023, lon: 114.1746 };
const time = hours => new Date(Date.parse(BASE) + hours * 3600000).toISOString();
const likelihoodRank = { unlikely: 0, possible: 1, likely: 2 };

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

function snapshot(confirmationLevel) {
  return {
    generatedAt: BASE,
    referencePoint: HK,
    sources: {
      // CMA confirms the intermediate trajectory first, HKO second, CWA third.
      // Geometry is identical at every level: only the amount of direct official
      // support changes, so raw physical threat should remain invariant.
      HKO: source({ confirmed: confirmationLevel >= 2, latOffset: 0.04, lonOffset: 0.03 }),
      CMA: source({ confirmed: true, latOffset: 0, lonOffset: 0 }),
      CWA: source({ confirmed: confirmationLevel >= 3, latOffset: -0.04, lonOffset: -0.03 }),
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

function run(confirmationLevel) {
  const assessment = threat.buildHkThreatAssessment({
    snapshot: snapshot(confirmationLevel),
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

const stage1 = run(1);
const stage2 = run(2);
const stage3 = run(3);

const stage1Point = stage1.assessment.timeline.find(item => item.label === '+12h');
const stage2Point = stage2.assessment.timeline.find(item => item.label === '+12h');
const stage3Point = stage3.assessment.timeline.find(item => item.label === '+12h');
assert.ok(stage1Point && stage2Point && stage3Point,
  'all confirmation levels should expose +12h through the common official timing');
assert.equal(stage1Point.exactOfficialSupportCount, 1,
  'stage one should have one exact official +12h point');
assert.equal(stage2Point.exactOfficialSupportCount, 2,
  'stage two should have two exact official +12h points');
assert.equal(stage3Point.exactOfficialSupportCount, 3,
  'stage three should have three exact official +12h points');
assert.ok(stage1Point.interpolationReliability < stage2Point.interpolationReliability,
  'second official confirmation should increase checkpoint reliability');
assert.ok(stage2Point.interpolationReliability < stage3Point.interpolationReliability,
  'third official confirmation should further increase checkpoint reliability');

// Interpolation reliability is confidence metadata, not physical storm evidence.
// Adding official intermediate points that lie on the same trajectory must not alter
// the raw T3/T8 risk magnitude.
assert.ok(Math.abs(stage1.forecast.signals.T3.riskIndex - stage2.forecast.signals.T3.riskIndex) < 1e-9);
assert.ok(Math.abs(stage2.forecast.signals.T3.riskIndex - stage3.forecast.signals.T3.riskIndex) < 1e-9);
assert.ok(Math.abs(stage1.forecast.signals.T8.riskIndex - stage2.forecast.signals.T8.riskIndex) < 1e-9);
assert.ok(Math.abs(stage2.forecast.signals.T8.riskIndex - stage3.forecast.signals.T8.riskIndex) < 1e-9);

assert.ok(stage1.assessment.summary.confidenceIndex < stage2.assessment.summary.confidenceIndex,
  'confidence should rise after the second official confirmation');
assert.ok(stage2.assessment.summary.confidenceIndex < stage3.assessment.summary.confidenceIndex,
  'confidence should rise again after the third official confirmation');

// Stage one already contains one direct official close-pass confirmation, so T1 may
// legitimately escalate early. Higher signal states must preserve the threat without
// treating sparse interpolated trajectories as equivalent to direct confirmation.
assert.notEqual(stage1.forecast.signals.T1.likelihood, 'unlikely');
assert.notEqual(stage1.forecast.signals.T3.likelihood, 'unlikely');
assert.notEqual(stage1.forecast.signals.T8.likelihood, 'unlikely');
assert.notEqual(stage1.forecast.signals.T3.likelihood, 'likely',
  `one-confirmation route should not prematurely become likely T3; got ${stage1.forecast.signals.T3.likelihood}`);
assert.notEqual(stage1.forecast.signals.T8.likelihood, 'likely',
  `one-confirmation route should not prematurely become likely T8; got ${stage1.forecast.signals.T8.likelihood}`);

// Reliability is continuous rather than a hidden N-agency gate. More direct official
// confirmation must never reduce the warning likelihood for otherwise identical data.
for (const signal of ['T1', 'T3', 'T8']) {
  assert.ok(
    likelihoodRank[stage2.forecast.signals[signal].likelihood] >= likelihoodRank[stage1.forecast.signals[signal].likelihood],
    `${signal} likelihood must not fall from stage 1 to stage 2`
  );
  assert.ok(
    likelihoodRank[stage3.forecast.signals[signal].likelihood] >= likelihoodRank[stage2.forecast.signals[signal].likelihood],
    `${signal} likelihood must not fall from stage 2 to stage 3`
  );
}

// Once all three agencies publish intermediate points confirming the same dangerous
// geometry, the interpolation penalty must lift. T8 may use reliable confirmed peak
// evidence as well as persistence, so a short but extreme close pass is not suppressed.
assert.equal(stage3.forecast.signals.T1.likelihood, 'likely',
  `fully confirmed direct route should support likely T1; got ${stage3.forecast.signals.T1.likelihood}`);
assert.equal(stage3.forecast.signals.T3.likelihood, 'likely',
  `fully confirmed direct route should support likely T3; got ${stage3.forecast.signals.T3.likelihood}`);
assert.equal(stage3.forecast.signals.T8.likelihood, 'likely',
  `fully confirmed direct route should support likely T8; got ${stage3.forecast.signals.T8.likelihood}`);

console.log('HK interpolation confirmation escalation: OK');
