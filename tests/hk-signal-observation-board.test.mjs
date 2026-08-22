import assert from 'node:assert/strict';
import { deriveObservationBoard, SCHEMA_VERSION } from '../scripts/build-hk-signal-observation-board.mjs';

function signal(likelihood, riskIndex, confidenceIndex, window = null, persistenceHours = 0) {
  return { likelihood, riskIndex, confidenceIndex, persistenceHours, estimatedWindow: window };
}

function observation(key, displayName, agencies, t1, feature = {}) {
  return {
    group: { key, displayName },
    sourceAgencies: agencies,
    sources: Object.fromEntries(agencies.map((agency, index) => [agency, {
      agency,
      sourceId: `${agency}-${index + 1}`,
      bulletinTime: '2026-08-22T04:00:00Z',
      current: { time: '2026-08-22T04:00:00Z', lat: 20 + index, lon: 120 + index, maximumWind: 15 + index, intensity: 'TS' },
      forecastEnd: { time: '2026-08-24T04:00:00Z', lat: 21 + index, lon: 119 + index, maximumWind: 13 + index, intensity: 'TD' }
    }])),
    analysis: {
      impact: {
        closestApproach: { consensus: { distanceKm: feature.consensusClosestDistanceKm ?? 700 } },
        trend: {
          aggregate: feature.trend || 'approaching',
          agencies: Object.fromEntries(agencies.map(agency => [agency, {
            state: 'approaching', deltaKm: -30, horizonHours: 6, startDistanceKm: 900, endDistanceKm: 870
          }]))
        },
        uncertainty: { level: feature.uncertaintyLevel || 'medium', reasons: ['synthetic'] }
      },
      signalInputs: {
        disagreement: {
          comparisonSpreadKm: feature.comparisonSpreadKm ?? 100,
          closestDistanceSpanKm: feature.closestDistanceSpanKm ?? 120,
          closestTimeSpreadHours: feature.closestTimeSpreadHours ?? 8
        },
        featureVector: {
          usableAgencyCount: agencies.length,
          comparisonSpreadKm: feature.comparisonSpreadKm ?? 100,
          consensusClosestDistanceKm: feature.consensusClosestDistanceKm ?? 700,
          consensusClosestLeadHours: feature.consensusClosestLeadHours ?? 30,
          closestDistanceMinKm: 640,
          closestDistanceMaxKm: 760,
          closestDistanceSpanKm: feature.closestDistanceSpanKm ?? 120,
          closestTimeSpreadHours: feature.closestTimeSpreadHours ?? 8,
          currentDistanceMedianKm: 850,
          derivedMotionSpeedMedianKmh: 12,
          currentMaximumWindMedianMs: 17,
          closestMaximumWindMedianMs: 16,
          windRadiusAgencyCount: 1
        }
      },
      basicForecast: {
        signals: {
          T1: t1,
          T3: signal('unlikely', 0.2, 0.4),
          T8: signal('unlikely', 0.1, 0.3)
        }
      }
    }
  };
}

function record(capturedAt, fingerprint, observations) {
  return { schemaVersion: 'beta-prospective-recorder/v2', capturedAt, captureFingerprint: fingerprint, observations };
}

