'use strict';

const assert = require('node:assert/strict');
const basic = require('../analysis/basic-hk-signal-forecast.js');

const BASE = '2026-08-21T12:00:00.000Z';

const impact = {
  generatedAt: BASE,
  trend: { aggregate: 'approaching' },
  uncertainty: { level: 'moderate' },
  closestApproach: {
    consensus: {
      distanceKm: 180,
      time: '2026-08-21T18:00:00.000Z'
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
    currentDistanceMedianKm: 200,
    currentMaximumWindMedianMs: 18,
    closestMaximumWindMedianMs: 18,
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

function assessment(interpolationConfidence) {
  return {
    schemaVersion: 'hk-threat-assessment/v1',
    available: true,
    summary: {
      currentDistanceKm: 200,
      forecastMinimumKm: 180,
      forecastMinimumLeadHours: 6,
      representativeMinimum: {
        distanceKm: 180,
        time: '2026-08-21T18:00:00.000Z',
        source: 'test'
      },
      overallThreatIndex: 0.72,
      confidenceIndex: 0.75
    },
    analyzers: {
      directApproach: { confidence: 0.8 },
      directDepart: { confidence: 0 },
      reApproach: { confidence: 0 },
      quasiStationary: { confidence: 0.05 },
      forecastEdge: { confidence: 0 },
      agencyDisagreement: { confidence: 0.2 },
      interpolationReliability: { confidence: interpolationConfidence },
      windField: {
        confidence: 0,
        representativeWindMs: 18,
        dataAgencyCount: 0,
        latestCoverageAgencyCount: 0,
        closestCoverageAgencyCount: 0
      },
      rapidEvolution: { confidence: 0 }
    },
    timeline: [],
    semantics: {
      hardThreatGateUsed: false,
      interpolationGapAffectsConfidenceNotPhysicalThreat: true
    }
  };
}

function run(interpolationConfidence) {
  return basic.buildBasicHkSignalForecast({
    generatedAt: BASE,
    impact,
    weightedImpact: null,
    signalInputs,
    threatAssessment: assessment(interpolationConfidence)
  });
}

const denseFuture = run(1);
const sparseFuture = run(0.10);

// A genuinely close current analysis is direct evidence. Sparse future track geometry
// may reduce confidence in what happens next, but it must not demote the current T1
// conclusion merely because later checkpoints require interpolation.
assert.equal(denseFuture.signals.T1.likelihood, 'likely',
  'dense future should classify this direct current-proximity case as likely T1');
assert.equal(sparseFuture.signals.T1.likelihood, 'likely',
  `low future interpolation reliability must not erase direct current T1 evidence; got ${sparseFuture.signals.T1.likelihood}`);

// Raw physical risk is intentionally independent of interpolation credibility.
assert.ok(Math.abs(denseFuture.signals.T1.riskIndex - sparseFuture.signals.T1.riskIndex) < 1e-12,
  'current T1 raw risk should remain unchanged when only future interpolation reliability changes');
assert.ok(sparseFuture.semantics.interpolationReliabilityAffectsLikelyEscalationNotRawThreat,
  'semantics should preserve the raw-threat / credible-escalation separation');

console.log('HK current proximity/interpolation independence: OK');
