'use strict';

const assert = require('node:assert/strict');
const basic = require('../analysis/basic-hk-signal-forecast.js');

const BASE = '2026-08-21T12:00:00.000Z';

function threatAssessment(interpolationConfidence) {
  return {
    schemaVersion: 'hk-threat-assessment/v1',
    available: true,
    summary: {
      currentDistanceKm: 700,
      forecastMinimumKm: 650,
      forecastMinimumLeadHours: 36,
      representativeMinimum: {
        distanceKm: 650,
        time: '2026-08-23T00:00:00.000Z',
        source: 'test'
      },
      overallThreatIndex: 0.35,
      confidenceIndex: 0.45
    },
    analyzers: {
      directApproach: { confidence: 0.2 },
      directDepart: { confidence: 0.1 },
      reApproach: { confidence: 0.1 },
      quasiStationary: { confidence: 0.2 },
      forecastEdge: { confidence: 0.2 },
      agencyDisagreement: { confidence: 0.3 },
      interpolationReliability: { confidence: interpolationConfidence },
      windField: {
        confidence: 1,
        representativeWindMs: 30,
        dataAgencyCount: 3,
        latestCoverageAgencyCount: 3,
        closestCoverageAgencyCount: 3,
        latestStrongWindCoverageAgencyCount: 3,
        closestStrongWindCoverageAgencyCount: 3,
        latestGaleCoverageAgencyCount: 3,
        closestGaleCoverageAgencyCount: 3,
        strongWindCoverageFraction: 1,
        galeCoverageFraction: 1
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

function agencyWindField(agency) {
  return {
    agency,
    state: 'ok',
    windField: {
      latestEvidence: {
        strongWindCoverage: true,
        galeCoverage: true,
        freshness: 1
      },
      closestTimeEvidence: {
        strongWindCoverage: true,
        galeCoverage: true,
        freshness: 1
      }
    }
  };
}

const signalInputs = {
  generatedAt: BASE,
  coverage: { usableAgencyCount: 3 },
  agencies: {
    HKO: agencyWindField('HKO'),
    CMA: agencyWindField('CMA'),
    CWA: agencyWindField('CWA')
  },
  featureVector: {
    usableAgencyCount: 3,
    currentDistanceMedianKm: 700,
    currentMaximumWindMedianMs: 30,
    closestMaximumWindMedianMs: 30,
    windRadiusAgencyCount: 3,
    latestWindFieldCoverageAgencyCount: 3,
    closestTimeWindFieldCoverageAgencyCount: 3,
    latestStrongWindFieldCoverageAgencyCount: 3,
    closestTimeStrongWindFieldCoverageAgencyCount: 3,
    latestGaleWindFieldCoverageAgencyCount: 3,
    closestTimeGaleWindFieldCoverageAgencyCount: 3,
    latestStrongWindFieldCoverageEffectiveAgencyCount: 3,
    closestTimeStrongWindFieldCoverageEffectiveAgencyCount: 3,
    latestGaleWindFieldCoverageEffectiveAgencyCount: 3,
    closestTimeGaleWindFieldCoverageEffectiveAgencyCount: 3,
    unknownThresholdWindFieldCoverageAgencyCount: 0,
    latestWindFieldEvidenceAgeMedianHours: 0,
    closestTimeWindFieldEvidenceAgeMedianHours: 0
  }
};

const impact = {
  generatedAt: BASE,
  trend: { aggregate: 'steady' },
  uncertainty: { level: 'moderate' },
  closestApproach: {
    consensus: {
      distanceKm: 650,
      time: '2026-08-23T00:00:00.000Z'
    }
  },
  distanceBands: {}
};

function run(interpolationConfidence) {
  return basic.buildBasicHkSignalForecast({
    generatedAt: BASE,
    impact,
    weightedImpact: null,
    signalInputs,
    threatAssessment: threatAssessment(interpolationConfidence)
  });
}

const exactTrack = run(1);
const sparseTrack = run(0.15);

// Direct, fresh, signal-specific wind-field intersection is independent physical
// evidence. Low confidence in the centre-track interpolation must not erase it.
assert.equal(exactTrack.signals.T3.likelihood, 'likely');
assert.equal(exactTrack.signals.T8.likelihood, 'likely');
assert.equal(sparseTrack.signals.T3.likelihood, 'likely',
  `verified strong-wind coverage must survive low track interpolation confidence; got ${sparseTrack.signals.T3.likelihood}`);
assert.equal(sparseTrack.signals.T8.likelihood, 'likely',
  `verified gale coverage must survive low track interpolation confidence; got ${sparseTrack.signals.T8.likelihood}`);

// The raw/direct wind-field channel itself should not change merely because the track
// interpolation confidence changes.
assert.ok(Math.abs(sparseTrack.signals.T3.riskIndex - exactTrack.signals.T3.riskIndex) < 1e-12,
  'T3 direct wind-field risk should be interpolation-independent in this fixture');
assert.ok(Math.abs(sparseTrack.signals.T8.riskIndex - exactTrack.signals.T8.riskIndex) < 1e-12,
  'T8 direct wind-field risk should be interpolation-independent in this fixture');
assert.ok(sparseTrack.semantics.interpolationReliabilityAffectsLikelyEscalationNotRawThreat,
  'forecast semantics should explicitly separate interpolation reliability from raw threat');

console.log('HK wind-field/interpolation independence: OK');