const dirty = record('2026-08-22T04:52:33Z', 'dirty', [
  observation('GAENARI', '簡拉維 (GAENARI)', ['HKO', 'JMA', 'CWA'], signal('unlikely', 0.25, 0.35)),
  observation('热带低压', '热带低压 (nameless)', ['CMA'], signal('possible', 0.4, 0.2, { start: '2026-08-23T00:00:00Z', end: '2026-08-23T18:00:00Z' }, 3))
]);
const clean1 = record('2026-08-22T05:36:43Z', 'clean1', [
  observation('GAENARI', '簡拉維 (GAENARI)', ['CMA', 'CWA', 'HKO', 'JMA'], signal('possible', 0.36, 0.41, { start: '2026-08-23T02:00:00Z', end: '2026-08-23T16:00:00Z' }, 5), { comparisonSpreadKm: 90, consensusClosestDistanceKm: 720, consensusClosestLeadHours: 28 })
]);
const clean2 = record('2026-08-22T06:36:43Z', 'clean2', [
  observation('GAENARI', '簡拉維 (GAENARI)', ['CMA', 'CWA', 'HKO', 'JMA'], signal('possible', 0.42, 0.46, { start: '2026-08-23T03:00:00Z', end: '2026-08-23T14:00:00Z' }, 8), { comparisonSpreadKm: 70, consensusClosestDistanceKm: 680, consensusClosestLeadHours: 25 })
]);
const narra = record('2026-08-22T06:36:43Z', 'narra', [
  observation('NARRA', '紫檀 (NARRA)', ['CMA', 'CWA', 'HKO', 'JMA'], signal('possible', 0.5, 0.38, { start: '2026-08-24T00:00:00Z', end: '2026-08-24T12:00:00Z' }, 20), { comparisonSpreadKm: 150, consensusClosestDistanceKm: 430, consensusClosestLeadHours: 40 })
]);

const caseIndex = [
  { capturedAt: dirty.capturedAt, captureFingerprint: 'dirty', rawGroupKey: 'GAENARI', caseId: 'STC-2026-JMA-TC2623' },
  { capturedAt: dirty.capturedAt, captureFingerprint: 'dirty', rawGroupKey: '热带低压', caseId: 'STC-2026-JMA-TC2623' },
  { capturedAt: clean1.capturedAt, captureFingerprint: 'clean1', rawGroupKey: 'GAENARI', caseId: 'STC-2026-JMA-TC2623' },
  { capturedAt: clean2.capturedAt, captureFingerprint: 'clean2', rawGroupKey: 'GAENARI', caseId: 'STC-2026-JMA-TC2623' },
  { capturedAt: narra.capturedAt, captureFingerprint: 'narra', rawGroupKey: 'NARRA', caseId: 'STC-2026-JMA-TC2622' }
];

const board = deriveObservationBoard({
  records: [dirty, clean1, clean2, narra],
  caseIndex,
  generatedAt: '2026-08-22T07:00:00Z',
  sourceCommit: 'test'
});

assert.equal(board.schemaVersion, SCHEMA_VERSION);
assert.equal(board.semantics.mode, 'observation-only');
assert.equal(board.semantics.scoring, false);
assert.equal(board.semantics.calibration, false);
assert.equal(board.prospective.excludedAmbiguousCaseCaptureCount, 1);
assert.deepEqual(board.prospective.excludedAmbiguousCaseCaptures[0].rawGroupKeys, ['GAENARI', '热带低压']);
assert.equal(board.summary.activeStormCount, 2);
assert.equal(board.summary.t1WindowStormCount, 2);

const gaenari = board.storms.find(storm => storm.caseId === 'STC-2026-JMA-TC2623');
assert.ok(gaenari);
assert.equal(gaenari.timeline.length, 2, 'dirty split capture must not enter observation timeline');
assert.equal(gaenari.latest.signals.T1.riskIndex, 0.42);
assert.equal(gaenari.latest.signals.T1.windowWidthHours, 11);
assert.equal(gaenari.latest.deltas.t1RiskIndex, 0.06);
assert.equal(gaenari.latest.deltas.t1WindowStartHours, 1);
assert.equal(gaenari.latest.deltas.t1WindowEndHours, -2);
assert.equal(gaenari.latest.deltas.comparisonSpreadKm, -20);
assert.equal(gaenari.latest.agencies.length, 4);
assert.equal(gaenari.latest.agencies[0].trend.state, 'approaching');
assert.equal(Object.hasOwn(gaenari.latest, 'grades'), false, 'observation board must not contain scoring grades');

const narraStorm = board.storms.find(storm => storm.caseId === 'STC-2026-JMA-TC2622');
assert.ok(narraStorm.hasT1Window);
assert.match(board.boardFingerprint, /^[0-9a-f]{64}$/);

console.log('hk signal observation board tests: OK');
