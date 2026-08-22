'use strict';

const assert = require('node:assert/strict');
const evaluator = require('../analysis/hk-signal-evaluator.js');

function signal(likelihood, start, end, riskIndex = 0.5, confidenceIndex = 0.6, persistenceHours = 4) {
  return {
    likelihood,
    riskIndex,
    confidenceIndex,
    persistenceHours,
    estimatedWindow: start && end ? { start, end } : null
  };
}

function observation(states = {}) {
  return {
    schemaVersion: 'hk-beta-prospective-observation/v1',
    group: { key: 'NARRA', displayName: '紫檀 (NARRA)' },
    sourceAgencies: ['HKO', 'CMA', 'JMA', 'CWA'],
    engineVersions: { basicForecast: 'basic-hk-signal-forecast/v1' },
    analysis: {
      basicForecast: {
        signals: {
          T1: states.T1 || signal('unlikely', null, null, 0.2, 0.7, 0),
          T3: states.T3 || signal('unlikely', null, null, 0.1, 0.6, 0),
          T8: states.T8 || signal('unlikely', null, null, 0.05, 0.5, 0)
        }
      },
      threatAssessment: {
        analyzers: { agencyDisagreement: { confidence: 0.7 } }
      }
    }
  };
}

function row(capturedAt, states, fingerprint) {
  return {
    capturedAt,
    captureFingerprint: fingerprint || capturedAt,
    rawGroupKey: 'NARRA',
    observation: observation(states)
  };
}

const t1Event = {
  eventType: 'ISSUE',
  eventTime: '2026-08-24T00:00:00Z',
  timeSource: 'HKO_OFFICIAL',
  truthFingerprint: 'truth-t1',
  previousTruth: { present: false, code: null, level: null },
  currentTruth: {
    code: 'TC1',
    level: 1,
    issueTime: '2026-08-24T00:00:00Z',
    type: '一號戒備信號',
    details: []
  }
};

const t3Event = {
  eventType: 'SIGNAL_CHANGE',
  eventTime: '2026-08-24T12:00:00Z',
  timeSource: 'HKO_OFFICIAL',
  truthFingerprint: 'truth-t3',
  previousTruth: { present: true, code: 'TC1', level: 1 },
  currentTruth: {
    code: 'TC3',
    level: 3,
    issueTime: '2026-08-24T12:00:00Z',
    type: '三號強風信號',
    details: []
  }
};

const t8Event = {
  eventType: 'SIGNAL_CHANGE',
  eventTime: '2026-08-25T00:00:00Z',
  timeSource: 'HKO_OFFICIAL',
  truthFingerprint: 'truth-t8',
  previousTruth: { present: true, code: 'TC3', level: 3 },
  currentTruth: {
    code: 'TC8NE',
    level: 8,
    issueTime: '2026-08-25T00:00:00Z',
    type: '八號東北烈風或暴風信號',
    details: []
  }
};

assert.equal(evaluator.VERSION, 'hk-signal-evaluator/v2');
assert.equal(evaluator.RUBRIC_VERSION, 'hk-signal-validation-rubric/v1');
assert.equal(evaluator.EVENT_POLICY_VERSION, 'hk-signal-event-policy/v1');
assert.deepEqual(evaluator.CHECKPOINT_HOURS, [48, 24, 12, 6, 3]);
assert.deepEqual(evaluator.SIGNALS, ['T1', 'T3', 'T8']);

assert.equal(evaluator.isInitialSignalEvent(t1Event, 'T1'), true);
assert.equal(evaluator.isInitialTc1Issue(t1Event), true);
assert.equal(evaluator.isInitialSignalEvent({ ...t1Event, eventType: 'SIGNAL_CHANGE' }, 'T1'), false);
assert.equal(evaluator.isInitialSignalEvent(t3Event, 'T3'), true);
assert.equal(evaluator.isInitialSignalEvent({
  ...t3Event,
  previousTruth: { code: 'TC8SE', level: 8 }
}, 'T3'), false, 'TC8 -> TC3 downgrade must not be scored as initial T3');
assert.equal(evaluator.isInitialSignalEvent(t8Event, 'T8'), true);
assert.equal(evaluator.isInitialSignalEvent({
  ...t8Event,
  previousTruth: { code: 'TC8NE', level: 8 },
  currentTruth: { ...t8Event.currentTruth, code: 'TC8SE' }
}, 'T8'), false, 'TC8 direction change must not create a new T8 event');
assert.equal(evaluator.isInitialSignalEvent({
  ...t8Event,
  previousTruth: { code: 'TC9', level: 9 }
}, 'T8'), false, 'TC9 -> TC8 downgrade must not create a T8 event');

