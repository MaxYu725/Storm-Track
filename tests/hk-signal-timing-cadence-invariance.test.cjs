const assert = require('node:assert/strict');
const basic = require('../analysis/basic-hk-signal-forecast.js');

const BASE = '2026-08-21T12:00:00.000Z';
const time = hours => new Date(Date.parse(BASE) + hours * 3600000).toISOString();

function physicalState(hour) {
  // One continuous physical scenario. It starts clearly below the T1 timeline
  // threshold and crosses it later; only sampling density is varied.
  const distanceKm = 900 - (hour - 30) * 25;
  const windMs = 12 + (hour - 30) * 0.5;
  return { distanceKm, windMs, approachRateKmh: 25 };
}

function checkpoint(hour, previousHour) {
  const state = physicalState(hour);
  return {
    label: `+${hour}h`,
    validTime: time(hour),
    leadHours: hour,
    timeRelevance: 1 / (1 + hour / 72),
    intervalFromPreviousHours: previousHour == null ? null : hour - previousHour,
    distanceMedianKm: state.distanceKm,
    windMedianMs: state.windMs,
    approachRateKmh: state.approachRateKmh,
    rapidEvolutionIndex: 0,
    agencies: ['HKO', 'CMA', 'CWA'].map(agency => ({
      agency,
      distanceKm: state.distanceKm,
      maximumWindMs: state.windMs,
      approachRateKmh: state.approachRateKmh,
      rapidEvolutionIndex: 0
    }))
  };
}

function timeline(hours) {
  return hours.map((hour, index) => checkpoint(hour, index ? hours[index - 1] : null));
}

function run(hours) {
  const checkpoints = timeline(hours);
  return basic.buildBasicHkSignalForecast({
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
        currentDistanceMedianKm: 820,
        currentMaximumWindMedianMs: 16,
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
      schemaVersion: 'timing-cadence-invariance-test/v1',
      available: true,
      summary: {
        currentDistanceKm: 820,
        forecastMinimumKm: 480,
        forecastMinimumLeadHours: 96,
        representativeMinimum: { distanceKm: 480, time: time(96), source: 'forecast-edge-test' },
        overallThreatIndex: 0.35,
        confidenceIndex: 0.35
      },
      analyzers: {
        directApproach: { confidence: 0.2 },
        directDepart: { confidence: 0.05 },
        reApproach: { confidence: 0.6 },
        quasiStationary: { confidence: 0.2 },
        forecastEdge: { confidence: 1 },
        agencyDisagreement: { confidence: 0.65 },
        windField: { confidence: 0, representativeWindMs: 15 },
        rapidEvolution: { confidence: 0 }
      },
      timeline: checkpoints
    }
  });
}

const dense = run(Array.from({ length: 13 }, (_, index) => 30 + index));
const sparse = run([30, 36, 42]);

console.log('CADENCE_DIAGNOSTIC', JSON.stringify({
  dense: {
    likelihood: dense.signals.T1.likelihood,
    riskIndex: dense.signals.T1.riskIndex,
    window: dense.signals.T1.estimatedWindow,
    strongest: dense.signals.T1.strongestCheckpoint,
    persistenceHours: dense.signals.T1.persistenceHours
  },
  sparse: {
    likelihood: sparse.signals.T1.likelihood,
    riskIndex: sparse.signals.T1.riskIndex,
    window: sparse.signals.T1.estimatedWindow,
    strongest: sparse.signals.T1.strongestCheckpoint,
    persistenceHours: sparse.signals.T1.persistenceHours
  }
}));

assert.equal(dense.signals.T1.likelihood, sparse.signals.T1.likelihood, 'sampling cadence must not change T1 likelihood');
assert.equal(dense.signals.T1.likelihood, 'possible');
assert.ok(dense.signals.T1.estimatedWindow && sparse.signals.T1.estimatedWindow, 'both representations should produce broad timing guidance');

function centerMs(window) {
  return (Date.parse(window.start) + Date.parse(window.end)) / 2;
}
function widthHours(window) {
  return (Date.parse(window.end) - Date.parse(window.start)) / 3600000;
}

const centerDeltaHours = Math.abs(centerMs(dense.signals.T1.estimatedWindow) - centerMs(sparse.signals.T1.estimatedWindow)) / 3600000;
const widthDeltaHours = Math.abs(widthHours(dense.signals.T1.estimatedWindow) - widthHours(sparse.signals.T1.estimatedWindow));

assert.ok(centerDeltaHours <= 1.5, `same physical trajectory must not shift timing materially with 1h vs 6h sampling; got ${centerDeltaHours.toFixed(2)}h`);
assert.ok(widthDeltaHours <= 2, `same physical trajectory must not change timing width materially with 1h vs 6h sampling; got ${widthDeltaHours.toFixed(2)}h`);
assert.ok(widthHours(dense.signals.T1.estimatedWindow) >= 12);
assert.ok(widthHours(sparse.signals.T1.estimatedWindow) >= 12);

console.log('HK signal timing cadence invariance: OK');
