'use strict';

const assert = require('node:assert/strict');
const threat = require('../analysis/hk-threat-assessment.js');

const BASE = '2026-08-21T00:00:00.000Z';
const HK = { lat: 22.3023, lon: 114.1746 };
const time = hours => new Date(Date.parse(BASE) + hours * 3600000).toISOString();

const states = new Map([
  [0,  { lat: 19.0, lon: 122.000, wind: 18 }],
  [6,  { lat: 19.8, lon: 120.175, wind: 21 }],
  [12, { lat: 20.6, lon: 118.350, wind: 24 }],
  [18, { lat: 21.4, lon: 116.525, wind: 27 }],
  [24, { lat: 22.2, lon: 114.700, wind: 30 }],
  [30, { lat: 22.5, lon: 116.000, wind: 28 }]
]);

function source(hours, offsetLat = 0, offsetLon = 0) {
  const points = hours.map(hour => {
    const state = states.get(hour);
    return {
      time: time(hour),
      lat: state.lat + offsetLat,
      lon: state.lon + offsetLon,
      maximumWind: state.wind,
      kind: hour === 0 ? 'analysis' : 'forecast'
    };
  });
  return { state: 'ok', positions: [points[0]], forecast: points.slice(1) };
}

function snapshot({ sparse }) {
  const denseHours = [0, 6, 12, 18, 24, 30];
  const sparseHours = [0, 24, 30];
  return {
    generatedAt: BASE,
    referencePoint: HK,
    sources: {
      HKO: source(sparse ? sparseHours : denseHours, 0.04, 0.03),
      CMA: source(denseHours, 0, 0),
      CWA: source(sparse ? sparseHours : denseHours, -0.04, -0.03),
      JMA: { state: 'missing' }
    }
  };
}

const impact = {
  generatedAt: BASE,
  uncertainty: { level: 'low', method: 'fixture' },
  closestApproach: {
    distanceRangeKm: { min: 45, max: 65 },
    agencyTimeWindow: { start: time(24), end: time(24), spanHours: 0 },
    consensus: { distanceKm: 55, time: time(24), lat: 22.2, lon: 114.7 }
  }
};

const signalInputs = {
  generatedAt: BASE,
  coverage: { usableAgencyCount: 3 },
  featureVector: {
    usableAgencyCount: 3,
    currentMaximumWindMedianMs: 18,
    closestMaximumWindMedianMs: 30,
    closestTimeWindFieldCoverageAgencyCount: 0
  }
};

const dense = threat.buildHkThreatAssessment({ snapshot: snapshot({ sparse: false }), impact, signalInputs });
const sparse = threat.buildHkThreatAssessment({ snapshot: snapshot({ sparse: true }), impact, signalInputs });

assert.equal(dense.available, true);
assert.equal(sparse.available, true);

// Same physical geometry: interpolation uncertainty should not erase the threat itself.
assert.ok(Math.abs(dense.summary.overallThreatIndex - sparse.summary.overallThreatIndex) <= 0.08,
  `same physical path changed threat too much: dense=${dense.summary.overallThreatIndex.toFixed(3)} sparse=${sparse.summary.overallThreatIndex.toFixed(3)}`);

const dense12 = dense.timeline.find(item => item.label === '+12h');
const sparse12 = sparse.timeline.find(item => item.label === '+12h');
assert.ok(dense12 && sparse12, 'both representations should expose +12h checkpoint');
const sparseHko12 = sparse12.agencies.find(item => item.agency === 'HKO');
const denseHko12 = dense12.agencies.find(item => item.agency === 'HKO');
assert.equal(denseHko12.exactOfficialTime, true);
assert.equal(sparseHko12.exactOfficialTime, false);
assert.equal(sparseHko12.interpolationSpanHours, 24, 'interpolated evidence should remember the official-point gap that created it');
assert.ok(sparseHko12.interpolationReliability < 0.7, `24h interpolation should have lower reliability; got ${sparseHko12.interpolationReliability}`);
assert.equal(denseHko12.interpolationReliability, 1);

// Confidence, not physical threat, should carry the penalty for sparse interpolation.
assert.ok(sparse.summary.confidenceIndex < dense.summary.confidenceIndex - 0.02,
  `sparse long-gap interpolation should reduce confidence: dense=${dense.summary.confidenceIndex.toFixed(3)} sparse=${sparse.summary.confidenceIndex.toFixed(3)}`);
assert.ok(sparse.analyzers.interpolationReliability.confidence < dense.analyzers.interpolationReliability.confidence,
  'interpolation reliability analyzer should distinguish sparse from exact support');

console.log('HK interpolation reliability invariants: OK');
