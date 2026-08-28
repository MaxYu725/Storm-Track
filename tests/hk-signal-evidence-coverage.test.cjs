'use strict';

const assert = require('node:assert/strict');
const coverage = require('../analysis/hk-signal-evidence-coverage.js');

function observation(key = 'NARRA') {
  return { group: { key, displayName: key } };
}

function record(capturedAt, fingerprint, { present = false, healthy = true, key = 'NARRA' } = {}) {
  return {
    schemaVersion: 'beta-prospective-recorder/v2',
    capturedAt,
    captureFingerprint: fingerprint,
    sourceStates: ['HKO', 'CMA', 'JMA', 'CWA'].map((agency, index) => ({
      agency,
      state: healthy || index > 0 ? 'ok' : 'error'
    })),
    observations: present ? [observation(key)] : []
  };
}

function indexFor(records, caseId = 'STC-2026-JMA-TC2622', key = 'NARRA') {
  return records
    .filter(item => item.observations.length)
    .map(item => ({
      captureFingerprint: item.captureFingerprint,
      rawGroupKey: key,
      caseId
    }));
}

assert.equal(coverage.VERSION, 'hk-signal-evidence-coverage/v1');
assert.equal(coverage.EFFECTIVE_AT, '2026-08-28T09:01:55.696Z');
assert.equal(coverage.PROSPECTIVE_MAX_GAP_MINUTES, 60);
assert.equal(coverage.CHECKPOINT_MAX_AGE_MINUTES, 60);
assert.equal(coverage.TRUTH_HEALTH_MAX_GAP_MINUTES, 90);

const freshCheckpoint = coverage.assessCheckpoint({
  snapshotAt: '2026-08-28T08:20:00Z',
  targetAt: '2026-08-28T09:00:00Z',
  healthy: true
});
assert.equal(freshCheckpoint.complete, true);
assert.equal(freshCheckpoint.snapshotAgeMinutes, 40);

const staleCheckpoint = coverage.assessCheckpoint({
  snapshotAt: '2026-08-28T01:25:00Z',
  targetAt: '2026-08-28T09:00:00Z',
  healthy: true
});
assert.equal(staleCheckpoint.complete, false);
assert.equal(staleCheckpoint.reason, 'stale-checkpoint-snapshot');

const unhealthyCheckpoint = coverage.assessCheckpoint({
  snapshotAt: '2026-08-28T08:45:00Z',
  targetAt: '2026-08-28T09:00:00Z',
  healthy: false
});
assert.equal(unhealthyCheckpoint.complete, false);
assert.equal(unhealthyCheckpoint.reason, 'unhealthy-prospective-capture');

const lifecycleRecords = [
  record('2026-08-28T00:00:00Z', 'l0', { present: true }),
  record('2026-08-28T00:30:00Z', 'l1', { present: true }),
  record('2026-08-28T04:00:00Z', 'l2', { present: true })
];
const lifecycleCoverage = coverage.assessCaseInterval({
  caseId: 'STC-2026-JMA-TC2622',
  records: lifecycleRecords,
  caseIndex: indexFor(lifecycleRecords),
  startAt: '2026-08-28T00:00:00Z',
  endAt: '2026-08-28T04:15:00Z'
});
assert.equal(lifecycleCoverage.complete, false);
assert.ok(lifecycleCoverage.gaps.some(item => item.reason === 'prospective-gap'));

const missingCaseRecords = [
  record('2026-08-28T00:00:00Z', 'm0', { present: true }),
  record('2026-08-28T00:30:00Z', 'm1', { present: false }),
  record('2026-08-28T01:00:00Z', 'm2', { present: true })
];
const missingCaseCoverage = coverage.assessCaseInterval({
  caseId: 'STC-2026-JMA-TC2622',
  records: missingCaseRecords,
  caseIndex: indexFor(missingCaseRecords),
  startAt: '2026-08-28T00:00:00Z',
  endAt: '2026-08-28T01:00:00Z'
});
assert.equal(missingCaseCoverage.complete, false);
assert.ok(missingCaseCoverage.gaps.some(item => item.reason === 'case-not-present'));

