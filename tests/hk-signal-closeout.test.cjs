'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const closeout = require('../analysis/hk-signal-closeout.js');

function observation({ t1 = 'unlikely', t3 = 'unlikely', t8 = 'unlikely' } = {}) {
  const signal = (likelihood, risk) => ({
    likelihood,
    riskIndex: risk,
    confidenceIndex: 0.5,
    persistenceHours: likelihood === 'unlikely' ? 0 : 6,
    estimatedWindow: likelihood === 'unlikely' ? null : {
      start: '2026-08-23T00:00:00Z',
      end: '2026-08-24T00:00:00Z'
    }
  });
  return {
    group: { key: 'NARRA', displayName: '紫檀 (NARRA)' },
    analysis: {
      basicForecast: {
        signals: {
          T1: signal(t1, t1 === 'unlikely' ? 0.2 : 0.4),
          T3: signal(t3, t3 === 'unlikely' ? 0.2 : 0.45),
          T8: signal(t8, t8 === 'unlikely' ? 0.1 : 0.5)
        }
      }
    }
  };
}

function record(capturedAt, fingerprint, present, states = ['ok', 'ok', 'ok', 'ok'], forecast = {}) {
  return {
    schemaVersion: 'beta-prospective-recorder/v2',
    capturedAt,
    captureFingerprint: fingerprint,
    sourceStates: ['HKO', 'CMA', 'JMA', 'CWA'].map((agency, index) => ({ agency, state: states[index] })),
    observations: present ? [observation(forecast)] : []
  };
}

function registry() {
  return {
    schemaVersion: 'storm-case-identity/v1',
    cases: [{
      caseId: 'STC-2026-JMA-TC2622',
      firstSeen: '2026-08-22T00:00:00Z',
      lastSeen: '2026-08-22T00:00:00Z',
      sourceTokens: ['HKO:2629', 'JMA:TC2622']
    }]
  };
}

function indexFor(records) {
  return records
    .filter(item => item.observations.length)
    .map(item => ({
      captureFingerprint: item.captureFingerprint,
      rawGroupKey: 'NARRA',
      caseId: 'STC-2026-JMA-TC2622'
    }));
}

const present = record('2026-08-22T00:00:00Z', 'f0', true, undefined, { t1: 'possible' });
const absent = record('2026-08-22T01:00:00Z', 'f1', false);
const baseRecords = [present, absent];

assert.equal(closeout.POLICY_VERSION, 'hk-signal-closeout-policy/v1');
assert.equal(closeout.INACTIVE_GRACE_HOURS, 24);

const beforeGrace = closeout.deriveCloseouts({
  caseRegistry: registry(),
  caseIndex: indexFor(baseRecords),
  records: baseRecords,
  truthEvents: [],
  evaluations: [],
  asOf: '2026-08-23T00:59:59Z'
});
assert.equal(beforeGrace.closeouts.length, 0, 'must not close before 24h absence grace');

const negative = closeout.deriveCloseouts({
  caseRegistry: registry(),
  caseIndex: indexFor(baseRecords),
  records: baseRecords,
  truthEvents: [],
  evaluations: [],
  asOf: '2026-08-23T01:00:00Z'
});
assert.deepEqual(negative.closeouts.map(item => item.signal), ['T1', 'T3', 'T8']);
assert.equal(negative.closeouts.find(item => item.signal === 'T1').forecastOutcome, 'stable-false-alarm');
assert.equal(negative.closeouts.find(item => item.signal === 'T3').forecastOutcome, 'correct-negative');
assert.equal(negative.closeouts.find(item => item.signal === 'T8').rubricGradeApplied, false);
assert.equal(negative.closeouts[0].closedAt, '2026-08-23T01:00:00.000Z');

const unhealthyAbsent = record('2026-08-22T01:00:00Z', 'f-error', false, ['error', 'ok', 'ok', 'ok']);
assert.equal(closeout.deriveCloseouts({
  caseRegistry: registry(),
  caseIndex: indexFor([present, unhealthyAbsent]),
  records: [present, unhealthyAbsent],
  truthEvents: [],
  evaluations: [],
  asOf: '2026-08-24T00:00:00Z'
}).closeouts.length, 0, 'HKO/source failure must not close a case');

