'use strict';

const assert = require('node:assert/strict');
const boardApi = require('../analysis/consensus-track-observation-board.js');

function sample(leadHours, validTime, lat, lon, agencyCount = 3, spreadKm = 100, interpolatedAgencyCount = 0) {
  return {
    leadHours,
    validTime,
    agencyCount,
    agencies: ['HKO', 'CMA', 'JMA'].slice(0, agencyCount),
    interpolatedAgencyCount,
    consensusLat: lat,
    consensusLon: lon,
    spreadKm
  };
}

function group(key, displayName, referenceBaseTime, samples, supportedThroughHours = 120) {
  return {
    key,
    displayName,
    sourceAgencies: ['HKO', 'CMA', 'JMA'],
    referenceBaseTime,
    referenceMethod: 'latest-analysis-valid-time',
    configuredHorizonHours: 120,
    stepHours: 6,
    consensusPointCount: samples.filter(item => item.consensusLat != null && item.consensusLon != null).length,
    supportedThroughHours,
    continuousConsensusThroughHours: supportedThroughHours,
    samples
  };
}

function record(schemaVersion, capturedAt, captureFingerprint, groups) {
  return { schemaVersion, capturedAt, captureFingerprint, groups };
}

const first = record('storm-consensus-track-prospective/v1', '2026-08-23T06:00:00Z', 'first', [
  group('GAENARI', '簡拉維 (GAENARI)', '2026-08-23T06:00:00Z', [
    sample(24, '2026-08-24T06:00:00Z', 20.0, 130.0, 3, 110, 1),
    sample(48, '2026-08-25T06:00:00Z', 21.0, 129.0, 2, 150, 0),
    sample(72, '2026-08-26T06:00:00Z', 22.0, 128.0, 2, 180, 1),
    sample(96, '2026-08-27T06:00:00Z', 23.0, 127.0, 2, 200, 0),
    sample(120, '2026-08-28T06:00:00Z', 24.0, 126.0, 2, 220, 0)
  ])
]);

const second = record('storm-consensus-track-prospective/v2', '2026-08-23T12:00:00Z', 'second', [
  group('GAENARI', '簡拉維 (GAENARI)', '2026-08-23T12:00:00Z', [
    sample(18, '2026-08-24T06:00:00Z', 20.2, 129.8, 3, 90, 1),
    sample(24, '2026-08-24T12:00:00Z', 20.5, 129.5, 3, 95, 1),
    sample(42, '2026-08-25T06:00:00Z', 21.1, 128.9, 2, 140, 0),
    sample(66, '2026-08-26T06:00:00Z', 22.2, 127.8, 2, 170, 1),
    sample(90, '2026-08-27T06:00:00Z', 23.3, 126.7, 2, 195, 0),
    sample(114, '2026-08-28T06:00:00Z', 24.4, 125.6, 2, 210, 0),
    sample(120, '2026-08-28T12:00:00Z', 24.7, 125.2, 2, 215, 0)
  ])
]);

const narra = record('storm-consensus-track-prospective/v2', '2026-08-23T12:00:00Z', 'narra', [
  group('NARRA', '紫檀 (NARRA)', '2026-08-23T12:00:00Z', [
    sample(24, '2026-08-24T12:00:00Z', 18.0, 110.0, 4, 70, 0),
    sample(48, '2026-08-25T12:00:00Z', 19.0, 109.5, 4, 85, 0),
    sample(72, '2026-08-26T12:00:00Z', 20.0, 109.0, 3, 100, 1)
  ], 72)
]);

const dirty = record('storm-consensus-track-prospective/v2', '2026-08-23T13:00:00Z', 'dirty', [
  group('GAENARI', '簡拉維 (GAENARI)', '2026-08-23T12:00:00Z', [sample(24, '2026-08-24T12:00:00Z', 20.5, 129.5)], 24),
  group('GENERIC', '熱帶低氣壓', '2026-08-23T12:00:00Z', [sample(24, '2026-08-24T12:00:00Z', 20.6, 129.6)], 24)
]);