// NARRA-like absence: healthy disappearance at 14:48, recorder runs through 01:25,
// then has a long evidence gap until 09:01. Every >60m gap must split the absence
// into a new coverage segment; no segment may bridge across the missing evidence.
const narraRecords = [
  record('2026-08-27T03:31:15Z', 'n0', { present: true }),
  record('2026-08-27T14:48:05Z', 'n1'),
  record('2026-08-27T15:30:00Z', 'n2'),
  record('2026-08-28T00:21:30Z', 'n3'),
  record('2026-08-28T01:25:00Z', 'n4'),
  record('2026-08-28T09:01:55Z', 'n5'),
  record('2026-08-28T09:45:00Z', 'n6'),
  record('2026-08-29T08:45:00Z', 'n7'),
  record('2026-08-29T09:15:00Z', 'n8')
];
const narraIndex = indexFor(narraRecords);
const absenceSegments = coverage.continuousProspectiveAbsenceSegments({
  caseId: 'STC-2026-JMA-TC2622',
  records: narraRecords,
  caseIndex: narraIndex,
  afterAt: '2026-08-27T03:31:15Z',
  asOf: '2026-08-29T09:15:00Z'
});
assert.equal(absenceSegments.length >= 3, true);
assert.ok(absenceSegments.some(item => item.startAt === '2026-08-28T09:01:55Z'), 'known recovery capture must start a fresh absence segment');
assert.ok(absenceSegments.every(item => !(item.startAt === '2026-08-27T14:48:05Z'
  && Date.parse(item.endAt) >= Date.parse('2026-08-28T09:01:55Z'))), 'pre-gap absence must never bridge into post-gap recovery evidence');
assert.equal(absenceSegments.at(-1).startAt, '2026-08-29T08:45:00Z', 'later synthetic 23h gap must also reset continuity');

const truthHealth = [
  { retrievedAt: '2026-08-28T09:05:00Z' },
  { retrievedAt: '2026-08-28T09:35:00Z' },
  { retrievedAt: '2026-08-29T08:35:00Z' },
  { retrievedAt: '2026-08-29T09:05:00Z' },
  { retrievedAt: '2026-08-29T09:35:00Z' }
];

const truthSegments = coverage.continuousTruthHealthSegments({
  healthRecords: truthHealth,
  asOf: '2026-08-29T09:35:00Z'
});
assert.equal(truthSegments.length >= 2, true, '23h truth-health gap must break continuity');

const noTruthHistory = coverage.findJointNoSignalCoverage({
  caseId: 'STC-2026-JMA-TC2622',
  records: narraRecords,
  caseIndex: narraIndex,
  truthHealthRecords: [],
  afterAt: '2026-08-27T03:31:15Z',
  asOf: '2026-08-29T09:15:00Z'
});
assert.equal(noTruthHistory.complete, false);
assert.equal(noTruthHistory.reason, 'truth-health-history-unavailable');

// Continuous prospective + truth coverage after the recorder gap can eventually close,
// but never at the original 14:48 + 24h wall-clock point.
const continuousNarraRecords = [
  record('2026-08-27T03:31:15Z', 'c0', { present: true })
];
const continuousTruth = [];
for (let minute = 0; minute <= 24 * 60 + 30; minute += 30) {
  const time = new Date(Date.parse('2026-08-28T09:05:00Z') + minute * 60000).toISOString();
  continuousNarraRecords.push(record(time, `c${minute + 1}`));
  continuousTruth.push({ retrievedAt: time });
}
const jointCoverage = coverage.findJointNoSignalCoverage({
  caseId: 'STC-2026-JMA-TC2622',
  records: continuousNarraRecords,
  caseIndex: indexFor(continuousNarraRecords),
  truthHealthRecords: continuousTruth,
  afterAt: '2026-08-27T03:31:15Z',
  asOf: '2026-08-29T09:35:00Z'
});
assert.equal(jointCoverage.complete, true);
assert.equal(jointCoverage.coverageStartedAt, '2026-08-28T09:05:00.000Z');
assert.equal(jointCoverage.closedAt, '2026-08-29T09:05:00.000Z');
assert.notEqual(jointCoverage.closedAt, '2026-08-28T14:48:05.000Z');

console.log('hk signal evidence coverage tests: OK');
