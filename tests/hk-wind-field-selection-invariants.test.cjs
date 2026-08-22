'use strict';

const assert = require('node:assert/strict');
const inputs = require('../analysis/hko-signal-risk-inputs.js');

const BASE = '2026-08-21T12:00:00.000Z';
const time = hours => new Date(Date.parse(BASE) + hours * 3600000).toISOString();
const radii = [{ level: '34kt', ne: 120, se: 120, sw: 120, nw: 120 }];

const snapshot = {
  schemaVersion: 'test-snapshot/v1',
  generatedAt: BASE,
  referencePoint: { name: 'Hong Kong', lat: 22.3023, lon: 114.1746 },
  comparison: { referenceBaseTime: BASE, spread: { distanceKm: 0 } },
  coverage: { usableAgencies: ['CWA'], usableAgencyCount: 1 },
  sources: {
    HKO: { state: 'missing' },
    CMA: { state: 'missing' },
    JMA: { state: 'missing' },
    CWA: { state: 'ok', baseTime: BASE }
  }
};

const sourceGroup = {
  sources: {
    CWA: {
      positions: [{
        kind: 'analysis',
        time: BASE,
        lat: 21.0,
        lon: 108.5,
        maximumWind: 15,
        windRadii: []
      }],
      forecast: [
        {
          kind: 'forecast',
          time: time(6),
          lat: 21.0,
          lon: 108.6,
          maximumWind: 18,
          windRadii: radii
        },
        {
          kind: 'forecast',
          time: time(72),
          lat: 21.5,
          lon: 110.0,
          maximumWind: 15,
          windRadii: radii
        }
      ]
    }
  }
};

const impact = {
  schemaVersion: 'test-impact/v1',
  generatedAt: BASE,
  agencyClosestApproaches: [{
    agency: 'CWA',
    time: time(72),
    distanceKm: 450,
    lat: 21.5,
    lon: 110.0
  }],
  closestApproach: {
    consensus: { time: time(72), distanceKm: 450, lat: 21.5, lon: 110.0 },
    distanceRangeKm: { min: 450, max: 450 },
    agencyTimeWindow: { start: time(72), end: time(72), spanHours: 0 }
  },
  trend: { aggregate: 'approaching', counts: { approaching: 1, departing: 0, steady: 0, unavailable: 0 } },
  uncertainty: { level: 'low', method: 'test' }
};

const result = inputs.buildHkoSignalRiskInputs(snapshot, impact, sourceGroup, {});
const evidence = result.agencies.CWA.windField.latestEvidence;

assert.ok(evidence, 'nearest future wind-field evidence should be available when current analysis has no radii');
assert.equal(evidence.time, time(6), 'current/latest wind-field fallback must choose the nearest future radius point, not the farthest forecast radius');
assert.ok(evidence.targetOffsetHours <= 6.01, `nearest future radius should be about +6h, got ${evidence.targetOffsetHours}h`);
assert.ok(evidence.freshness > 0.5, `+6h evidence should retain meaningful freshness, got ${evidence.freshness}`);
assert.equal(result.agencies.CWA.windField.closestTimeEvidence.time, time(72), 'closest-approach evidence remains independently anchored to closest time');

console.log('HK wind-field selection invariants: OK');