const caseIndex = [
  { capturedAt: first.capturedAt, captureFingerprint: 'first', rawGroupKey: 'GAENARI', caseId: 'STC-2026-GAENARI-TEST' },
  { capturedAt: second.capturedAt, captureFingerprint: 'second', rawGroupKey: 'GAENARI', caseId: 'STC-2026-GAENARI-TEST' },
  { capturedAt: narra.capturedAt, captureFingerprint: 'narra', rawGroupKey: 'NARRA', caseId: 'STC-2026-NARRA-TEST' },
  { capturedAt: dirty.capturedAt, captureFingerprint: 'dirty', rawGroupKey: 'GAENARI', caseId: 'STC-2026-GAENARI-TEST' },
  { capturedAt: dirty.capturedAt, captureFingerprint: 'dirty', rawGroupKey: 'GENERIC', caseId: 'STC-2026-GAENARI-TEST' }
];

const board = boardApi.deriveObservationBoard({ records: [first, second, narra, dirty], caseIndex });
assert.equal(board.schemaVersion, boardApi.VERSION);
assert.equal(board.semantics.mode, 'observation-only');
assert.equal(board.semantics.scoring, false);
assert.equal(board.semantics.calibration, false);
assert.equal(board.semantics.probability, false);
assert.equal(board.semantics.verificationTruthRead, false);
assert.equal(board.semantics.modelMutation, false);
assert.equal(board.semantics.movementComparison, 'exact-common-valid-times-only');
assert.equal(board.prospective.excludedAmbiguousCaseCaptureCount, 1);
assert.deepEqual(board.prospective.excludedAmbiguousCaseCaptures[0].rawGroupKeys, ['GAENARI', 'GENERIC']);
assert.equal(board.summary.activeStormCount, 2);
assert.equal(board.summary.full120hStormCount, 1);
assert.deepEqual(board.summary.targetLeads, [24, 48, 72, 96, 120]);

const gaenari = board.storms.find(storm => storm.caseId === 'STC-2026-GAENARI-TEST');
assert.ok(gaenari);
assert.equal(gaenari.timeline.length, 2, 'ambiguous same-case capture must be excluded');
assert.equal(gaenari.latest.schemaVersion, 'storm-consensus-track-prospective/v2');
assert.equal(gaenari.latest.leadSamples['24'].validTime, '2026-08-24T12:00:00.000Z');
assert.equal(gaenari.latest.leadSamples['24'].agencyCount, 3);
assert.equal(gaenari.latest.leadSamples['24'].spreadKm, 95);
assert.equal(gaenari.latest.leadSamples['48'], null, 'missing exact target lead remains unavailable');
assert.equal(gaenari.latest.leadSamples['120'].hasConsensus, true);
assert.equal(gaenari.latest.movement.referenceShiftHours, 6);
assert.equal(gaenari.latest.movement.matchedValidTimeCount, 5, 'movement compares only exact common valid times');
assert.ok(gaenari.latest.movement.meanKm > 0);
assert.ok(gaenari.latest.movement.maxKm >= gaenari.latest.movement.meanKm);
assert.equal(gaenari.latest.movement.maxValidTime, '2026-08-28T06:00:00.000Z');

const narraStorm = board.storms.find(storm => storm.caseId === 'STC-2026-NARRA-TEST');
assert.ok(narraStorm);
assert.equal(narraStorm.has120hConsensus, false);
assert.equal(narraStorm.latest.continuousConsensusThroughHours, 72);
assert.equal(narraStorm.latest.leadSamples['96'], null);
assert.equal(narraStorm.latest.movement, null);

assert.equal(boardApi.observationPath('2026-08-23T07:46:08.509Z', 'c4bb45427f365236abcdef'), 'observations/2026/08/23/20260823T074608Z-c4bb45427f36.json');

console.log('consensus track observation board tests: OK');