const reappeared = record('2026-08-22T02:00:00Z', 'f2', true, undefined, { t1: 'possible' });
const reappearRecords = [present, absent, reappeared];
assert.equal(closeout.deriveCloseouts({
  caseRegistry: registry(),
  caseIndex: indexFor(reappearRecords),
  records: reappearRecords,
  truthEvents: [],
  evaluations: [],
  asOf: '2026-08-24T00:00:00Z'
}).closeouts.length, 0, 'a case that reappears must remain open until a later healthy absence exists');

const ambiguous = [{
  status: 'ambiguous',
  signal: 'T1',
  caseId: null,
  truth: { eventTime: '2026-08-22T12:00:00Z' }
}];
const blocked = closeout.deriveCloseouts({
  caseRegistry: registry(),
  caseIndex: indexFor(baseRecords),
  records: baseRecords,
  truthEvents: [],
  evaluations: ambiguous,
  asOf: '2026-08-24T00:00:00Z'
});
assert.equal(blocked.closeouts.length, 0);
assert.equal(blocked.blocked[0].reason, 'unresolved-truth-event-during-no-signal-case');

const t1Evaluation = {
  status: 'evaluated',
  signal: 'T1',
  caseId: 'STC-2026-JMA-TC2622',
  truth: { eventTime: '2026-08-22T10:00:00Z' }
};
const clearEvent = {
  eventType: 'CLEAR_DETECTED',
  eventTime: '2026-08-22T20:00:00Z',
  observedAt: '2026-08-22T20:05:00Z'
};
const warnedRecords = [
  record('2026-08-22T00:00:00Z', 'w0', true, undefined, { t1: 'possible', t3: 'possible', t8: 'unlikely' }),
  record('2026-08-22T19:00:00Z', 'w1', true, undefined, { t1: 'likely', t3: 'possible', t8: 'unlikely' })
];
const warned = closeout.deriveCloseouts({
  caseRegistry: registry(),
  caseIndex: indexFor(warnedRecords),
  records: warnedRecords,
  truthEvents: [clearEvent],
  evaluations: [t1Evaluation],
  asOf: '2026-08-22T21:00:00Z'
});
assert.deepEqual(warned.closeouts.map(item => item.signal), ['T3', 'T8']);
assert.equal(warned.closeouts.find(item => item.signal === 'T3').forecastOutcome, 'stable-false-alarm');
assert.equal(warned.closeouts.find(item => item.signal === 'T8').forecastOutcome, 'correct-negative');
assert.equal(warned.closeouts[0].closeoutReason, 'hko-warning-episode-cleared');

const t3Evaluation = {
  status: 'evaluated',
  signal: 'T3',
  caseId: 'STC-2026-JMA-TC2622',
  truth: { eventTime: '2026-08-22T15:00:00Z' }
};
const t1t3 = closeout.deriveCloseouts({
  caseRegistry: registry(),
  caseIndex: indexFor(warnedRecords),
  records: warnedRecords,
  truthEvents: [clearEvent],
  evaluations: [t1Evaluation, t3Evaluation],
  asOf: '2026-08-22T21:00:00Z'
});
assert.deepEqual(t1t3.closeouts.map(item => item.signal), ['T8']);

const skippedT3 = {
  status: 'not-issued',
  signal: 'T3',
  caseId: 'STC-2026-JMA-TC2622',
  truth: { eventTime: '2026-08-22T16:00:00Z' }
};
const t8Evaluation = {
  status: 'evaluated',
  signal: 'T8',
  caseId: 'STC-2026-JMA-TC2622',
  truth: { eventTime: '2026-08-22T16:00:00Z' }
};
assert.equal(closeout.deriveCloseouts({
  caseRegistry: registry(),
  caseIndex: indexFor(warnedRecords),
  records: warnedRecords,
  truthEvents: [clearEvent],
  evaluations: [t1Evaluation, skippedT3, t8Evaluation],
  asOf: '2026-08-22T21:00:00Z'
}).closeouts.length, 0, 'already evaluated/skipped signals must not be duplicated at clear');

execFileSync(process.execPath, [require.resolve('./hk-signal-closeout-diagnostics.test.cjs')], {
  stdio: 'inherit'
});

execFileSync(process.execPath, [require.resolve('./hk-signal-closeout-awaiting-reconcile.test.mjs')], {
  stdio: 'inherit'
});

console.log('hk signal closeout tests: OK');