assert.deepEqual(evaluator.gradeWindow(t1Event.eventTime, {
  start: '2026-08-23T20:00:00Z',
  end: '2026-08-24T04:00:00Z'
}), { grade: 'A', hit: true, boundaryErrorHours: 0, widthHours: 8 });
assert.equal(evaluator.gradeWindow(t1Event.eventTime, {
  start: '2026-08-24T02:00:00Z',
  end: '2026-08-24T10:00:00Z'
}).grade, 'B');
assert.equal(evaluator.gradeWindow(t1Event.eventTime, {
  start: '2026-08-24T05:00:00Z',
  end: '2026-08-24T12:00:00Z'
}).grade, 'C');
assert.equal(evaluator.gradeWindow(t1Event.eventTime, null).grade, 'D');

const t1Timeline = [
  row('2026-08-21T12:00:00Z', { T1: signal('unlikely', null, null) }, 'f0'),
  row('2026-08-22T18:00:00Z', { T1: signal('possible', '2026-08-23T18:00:00Z', '2026-08-24T06:00:00Z') }, 'f1'),
  row('2026-08-23T06:00:00Z', { T1: signal('unlikely', null, null) }, 'f2'),
  row('2026-08-23T14:00:00Z', { T1: signal('possible', '2026-08-23T21:00:00Z', '2026-08-24T05:00:00Z') }, 'f3'),
  row('2026-08-23T20:00:00Z', { T1: signal('possible', '2026-08-23T22:00:00Z', '2026-08-24T04:00:00Z') }, 'f4'),
  row('2026-08-23T23:00:00Z', { T1: signal('likely', '2026-08-23T23:00:00Z', '2026-08-24T03:00:00Z') }, 'f5')
];

const t1Evaluation = evaluator.evaluateSignalEvent({
  signal: 'T1',
  event: t1Event,
  timeline: t1Timeline,
  caseId: 'STC-2026-JMA-TC2622',
  attribution: { status: 'attributed', caseId: 'STC-2026-JMA-TC2622', reason: 'unique-active-hko-case', candidates: ['STC-2026-JMA-TC2622'] }
});
assert.equal(t1Evaluation.status, 'evaluated');
assert.equal(t1Evaluation.signal, 'T1');
assert.equal(t1Evaluation.lifecycle.firstPossibleAt, '2026-08-22T18:00:00Z');
assert.equal(t1Evaluation.lifecycle.firstStablePossibleAt, '2026-08-23T14:00:00Z');
assert.equal(t1Evaluation.lifecycle.stableLeadHours, 10);
assert.equal(t1Evaluation.lifecycle.reversalFlips, 2, 'possible -> unlikely -> possible should count two reversal flips');
assert.equal(t1Evaluation.grades.stableLead, 'B');
assert.equal(t1Evaluation.grades.stability, 'C');
assert.equal(t1Evaluation.grades.finalWindowTiming, 'A');
assert.equal(t1Evaluation.grades.finalWindowPrecision, 'A');
assert.equal(t1Evaluation.checkpoints.find(item => item.checkpointHours === 48).snapshot.likelihood, 'unlikely');
assert.equal(t1Evaluation.checkpoints.find(item => item.checkpointHours === 24).snapshot.likelihood, 'possible');
assert.equal(t1Evaluation.checkpoints.find(item => item.checkpointHours === 12).snapshot.likelihood, 'unlikely');

