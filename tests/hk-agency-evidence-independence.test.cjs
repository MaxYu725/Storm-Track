const assert = require('node:assert/strict');
const basic = require('../analysis/basic-hk-signal-forecast.js');

const BASE = '2026-08-21T12:00:00.000Z';
const FUTURE = '2026-08-22T12:00:00.000Z';

function buildForecast({ distanceKm, windMs, currentDistanceKm = 1000 }) {
  const threatAssessment = {
    schemaVersion: 'agency-independence-test/v1',
    available: true,
    summary: {
      currentDistanceKm,
      forecastMinimumKm: distanceKm,
      forecastMinimumLeadHours: 24,
      representativeMinimum: { distanceKm, time: FUTURE, source: 'test-consensus' },
      overallThreatIndex: 0.25,
      confidenceIndex: 0.75
    },
    analyzers: {
      directApproach: { confidence: 0.2 },
      directDepart: { confidence: 0.1 },
      reApproach: { confidence: 0.2 },
      quasiStationary: { confidence: 0 },
      forecastEdge: { confidence: 0 },
      agencyDisagreement: { confidence: 0.2 },
      windField: { confidence: 0, representativeWindMs: windMs },
      rapidEvolution: { confidence: 0 }
    },
    timeline: [
      {
        label: '+0h', validTime: BASE, leadHours: 0, timeRelevance: 1,
        distanceMedianKm: currentDistanceKm, windMedianMs: 15,
        rapidEvolutionIndex: 0, approachRateKmh: 0,
        agencies: [
          { agency: 'HKO', distanceKm: currentDistanceKm, maximumWindMs: 15, approachRateKmh: 0, rapidEvolutionIndex: 0 },
          { agency: 'CMA', distanceKm: currentDistanceKm, maximumWindMs: 15, approachRateKmh: 0, rapidEvolutionIndex: 0 },
          { agency: 'CWA', distanceKm: currentDistanceKm, maximumWindMs: 15, approachRateKmh: 0, rapidEvolutionIndex: 0 }
        ]
      },
      {
        label: '+24h', validTime: FUTURE, leadHours: 24, timeRelevance: 0.75,
        distanceMedianKm: distanceKm, windMedianMs: windMs,
        rapidEvolutionIndex: 0, approachRateKmh: 4,
        agencies: [
          { agency: 'HKO', distanceKm, maximumWindMs: null, approachRateKmh: null, rapidEvolutionIndex: 0 },
          { agency: 'CMA', distanceKm, maximumWindMs: windMs, approachRateKmh: 4, rapidEvolutionIndex: 0 },
          { agency: 'CWA', distanceKm, maximumWindMs: windMs, approachRateKmh: 4, rapidEvolutionIndex: 0 }
        ]
      }
    ]
  };

  return basic.buildBasicHkSignalForecast({
    generatedAt: BASE,
    impact: {
      generatedAt: BASE,
      closestApproach: { consensus: { distanceKm, time: FUTURE } },
      uncertainty: { level: 'moderate' },
      distanceBands: {}
    },
    weightedImpact: null,
    signalInputs: {
      generatedAt: BASE,
      coverage: { usableAgencyCount: 3 },
      agencies: {},
      featureVector: {
        usableAgencyCount: 3,
        currentDistanceMedianKm: currentDistanceKm,
        currentMaximumWindMedianMs: 15,
        closestMaximumWindMedianMs: windMs,
        windRadiusAgencyCount: 0,
        latestWindFieldCoverageAgencyCount: 0,
        closestTimeWindFieldCoverageAgencyCount: 0,
        latestStrongWindFieldCoverageAgencyCount: 0,
        closestTimeStrongWindFieldCoverageAgencyCount: 0,
        latestGaleWindFieldCoverageAgencyCount: 0,
        closestTimeGaleWindFieldCoverageAgencyCount: 0,
        unknownThresholdWindFieldCoverageAgencyCount: 0
      }
    },
    threatAssessment
  });
}

const t1 = buildForecast({ distanceKm: 650, windMs: 25 });
assert.equal(t1.signals.T1.strongestCheckpoint.supportAgencyCount, 2, 'T1 must not borrow CMA/CWA wind/motion for HKO');

const t3 = buildForecast({ distanceKm: 400, windMs: 25 });
assert.equal(t3.signals.T3.strongestCheckpoint.supportAgencyCount, 2, 'T3 must not borrow CMA/CWA wind for HKO');

const t8 = buildForecast({ distanceKm: 250, windMs: 30 });
assert.equal(t8.signals.T8.strongestCheckpoint.supportAgencyCount, 2, 'T8 must not borrow CMA/CWA wind for HKO');

assert.equal(t1.semantics.perAgencyEvidenceUsesOnlyAgencyData, true);
console.log('HK agency evidence independence: OK');
