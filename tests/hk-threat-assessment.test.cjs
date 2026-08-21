'use strict';

const assert = require('node:assert/strict');
const threat = require('../analysis/hk-threat-assessment.js');

const HK = { lat: 22.3023, lon: 114.1746 };
const point = (time, lat, lon, extra = {}) => ({ time, lat, lon, ...extra });

function signalInputs({ windMs = 15, coverage = 0, agencies = 3 } = {}) {
  return {
    generatedAt: '2026-08-21T00:00:00Z',
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
  const snapshot = {
    generatedAt: '2026-08-21T00:00:00Z',
    referencePoint: HK,
    sources: {
      HKO: {
        state: 'ok',
        positions: [point('2026-08-21T00:00:00Z', 20.7, 108.5, { kind: 'analysis' })],
        forecast: [
          point('2026-08-22T00:00:00Z', 20.9, 108.0, { kind: 'forecast' }),
          point('2026-08-23T00:00:00Z', 20.4, 108.1, { kind: 'forecast' }),
          point('2026-08-24T00:00:00Z', 19.8, 108.4, { kind: 'forecast' }),
          point('2026-08-25T00:00:00Z', 20.5, 109.7, { kind: 'forecast' }),
          point('2026-08-26T00:00:00Z', 21.4, 110.2, { kind: 'forecast' })
        ]
      },
      CMA: {
        state: 'ok',
        positions: [point('2026-08-21T00:00:00Z', 20.6, 108.3, { kind: 'analysis' })],
        forecast: [
          point('2026-08-22T00:00:00Z', 20.8, 108.1, { kind: 'forecast' }),
          point('2026-08-23T00:00:00Z', 20.4, 108.3, { kind: 'forecast' }),
          point('2026-08-24T00:00:00Z', 20.5, 109.1, { kind: 'forecast' }),
          point('2026-08-25T00:00:00Z', 21.0, 109.5, { kind: 'forecast' }),
          point('2026-08-26T00:00:00Z', 21.8, 109.4, { kind: 'forecast' })
        ]
      },
      CWA: {
        state: 'ok',
        positions: [point('2026-08-21T00:00:00Z', 20.4, 107.8, { kind: 'analysis' })],
        forecast: [
          point('2026-08-22T00:00:00Z', 21.2, 108.2, { kind: 'forecast' }),
          point('2026-08-23T00:00:00Z', 20.7, 108.1, { kind: 'forecast' }),
          point('2026-08-24T00:00:00Z', 20.4, 108.8, { kind: 'forecast' }),
          point('2026-08-25T00:00:00Z', 21.2, 109.9, { kind: 'forecast' })
        ]
      },
      JMA: { state: 'missing' }
    }
  };
  const impact = {
    generatedAt: snapshot.generatedAt,
    uncertainty: { level: 'high' },
    closestApproach: {
      distanceRangeKm: { min: 420, max: 510 },
      agencyTimeWindow: { spanHours: 28 },
      consensus: { distanceKm: 496, time: '2026-08-25T00:00:00Z' }
    }
  };
  const result = threat.buildHkThreatAssessment({ snapshot, impact, signalInputs: signalInputs() });

  assert.equal(result.available, true);
  assert.equal(result.schemaVersion, 'hk-threat-assessment/v1');
  assert.equal(result.semantics.hardThreatGateUsed, false);
  assert.equal(result.semantics.timeWeightingIsContinuous, true);
  assert.equal(result.semantics.fixedDayBucketsUsed, false);
  assert.equal(result.semantics.timelineUsesOfficialValidTimes, true);
  assert.ok(result.timeline.length >= 5);
  assert.ok(result.timeline.every(item => /^\+\d+(?:\.\d+)?h$/.test(item.label)));
  assert.ok(result.analyzers.reApproach.confidence > 0.05);
  assert.ok(result.analyzers.forecastEdge.confidence > 0.5);
  assert.ok(result.analyzers.agencyDisagreement.confidence > 0.5);
  assert.ok(result.summary.strongestTimelineThreat.leadHours >= 0);
  assert.ok(result.agencies.HKO.minimumWithinForecast.horizonEdgeConfidence > 0.9);
}

{
  const snapshot = {
    generatedAt: '2026-08-21T00:00:00Z',
    referencePoint: HK,
    sources: {
      HKO: {
        state: 'ok',
        positions: [point('2026-08-21T00:00:00Z', 18.0, 130.0, { kind: 'analysis' })],
        forecast: [
          point('2026-08-22T00:00:00Z', 19.0, 124.0, { kind: 'forecast' }),
          point('2026-08-23T00:00:00Z', 20.0, 120.0, { kind: 'forecast' }),
          point('2026-08-24T00:00:00Z', 21.0, 116.0, { kind: 'forecast' }),
          point('2026-08-25T00:00:00Z', 22.0, 114.8, { kind: 'forecast' })
        ]
      },
      CMA: {
        state: 'ok',
        positions: [point('2026-08-21T00:00:00Z', 18.2, 129.5, { kind: 'analysis' })],
        forecast: [
          point('2026-08-22T00:00:00Z', 19.2, 123.8, { kind: 'forecast' }),
          point('2026-08-23T00:00:00Z', 20.1, 119.8, { kind: 'forecast' }),
          point('2026-08-24T00:00:00Z', 21.1, 115.8, { kind: 'forecast' }),
          point('2026-08-25T00:00:00Z', 22.1, 114.6, { kind: 'forecast' })
        ]
      },
      JMA: { state: 'missing' },
      CWA: { state: 'missing' }
    }
  };
  const impact = {
    generatedAt: snapshot.generatedAt,
    uncertainty: { level: 'low' },
    closestApproach: {
      distanceRangeKm: { min: 40, max: 70 },
      agencyTimeWindow: { spanHours: 2 },
      consensus: { distanceKm: 55, time: '2026-08-25T00:00:00Z' }
    }
  };
  const result = threat.buildHkThreatAssessment({ snapshot, impact, signalInputs: signalInputs({ windMs: 35, coverage: 2, agencies: 2 }) });

  assert.equal(result.available, true);
  assert.ok(result.analyzers.directApproach.confidence > 0.5);
  assert.ok(result.analyzers.directApproach.confidence > result.analyzers.reApproach.confidence);
  assert.ok(result.analyzers.agencyDisagreement.confidence < 0.5);
  assert.ok(result.summary.overallThreatIndex > 0.4);
  assert.ok(result.timeline.some(item => item.distanceDeltaFromPreviousKm < 0));
}

{
  const snapshot = {
    generatedAt: '2026-08-21T00:00:00Z',
    referencePoint: HK,
    sources: {
      CMA: {
        state: 'ok',
        positions: [point('2026-08-21T00:00:00Z', 18.0, 125.0, { kind: 'analysis', maximumWind: 15 })],
        forecast: [
          point('2026-08-21T06:00:00Z', 18.8, 123.0, { kind: 'forecast', maximumWind: 16 }),
          point('2026-08-21T12:00:00Z', 19.6, 121.0, { kind: 'forecast', maximumWind: 18 }),
          point('2026-08-21T18:00:00Z', 20.3, 118.8, { kind: 'forecast', maximumWind: 22 }),
          point('2026-08-22T00:00:00Z', 21.0, 116.7, { kind: 'forecast', maximumWind: 27 }),
          point('2026-08-22T06:00:00Z', 21.5, 115.2, { kind: 'forecast', maximumWind: 33 })
        ]
      },
      HKO: {
        state: 'ok',
        positions: [point('2026-08-21T00:00:00Z', 18.1, 125.2, { kind: 'analysis', maximumWind: '55km/h' })],
        forecast: [
          point('2026-08-22T00:00:00Z', 21.1, 116.8, { kind: 'forecast', maximumWind: '95km/h' }),
          point('2026-08-22T12:00:00Z', 21.8, 114.9, { kind: 'forecast', maximumWind: '120km/h' })
        ]
      },
      JMA: { state: 'missing' },
      CWA: { state: 'missing' }
    }
  };
  const impact = {
    generatedAt: snapshot.generatedAt,
    uncertainty: { level: 'moderate' },
    closestApproach: {
      distanceRangeKm: { min: 80, max: 120 },
      agencyTimeWindow: { spanHours: 6 },
      consensus: { distanceKm: 95, time: '2026-08-22T06:00:00Z' }
    }
  };
  const result = threat.buildHkThreatAssessment({ snapshot, impact, signalInputs: signalInputs({ windMs: 33, coverage: 1, agencies: 2 }) });

  assert.equal(result.available, true);
  assert.ok(result.timeline.some(item => item.label === '+6h'));
  assert.ok(result.timeline.some(item => item.label === '+12h'));
  assert.ok(result.timeline.some(item => item.label === '+18h'));
  assert.ok(result.timeline.some(item => item.label === '+30h'));
  assert.ok(result.timeline.some(item => Number.isFinite(item.windDeltaFromPreviousMs) && item.windDeltaFromPreviousMs > 0));
  assert.ok(result.timeline.some(item => Number.isFinite(item.approachRateKmh) && item.approachRateKmh > 20));
  assert.ok(result.analyzers.rapidEvolution.confidence > 0.4);
  assert.ok(result.summary.fastestEvolution.leadHours <= 30);
}

{
  const result = threat.buildHkThreatAssessment({ snapshot: {}, impact: {}, signalInputs: {} });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'reference-point-or-time-unavailable');
}

console.log('hk-threat-assessment tests: OK');
