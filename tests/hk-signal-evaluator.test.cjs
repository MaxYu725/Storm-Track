'use strict';

const assert = require('node:assert/strict');
const evaluator = require('../analysis/hk-signal-evaluator.js');

function observation(likelihood, start, end) {
  return {
    schemaVersion: 'hk-beta-prospective-observation/v1',
    group: { key: 'NARRA', displayName: '紫檀 (NARRA)' },
    sourceAgencies: ['HKO', 'CMA', 'JMA', 'CWA'],
    engineVersions: { basicForecast: 'basic-hk-signal-forecast/v1' },
    analysis: {
      basicForecast: {
        signals: {
          T1: {
            likelihood,
            estimatedWindow: start && end ? { start, end } : null
          }
        }
      },
      threatAssessment: {
        analyzers: { agencyDisagreement: { confidence: 0.7 } }
      }
    }
  };
}

function row(capturedAt, likelihood, start, end, fingerprint) {
  return {
    capturedAt,
    captureFingerprint: fingerprint || capturedAt,
    rawGroupKey: 'NARRA',
    observation: observation(likelihood, start, end)
  };
}

const event = {
  eventType: 'ISSUE',
  eventTime: '2026-08-24T00:00:00Z',
  timeSource: 'HKO_OFFICIAL',
  truthFingerprint: 'truth-1',
  currentTruth: {
    code: 'TC1',
    level: 1,
    issueTime: '2026-08-24T00:00:00Z',
    type: '一號戒備信號',
    details: []
  }
};

assert.equal(evaluator.RUBRIC_VERSION, 'hk-signal-validation-rubric/v1');
assert.deepEqual(evaluator.CHECKPOINT_HOURS, [48, 24, 12, 6, 3]);
assert.equal(evaluator.isInitialTc1Issue(event), true);
assert.equal(evaluator.isInitialTc1Issue({ ...event, eventType: 'SIGNAL_CHANGE' }), false);
assert.equal(evaluator.isInitialTc1Issue({ ...event, currentTruth: { code: 'TC3', level: 3 } }), false);

assert.deepEqual(evaluator.gradeWindow(event.eventTime, {
  start: '2026-08-23T20:00:00Z',
  end: '2026-08-24T04:00:00Z'
}), { grade: 'A', hit: true, boundaryErrorHours: 0, widthHours: 8 });
assert.equal(evaluator.gradeWindow(event.eventTime, {
  start: '2026-08-24T02:00:00Z',
  end: '2026-08-24T10:00:00Z'
}).grade, 'B');
assert.equal(evaluator.gradeWindow(event.eventTime, {
  start: '2026-08-24T05:00:00Z',
  end: '2026-08-24T12:00:00Z'
}).grade, 'C');
assert.equal(evaluator.gradeWindow(event.eventTime, null).grade, 'D');

const timeline = [
  row('2026-08-21T12:00:00Z', 'unlikely', null, null, 'f0'),
  row('2026-08-22T18:00:00Z', 'possible', '2026-08-23T18:00:00Z', '2026-08-24T06:00:00Z', 'f1'),
  row('2026-08-23T06:00:00Z', 'unlikely', null, null, 'f2'),
  row('2026-08-23T14:00:00Z', 'possible', '2026-08-23T21:00:00Z', '2026-08-24T05:00:00Z', 'f3'),
  row('2026-08-23T20:00:00Z', 'possible', '2026-08-23T22:00:00Z', '2026-08-24T04:00:00Z', 'f4'),
  row('2026-08-23T23:00:00Z', 'likely', '2026-08-23T23:00:00Z', '2026-08-24T03:00:00Z', 'f5')
];

const evaluation = evaluator.evaluateTc1Event({
  event,
  timeline,
  caseId: 'STC-2026-JMA-TC2622',
  attribution: { status: 'attributed', caseId: 'STC-2026-JMA-TC2622', reason: 'unique-active-hko-case', candidates: ['STC-2026-JMA-TC2622'] }
});
assert.equal(evaluation.status, 'evaluated');
assert.equal(evaluation.caseId, 'STC-2026-JMA-TC2622');
assert.equal(evaluation.lifecycle.firstPossibleAt, '2026-08-22T18:00:00Z');
assert.equal(evaluation.lifecycle.firstStablePossibleAt, '2026-08-23T14:00:00Z');
assert.equal(evaluation.lifecycle.stableLeadHours, 10);
assert.equal(evaluation.lifecycle.reversalFlips, 2, 'possible -> unlikely -> possible should count two reversal flips');
assert.equal(evaluation.grades.stableLead, 'B');
assert.equal(evaluation.grades.stability, 'C');
assert.equal(evaluation.grades.finalWindowTiming, 'A');
assert.equal(evaluation.grades.finalWindowPrecision, 'A');
assert.equal(evaluation.checkpoints.find(item => item.checkpointHours === 48).snapshot.likelihood, 'unlikely');
assert.equal(evaluation.checkpoints.find(item => item.checkpointHours === 24).snapshot.likelihood, 'possible');
assert.equal(evaluation.checkpoints.find(item => item.checkpointHours === 12).snapshot.likelihood, 'unlikely');

const caseIndex = [
  {
    capturedAt: '2026-08-23T22:00:00Z',
    caseId: 'STC-2026-JMA-TC2622',
    sourceTokens: ['HKO:2629', 'JMA:TC2622'],
    specificNames: ['NARRA', '紫檀']
  },
  {
    capturedAt: '2026-08-23T22:00:00Z',
    caseId: 'STC-2026-JMA-TC2699',
    sourceTokens: ['HKO:2699', 'JMA:TC2699'],
    specificNames: ['OTHER']
  }
];
const namedEvent = {
  ...event,
  currentTruth: {
    ...event.currentTruth,
    details: [{ contents: ['熱帶氣旋紫檀的相關一號戒備信號現正生效。'] }]
  }
};
const namedAttribution = evaluator.attributeCase(namedEvent, caseIndex);
assert.equal(namedAttribution.status, 'attributed');
assert.equal(namedAttribution.caseId, 'STC-2026-JMA-TC2622');
assert.equal(namedAttribution.reason, 'hko-warning-name-match');

const ambiguousEvent = { ...event, currentTruth: { ...event.currentTruth, details: [] } };
assert.equal(evaluator.attributeCase(ambiguousEvent, caseIndex).status, 'ambiguous');
assert.equal(evaluator.attributeCase(event, [caseIndex[0]]).reason, 'unique-active-hko-case');
assert.equal(evaluator.attributeCase(event, []).status, 'unresolved');

console.log('hk signal evaluator tests: OK');
