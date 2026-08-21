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
  assert.ok(result.timeline.length >= 5);
  assert.ok(result.analyzers.reApproach.confidence > 0.05);
  assert.ok(result.analyzers.forecastEdge.confidence > 0.5);
  assert.ok(result.analyzers.agencyDisagreement.confidence > 0.5);
  assert.equal(result.summary.strongestTimelineThreat.label, 'D1');
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
  const result = threat.buildHkThreatAssessment({ snapshot: {}, impact: {}, signalInputs: {} });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'reference-point-or-time-unavailable');
}

console.log('hk-threat-assessment tests: OK');
