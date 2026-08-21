'use strict';

const assert = require('node:assert/strict');
const basic = require('../analysis/basic-hk-signal-forecast.js');

function signalInputs({ windMs = 30, coverage = 1, agencies = 4, currentDistanceKm = null, sectors = [] } = {}) {
  const agencyNames = ['HKO', 'CMA', 'JMA', 'CWA'];
  return {
    generatedAt: '2026-08-21T12:00:00Z',
    coverage: { usableAgencyCount: agencies },
    agencies: Object.fromEntries(agencyNames.slice(0, sectors.length).map((agency, index) => [agency, {
      state: 'ok',
      current: { sectorFromHongKong: sectors[index] }
    }])),
    featureVector: {
      usableAgencyCount: agencies,
      currentDistanceMedianKm: currentDistanceKm,
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
  assert.equal(result.semantics.nearTermThreatHorizonHours, 72);
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
    signalInputs: signalInputs({ windMs: 15, coverage: 0, currentDistanceKm: 1300 })
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
  const liveLike = basic.buildBasicHkSignalForecast({
    impact: {
      generatedAt: '2026-08-21T10:53:00Z',
      trend: { aggregate: 'approaching' },
      uncertainty: { level: 'high' },
      distanceBands: {
        '800': { entryWindow: { start: '2026-08-21T06:00:00Z' } },
        '500': { entryWindow: { start: '2026-08-24T22:35:00Z' } }
      },
      closestApproach: {
        consensus: { distanceKm: 496, time: '2026-08-25T06:00:00Z' }
      }
    },
    signalInputs: {
      ...signalInputs({ windMs: 15, coverage: 0, agencies: 3, currentDistanceKm: 636, sectors: ['W', 'W', 'W'] }),
      generatedAt: '2026-08-21T10:53:00Z'
    }
  });

  assert.equal(liveLike.impact.likelihood, 'possible');
  assert.equal(liveLike.impact.nearTermThreat, false);
  assert.equal(liveLike.signals.T1.likelihood, 'unlikely');
  assert.equal(liveLike.signals.T3.likelihood, 'unlikely');
  assert.equal(liveLike.signals.T8.likelihood, 'unlikely');
  assert.equal(liveLike.signals.T1.estimatedWindow, null);
}

{
  const result = basic.buildBasicHkSignalForecast({ impact: {}, weightedImpact: {}, signalInputs: {} });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'no-hong-kong-proximity-forecast');
}

console.log('basic-hk-signal-forecast tests: OK');
