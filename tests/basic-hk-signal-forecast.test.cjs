'use strict';

const assert = require('node:assert/strict');
const basic = require('../analysis/basic-hk-signal-forecast.js');

function signalInputs({ windMs = 30, coverage = 1, agencies = 4, currentDistanceKm = null, strongCoverage = 0, galeCoverage = 0, windRadiusAgencies = 0 } = {}) {
  return {
    generatedAt: '2026-08-21T12:00:00Z',
    coverage: { usableAgencyCount: agencies },
    featureVector: {
      usableAgencyCount: agencies,
      currentDistanceMedianKm: currentDistanceKm,
      closestMaximumWindMedianMs: windMs,
      currentMaximumWindMedianMs: windMs,
      closestTimeWindFieldCoverageAgencyCount: coverage,
      windRadiusAgencyCount: windRadiusAgencies,
      latestStrongWindFieldCoverageAgencyCount: strongCoverage,
      closestTimeStrongWindFieldCoverageAgencyCount: strongCoverage,
      latestGaleWindFieldCoverageAgencyCount: galeCoverage,
      closestTimeGaleWindFieldCoverageAgencyCount: galeCoverage,
      unknownThresholdWindFieldCoverageAgencyCount: 0
    }
  };
}

function assessment({
  currentDistanceKm,
  minimumDistanceKm,
  minimumLeadHours,
  minimumTime,
  direct = 0,
  reApproach = 0,
  quasi = 0,
  edge = 0,
  disagreement = 0.3,
  windField = 0,
  windMs = 15,
  overallThreatIndex = null,
  confidenceIndex = 0.7,
  timeline = []
}) {
  return {
    schemaVersion: 'hk-threat-assessment/v1',
    available: true,
    summary: {
      currentDistanceKm,
      forecastMinimumKm: minimumDistanceKm,
      forecastMinimumLeadHours: minimumLeadHours,
      representativeMinimum: { distanceKm: minimumDistanceKm, time: minimumTime, source: 'test' },
      overallThreatIndex,
      confidenceIndex
    },
    analyzers: {
      directApproach: { confidence: direct },
      directDepart: { confidence: 0 },
      reApproach: { confidence: reApproach },
      quasiStationary: { confidence: quasi },
      forecastEdge: { confidence: edge },
      agencyDisagreement: { confidence: disagreement },
      windField: { confidence: windField, representativeWindMs: windMs, coverageAgencyCount: 1 }
    },
    timeline,
    semantics: { hardThreatGateUsed: false, timeWeightingIsContinuous: true }
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
    closestApproach: { distanceKm: 100, time: '2026-08-22T12:00:00Z' },
    distanceBands: {
      '800': { firstEntryTime: '2026-08-21T15:00:00Z' },
      '500': { firstEntryTime: '2026-08-21T22:00:00Z' },
      '300': { firstEntryTime: '2026-08-22T04:00:00Z' }
    }
  };
  const threatAssessment = assessment({
    currentDistanceKm: 300,
    minimumDistanceKm: 100,
    minimumLeadHours: 24,
    minimumTime: '2026-08-22T12:00:00Z',
    direct: 0.95,
    reApproach: 0.05,
    edge: 0.2,
    disagreement: 0.15,
    windField: 0.9,
    windMs: 40,
    overallThreatIndex: 0.85,
    confidenceIndex: 0.85,
    timeline: [
      { label: '+0h', validTime: '2026-08-21T12:00:00Z', leadHours: 0, timeRelevance: 1, distanceMedianKm: 300, windMedianMs: 40, agencies: [
        { agency: 'HKO', distanceKm: 300, maximumWindMs: 40, rapidEvolutionIndex: 0 },
        { agency: 'CMA', distanceKm: 300, maximumWindMs: 40, rapidEvolutionIndex: 0 },
        { agency: 'CWA', distanceKm: 300, maximumWindMs: 40, rapidEvolutionIndex: 0 }
      ] },
      { label: '+6h', validTime: '2026-08-21T18:00:00Z', leadHours: 6, timeRelevance: 0.92, distanceMedianKm: 220, windMedianMs: 40, agencies: [
        { agency: 'HKO', distanceKm: 220, maximumWindMs: 40, approachRateKmh: 13, rapidEvolutionIndex: 0.4 },
        { agency: 'CMA', distanceKm: 220, maximumWindMs: 40, approachRateKmh: 13, rapidEvolutionIndex: 0.4 },
        { agency: 'CWA', distanceKm: 220, maximumWindMs: 40, approachRateKmh: 13, rapidEvolutionIndex: 0.4 }
      ] },
      { label: '+12h', validTime: '2026-08-22T00:00:00Z', leadHours: 12, timeRelevance: 0.86, distanceMedianKm: 150, windMedianMs: 40, agencies: [
        { agency: 'HKO', distanceKm: 150, maximumWindMs: 40, approachRateKmh: 12, rapidEvolutionIndex: 0.35 },
        { agency: 'CMA', distanceKm: 150, maximumWindMs: 40, approachRateKmh: 12, rapidEvolutionIndex: 0.35 },
        { agency: 'CWA', distanceKm: 150, maximumWindMs: 40, approachRateKmh: 12, rapidEvolutionIndex: 0.35 }
      ] },
      { label: '+18h', validTime: '2026-08-22T06:00:00Z', leadHours: 18, timeRelevance: 0.80, distanceMedianKm: 110, windMedianMs: 40, agencies: [
        { agency: 'HKO', distanceKm: 110, maximumWindMs: 40, approachRateKmh: 7, rapidEvolutionIndex: 0.2 },
        { agency: 'CMA', distanceKm: 110, maximumWindMs: 40, approachRateKmh: 7, rapidEvolutionIndex: 0.2 },
        { agency: 'CWA', distanceKm: 110, maximumWindMs: 40, approachRateKmh: 7, rapidEvolutionIndex: 0.2 }
      ] }
    ]
  });

  const result = basic.buildBasicHkSignalForecast({
    impact,
    weightedImpact,
    signalInputs: signalInputs({ windMs: 40, coverage: 3, agencies: 3, currentDistanceKm: 300, strongCoverage: 3, galeCoverage: 3, windRadiusAgencies: 3 }),
    threatAssessment
  });
  assert.equal(result.schemaVersion, 'basic-hk-signal-forecast/v1');
  assert.equal(result.available, true);
  assert.equal(result.impact.expected, true);
  assert.equal(result.impact.likelihood, 'likely');
  assert.equal(result.signals.T1.likelihood, 'likely');
  assert.equal(result.signals.T3.likelihood, 'likely');
  assert.equal(result.signals.T8.likelihood, 'likely');
  assert.ok(result.signals.T1.riskIndex > 0.7);
  assert.ok(result.signals.T8.riskIndex > 0.7);
  assert.equal(result.semantics.hardThreatGateUsed, false);
  assert.equal(result.semantics.timeWeightingIsContinuous, true);
  assert.equal(result.semantics.softTimeScaleHours, 72);
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
      ...signalInputs({ windMs: 15, coverage: 0, agencies: 3, currentDistanceKm: 636 }),
      generatedAt: '2026-08-21T10:53:00Z'
    },
    threatAssessment: assessment({
      currentDistanceKm: 636,
      minimumDistanceKm: 496,
      minimumLeadHours: 91.1,
      minimumTime: '2026-08-25T06:00:00Z',
      direct: 0.2,
      reApproach: 0.5,
      quasi: 0.4,
      edge: 0.8,
      disagreement: 0.8,
      windField: 0.15,
      windMs: 15,
      overallThreatIndex: 0.42,
      confidenceIndex: 0.36
    })
  });

  assert.equal(liveLike.impact.likelihood, 'possible');
  assert.equal(liveLike.impact.forecastMinimumMayBeHorizonLimited, true);
  assert.equal(liveLike.signals.T1.likelihood, 'possible');
  assert.equal(liveLike.signals.T3.likelihood, 'unlikely');
  assert.equal(liveLike.signals.T8.likelihood, 'unlikely');
  assert.ok(liveLike.signals.T1.riskIndex > 0.35 && liveLike.signals.T1.riskIndex < 0.58);
  assert.ok(liveLike.signals.T1.basis.some(item => item.startsWith('forecast-edge:')));
}

{
  const result = basic.buildBasicHkSignalForecast({ impact: {}, weightedImpact: {}, signalInputs: {} });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'no-hong-kong-proximity-forecast');
}

console.log('basic-hk-signal-forecast tests: OK');