const higherTimeline = [
  row('2026-08-23T00:00:00Z', {
    T3: signal('unlikely', null, null, 0.2),
    T8: signal('unlikely', null, null, 0.1)
  }, 'h0'),
  row('2026-08-24T06:00:00Z', {
    T3: signal('possible', '2026-08-24T09:00:00Z', '2026-08-24T18:00:00Z', 0.45, 0.65, 5),
    T8: signal('unlikely', null, null, 0.25)
  }, 'h1'),
  row('2026-08-24T16:00:00Z', {
    T3: signal('likely', '2026-08-24T10:00:00Z', '2026-08-24T17:00:00Z', 0.7, 0.72, 9),
    T8: signal('possible', '2026-08-24T21:00:00Z', '2026-08-25T06:00:00Z', 0.48, 0.62, 4)
  }, 'h2'),
  row('2026-08-24T22:00:00Z', {
    T3: signal('likely', '2026-08-24T10:00:00Z', '2026-08-24T17:00:00Z', 0.72, 0.74, 10),
    T8: signal('likely', '2026-08-24T22:00:00Z', '2026-08-25T04:00:00Z', 0.75, 0.71, 8)
  }, 'h3')
];

const t3Evaluation = evaluator.evaluateSignalEvent({
  signal: 'T3',
  event: t3Event,
  timeline: higherTimeline,
  caseId: 'STC-2026-JMA-TC2622',
  attribution: { status: 'attributed', caseId: 'STC-2026-JMA-TC2622', reason: 'unique-active-hko-case', candidates: ['STC-2026-JMA-TC2622'] }
});
assert.equal(t3Evaluation.signal, 'T3');
assert.equal(t3Evaluation.finalPreEvent.likelihood, 'possible');
assert.equal(t3Evaluation.finalPreEvent.riskIndex, 0.45);
assert.equal(t3Evaluation.grades.finalWindowTiming, 'A');

const t8Evaluation = evaluator.evaluateSignalEvent({
  signal: 'T8',
  event: t8Event,
  timeline: higherTimeline,
  caseId: 'STC-2026-JMA-TC2622',
  attribution: { status: 'attributed', caseId: 'STC-2026-JMA-TC2622', reason: 'unique-active-hko-case', candidates: ['STC-2026-JMA-TC2622'] }
});
assert.equal(t8Evaluation.signal, 'T8');
assert.equal(t8Evaluation.finalPreEvent.likelihood, 'likely');
assert.equal(t8Evaluation.grades.finalWindowTiming, 'A');
assert.equal(t8Evaluation.grades.finalWindowPrecision, 'A');

const skippedT3 = evaluator.skippedLowerSignal({ signal: 'T3', higherSignalEvaluation: t8Evaluation });
assert.equal(skippedT3.status, 'not-issued');
assert.equal(skippedT3.signal, 'T3');
assert.equal(skippedT3.truth.skippedBySignal, 'T8');
assert.equal(skippedT3.grades, null);

const caseIndex = [
  {
    capturedAt: '2026-08-24T22:00:00Z',
    caseId: 'STC-2026-JMA-TC2622',
    sourceTokens: ['HKO:2629', 'JMA:TC2622'],
    specificNames: ['NARRA', '紫檀']
  },
  {
    capturedAt: '2026-08-24T22:00:00Z',
    caseId: 'STC-2026-JMA-TC2699',
    sourceTokens: ['HKO:2699', 'JMA:TC2699'],
    specificNames: ['OTHER']
  }
];
const namedEvent = {
  ...t8Event,
  currentTruth: {
    ...t8Event.currentTruth,
    details: [{ contents: ['熱帶氣旋紫檀的八號烈風或暴風信號現正生效。'] }]
  }
};
const namedAttribution = evaluator.attributeCase(namedEvent, caseIndex);
assert.equal(namedAttribution.status, 'attributed');
assert.equal(namedAttribution.caseId, 'STC-2026-JMA-TC2622');
assert.equal(namedAttribution.reason, 'hko-warning-name-match');

const ambiguousEvent = { ...t8Event, currentTruth: { ...t8Event.currentTruth, details: [] } };
assert.equal(evaluator.attributeCase(ambiguousEvent, caseIndex).status, 'ambiguous');
assert.equal(evaluator.attributeCase(t8Event, [caseIndex[0]]).reason, 'unique-active-hko-case');
assert.equal(evaluator.attributeCase(t8Event, []).status, 'unresolved');

console.log('hk signal evaluator tests: OK');
