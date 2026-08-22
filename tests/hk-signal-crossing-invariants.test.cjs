const assert = require('node:assert/strict');
const basic = require('../analysis/basic-hk-signal-forecast.js');

const BASE = '2026-08-21T12:00:00.000Z';
const time = hours => new Date(Date.parse(BASE) + hours * 3600000).toISOString();

function checkpoint(hour, previousHour, stateFn) {
  const state = stateFn(hour);
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

function build({ hours, stateFn, minimumDistanceKm }) {
  const timeline = hours.map((hour, index) => checkpoint(hour, index ? hours[index - 1] : null, stateFn));
  const minimumLeadHours = hours.at(-1);
  const minimumTime = time(minimumLeadHours);
  return basic.buildBasicHkSignalForecast({
    generatedAt: BASE,
    impact: {
      generatedAt: BASE,
      closestApproach: { consensus: { distanceKm: minimumDistanceKm, time: minimumTime } },
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
        currentDistanceMedianKm: 1000,
        currentMaximumWindMedianMs: 15,
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
      schemaVersion: 'signal-crossing-invariants-test/v1',
      available: true,
      summary: {
        currentDistanceKm: 1000,
        forecastMinimumKm: minimumDistanceKm,
        forecastMinimumLeadHours: minimumLeadHours,
        representativeMinimum: { distanceKm: minimumDistanceKm, time: minimumTime, source: 'test' },
        overallThreatIndex: 0.3,
        confidenceIndex: 0.4
      },
      analyzers: {
        directApproach: { confidence: 0.2 },
        directDepart: { confidence: 0.05 },
        reApproach: { confidence: 0.4 },
        quasiStationary: { confidence: 0.1 },
        forecastEdge: { confidence: 1 },
        agencyDisagreement: { confidence: 0.6 },
        windField: { confidence: 0, representativeWindMs: 15 },
        rapidEvolution: { confidence: 0 }
      },
      timeline
    }
  });
}

function centerMs(window) {
  return (Date.parse(window.start) + Date.parse(window.end)) / 2;
}
function widthHours(window) {
  return (Date.parse(window.end) - Date.parse(window.start)) / 3600000;
}

function assertCadenceInvariant(signal, stateFn, minimumDistanceKm) {
  const dense = build({ hours: Array.from({ length: 13 }, (_, index) => 30 + index), stateFn, minimumDistanceKm });
  const sparse = build({ hours: [30, 36, 42], stateFn, minimumDistanceKm });
  const denseSignal = dense.signals[signal];
  const sparseSignal = sparse.signals[signal];
  assert.equal(denseSignal.likelihood, sparseSignal.likelihood, `${signal}: sampling cadence must not change likelihood`);
  assert.notEqual(denseSignal.likelihood, 'unlikely', `${signal}: fixture must exercise an active timing crossing`);
  assert.ok(denseSignal.estimatedWindow && sparseSignal.estimatedWindow, `${signal}: both representations need timing guidance`);
  const centerDeltaHours = Math.abs(centerMs(denseSignal.estimatedWindow) - centerMs(sparseSignal.estimatedWindow)) / 3600000;
  const widthDeltaHours = Math.abs(widthHours(denseSignal.estimatedWindow) - widthHours(sparseSignal.estimatedWindow));
  assert.ok(centerDeltaHours <= 1.5, `${signal}: 1h vs 6h sampling shifted crossing center by ${centerDeltaHours.toFixed(2)}h`);
  assert.ok(widthDeltaHours <= 2, `${signal}: 1h vs 6h sampling changed width by ${widthDeltaHours.toFixed(2)}h`);
}

assertCadenceInvariant(
  'T3',
  hour => ({ distanceKm: 650 - (hour - 30) * 25, windMs: 12 + (hour - 30) * 1.5, approachRateKmh: 25 }),
  350
);

assertCadenceInvariant(
  'T8',
  hour => ({ distanceKm: 450 - (hour - 30) * 22.5, windMs: 20 + (hour - 30) * 1.5, approachRateKmh: 22.5 }),
  180
);

// If the first visible future checkpoint is already above the threshold, there is
// no observed below-to-above crossing to time. Preserve the fail-closed behavior.
{
  const result = build({
    hours: [24, 30],
    stateFn: hour => ({ distanceKm: 600 - (hour - 24) * 5, windMs: 24, approachRateKmh: 5 }),
    minimumDistanceKm: 570
  });
  assert.equal(result.signals.T1.likelihood, 'possible');
  assert.equal(result.signals.T1.estimatedWindow, null, 'first visible point already above threshold must not invent a crossing time');
  assert.equal(result.semantics.firstVisibleAboveThresholdDoesNotInventCrossing, true);
  assert.equal(result.semantics.timingThresholdCrossingsAreInterpolated, true);
}

console.log('HK signal crossing invariants: OK');
