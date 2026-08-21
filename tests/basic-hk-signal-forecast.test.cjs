'use strict';

const assert = require('node:assert/strict');
const basic = require('../analysis/basic-hk-signal-forecast.js');

function signalInputs({ windMs = 30, coverage = 1, agencies = 4 } = {}) {
  return {
    generatedAt: '2026-08-21T12:00:00Z',
    coverage: { usableAgencyCount: agencies },
    featureVector: {
      usableAgencyCount: agencies,
      closestMaximumWindMedianMs: windMs,
      currentMaximumWindMedianMs: windMs,
      closestTimeWindFieldCoverageAgencyCount: coverage
    }
  };
}

{
  const impact = {
    generatedAt: '2026-08-21T12:00:00Z',
    trend: { aggregate: 'approaching' },
    uncertainty: { level: 'moderate' },
    distanceBands: {}
  };
  const weightedImpact = {
    available: true,
    closestApproach: { distanceKm: 180, time: '2026-08-23T03:00:00Z' },
    distanceBands: {
      '800': { firstEntryTime: '2026-08-22T00:00:00Z' },
      '500': { firstEntryTime: '2026-08-22T12:00:00Z' },
      '300': { firstEntryTime: '2026-08-22T20:00:00Z' }
    }
  };

  const result = basic.buildBasicHkSignalForecast({ impact, weightedImpact, signalInputs: signalInputs() });
  assert.equal(result.schemaVersion, 'basic-hk-signal-forecast/v1');
  assert.equal(result.available, true);
  assert.equal(result.impact.expected, true);
  assert.equal(result.impact.likelihood, 'likely');
  assert.equal(result.signals.T1.likelihood, 'likely');
  assert.equal(result.signals.T3.likelihood, 'likely');
  assert.equal(result.signals.T8.likelihood, 'likely');
  assert.deepEqual(result.signals.T1.estimatedWindow, {
    start: '2026-08-21T18:00:00.000Z',
    end: '2026-08-22T06:00:00.000Z'
  });
  assert.deepEqual(result.signals.T3.estimatedWindow, {
    start: '2026-08-22T06:00:00.000Z',
    end: '2026-08-22T21:00:00.000Z'
  });
  assert.equal(result.semantics.historicalCalibrationRequired, false);
  assert.equal(result.semantics.probabilityOutputIncluded, false);
  assert.equal(result.semantics.officialHkoForecast, false);
}

{
  const result = basic.buildBasicHkSignalForecast({
    impact: {
      generatedAt: '2026-08-21T12:00:00Z',
      trend: { aggregate: 'departing' },
      uncertainty: { level: 'low' },
      distanceBands: {}
    },
    weightedImpact: {
      available: true,
      closestApproach: { distanceKm: 1300, time: '2026-08-23T03:00:00Z' },
      distanceBands: {}
    },
    signalInputs: signalInputs({ windMs: 15, coverage: 0 })
  });

  assert.equal(result.available, true);
  assert.equal(result.impact.expected, false);
  assert.equal(result.impact.likelihood, 'unlikely');
  assert.equal(result.signals.T1.likelihood, 'unlikely');
  assert.equal(result.signals.T3.likelihood, 'unlikely');
  assert.equal(result.signals.T8.likelihood, 'unlikely');
  assert.equal(result.signals.T1.estimatedWindow, null);
  assert.equal(result.signals.T8.estimatedWindow, null);
}

{
  const result = basic.buildBasicHkSignalForecast({ impact: {}, weightedImpact: {}, signalInputs: {} });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'no-hong-kong-proximity-forecast');
}

console.log('basic-hk-signal-forecast tests: OK');
