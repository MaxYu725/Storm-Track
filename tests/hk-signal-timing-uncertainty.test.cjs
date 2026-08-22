const assert = require('node:assert/strict');
const basic = require('../analysis/basic-hk-signal-forecast.js');

const BASE = '2026-08-21T12:00:00.000Z';
const time = hours => new Date(Date.parse(BASE) + hours * 3600000).toISOString();

function agencyPoint(agency, distanceKm, windMs, approachRateKmh) {
  return { agency, distanceKm, maximumWindMs: windMs, approachRateKmh, rapidEvolutionIndex: 0 };
}

const timeline = [
  {
    label: '+34h', validTime: time(34), leadHours: 34, timeRelevance: 1 / (1 + 34 / 72),
    intervalFromPreviousHours: 1, distanceMedianKm: 700, windMedianMs: 15, approachRateKmh: 1,
    rapidEvolutionIndex: 0,
    agencies: ['HKO', 'CMA', 'CWA'].map(agency => agencyPoint(agency, 700, 15, 1))
  },
  {
    label: '+35h', validTime: time(35), leadHours: 35, timeRelevance: 1 / (1 + 35 / 72),
    intervalFromPreviousHours: 1, distanceMedianKm: 600, windMedianMs: 22, approachRateKmh: 3,
    rapidEvolutionIndex: 0,
    agencies: ['HKO', 'CMA', 'CWA'].map(agency => agencyPoint(agency, 600, 22, 3))
  },
  {
    label: '+36h', validTime: time(36), leadHours: 36, timeRelevance: 1 / (1 + 36 / 72),
    intervalFromPreviousHours: 1, distanceMedianKm: 590, windMedianMs: 22, approachRateKmh: 3,
    rapidEvolutionIndex: 0,
    agencies: ['HKO', 'CMA', 'CWA'].map(agency => agencyPoint(agency, 590, 22, 3))
  }
];

const result = basic.buildBasicHkSignalForecast({
  generatedAt: BASE,
  impact: {
    generatedAt: BASE,
    closestApproach: { consensus: { distanceKm: 480, time: time(96) } },
    uncertainty: { level: 'high' },
    distanceBands: {}
  },
  weightedImpact: null,
  signalInputs: {
    generatedAt: BASE,
    coverage: { usableAgencyCount: 3 },
    agencies: {},
    featureVector: {
      usableAgencyCount: 3,
      currentDistanceMedianKm: 800,
      currentMaximumWindMedianMs: 18,
      closestMaximumWindMedianMs: 15,
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
  threatAssessment: {
    schemaVersion: 'timing-uncertainty-test/v1',
    available: true,
    summary: {
      currentDistanceKm: 800,
      forecastMinimumKm: 480,
      forecastMinimumLeadHours: 96,
      representativeMinimum: { distanceKm: 480, time: time(96), source: 'forecast-edge-test' },
      overallThreatIndex: 0.35,
      confidenceIndex: 0.3
    },
    analyzers: {
      directApproach: { confidence: 0.15 },
      directDepart: { confidence: 0.1 },
      reApproach: { confidence: 0.6 },
      quasiStationary: { confidence: 0.4 },
      forecastEdge: { confidence: 1 },
      agencyDisagreement: { confidence: 0.8 },
      windField: { confidence: 0, representativeWindMs: 15 },
      rapidEvolution: { confidence: 0 }
    },
    timeline
  }
});

assert.equal(result.signals.T1.likelihood, 'possible');
assert.ok(result.signals.T1.estimatedWindow, 'T1 possible should retain a broad guidance window');
const widthHours = (Date.parse(result.signals.T1.estimatedWindow.end) - Date.parse(result.signals.T1.estimatedWindow.start)) / 3600000;
assert.ok(widthHours >= 12, `high-uncertainty forecast-edge timing window must not collapse to interpolation cadence; got ${widthHours}h`);

console.log('HK signal timing uncertainty: OK');
