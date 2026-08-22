'use strict';

const assert = require('node:assert/strict');
const basic = require('../analysis/basic-hk-signal-forecast.js');

const BASE = '2026-08-21T12:00:00.000Z';

function threatAssessment() {
  return {
    schemaVersion: 'hk-threat-assessment/v1',
    available: true,
    summary: {
      currentDistanceKm: 720,
      forecastMinimumKm: 680,
      forecastMinimumLeadHours: 36,
      representativeMinimum: {
        distanceKm: 680,
        time: '2026-08-23T00:00:00.000Z',
        source: 'test'
      },
      overallThreatIndex: 0.30,
      confidenceIndex: 0.75
    },
    analyzers: {
      directApproach: { confidence: 0.15 },
      directDepart: { confidence: 0.05 },
      reApproach: { confidence: 0.05 },
      quasiStationary: { confidence: 0.15 },
      forecastEdge: { confidence: 0.1 },
      agencyDisagreement: { confidence: 0.1 },
      interpolationReliability: { confidence: 1 },
      // Threat assessment intentionally retains raw wind-field availability. The
      // signal layer must use freshness-weighted evidence for escalation.
      windField: {
        confidence: 1,
        representativeWindMs: 20,
        dataAgencyCount: 3,
        latestCoverageAgencyCount: 3,
        closestCoverageAgencyCount: 3
      },
      rapidEvolution: { confidence: 0 }
    },
    timeline: [],
    semantics: { hardThreatGateUsed: false }
  };
}

function agency(agencyName, freshness) {
  return {
    agency: agencyName,
    state: 'ok',
    windField: {
      latestEvidence: {
        strongWindCoverage: true,
        galeCoverage: true,
        freshness
      },
      closestTimeEvidence: {
        strongWindCoverage: true,
        galeCoverage: true,
        freshness
      }
    }
  };
}

function signalInputs(freshness) {
  const effectiveCount = 3 * freshness;
  return {
    generatedAt: BASE,
    coverage: { usableAgencyCount: 3 },
    agencies: {
      HKO: agency('HKO', freshness),
      CMA: agency('CMA', freshness),
      CWA: agency('CWA', freshness)
    },
    featureVector: {
      usableAgencyCount: 3,
      currentDistanceMedianKm: 720,
      currentMaximumWindMedianMs: 20,
      closestMaximumWindMedianMs: 20,
      windRadiusAgencyCount: 3,
      latestWindFieldCoverageAgencyCount: 3,
      closestTimeWindFieldCoverageAgencyCount: 3,
      latestStrongWindFieldCoverageAgencyCount: 3,
      closestTimeStrongWindFieldCoverageAgencyCount: 3,
      latestGaleWindFieldCoverageAgencyCount: 3,
      closestTimeGaleWindFieldCoverageAgencyCount: 3,
      latestStrongWindFieldCoverageEffectiveAgencyCount: effectiveCount,
      closestTimeStrongWindFieldCoverageEffectiveAgencyCount: effectiveCount,
      latestGaleWindFieldCoverageEffectiveAgencyCount: effectiveCount,
      closestTimeGaleWindFieldCoverageEffectiveAgencyCount: effectiveCount,
      unknownThresholdWindFieldCoverageAgencyCount: 0,
      latestWindFieldEvidenceAgeMedianHours: freshness >= 0.99 ? 0 : 36,
      closestTimeWindFieldEvidenceAgeMedianHours: freshness >= 0.99 ? 0 : 36
    }
  };
}

const impact = {
  generatedAt: BASE,
  trend: { aggregate: 'steady' },
  uncertainty: { level: 'low' },
  closestApproach: {
    consensus: {
      distanceKm: 680,
      time: '2026-08-23T00:00:00.000Z'
    }
  },
  distanceBands: {}
};

function run(freshness) {
  return basic.buildBasicHkSignalForecast({
    generatedAt: BASE,
    impact,
    weightedImpact: null,
    signalInputs: signalInputs(freshness),
    threatAssessment: threatAssessment()
  });
}

const fresh = run(1);
const stale = run(0.05);

assert.equal(fresh.signals.T3.likelihood, 'likely', 'fresh verified strong-wind coverage should be able to support likely T3');
assert.equal(fresh.signals.T8.likelihood, 'likely', 'fresh verified gale coverage should be able to support likely T8');

assert.notEqual(stale.signals.T3.likelihood, 'likely',
  `stale strong-wind geometry must not indefinitely sustain likely T3; got ${stale.signals.T3.likelihood}`);
assert.notEqual(stale.signals.T8.likelihood, 'likely',
  `stale gale geometry must not indefinitely sustain likely T8; got ${stale.signals.T8.likelihood}`);
assert.ok(stale.signals.T3.riskIndex < fresh.signals.T3.riskIndex,
  'freshness decay should reduce T3 direct wind-field risk');
assert.ok(stale.signals.T8.riskIndex < fresh.signals.T8.riskIndex,
  'freshness decay should reduce T8 direct wind-field risk');

console.log('HK wind-field freshness escalation invariants: OK');
