import assert from 'node:assert/strict';
import {
  evaluateEstimatedWindow,
  evaluateReplayAgainstTruth,
  selectRecordAtOrBefore
} from '../scripts/replay-historical-case.mjs';

const records = [
  {
    asOf: '2026-07-24T00:00:00.000Z',
    usableAgencies: ['CMA'],
    impactUncertainty: 'insufficient',
    forecast: {
      signals: {
        T1: { likelihood: 'unlikely', riskIndex: 0.2, confidenceIndex: 0.4, estimatedWindow: null },
        T3: { likelihood: 'unlikely', riskIndex: 0.1, confidenceIndex: 0.3, estimatedWindow: null },
        T8: { likelihood: 'unlikely', riskIndex: 0.05, confidenceIndex: 0.25, estimatedWindow: null }
      }
    }
  },
  {
    asOf: '2026-07-24T06:00:00.000Z',
    usableAgencies: ['CMA'],
    impactUncertainty: 'insufficient',
    forecast: {
      signals: {
        T1: { likelihood: 'possible', riskIndex: 0.4, confidenceIndex: 0.4, estimatedWindow: { start: '2026-07-24T11:00:00.000Z', end: '2026-07-24T17:00:00.000Z' } },
        T3: { likelihood: 'unlikely', riskIndex: 0.2, confidenceIndex: 0.3, estimatedWindow: null },
        T8: { likelihood: 'unlikely', riskIndex: 0.1, confidenceIndex: 0.25, estimatedWindow: null }
      }
    }
  },
  {
    asOf: '2026-07-24T12:00:00.000Z',
    usableAgencies: ['CMA'],
    impactUncertainty: 'insufficient',
    forecast: {
      signals: {
        T1: { likelihood: 'likely', riskIndex: 0.7, confidenceIndex: 0.4, estimatedWindow: { start: '2026-07-24T12:00:00.000Z', end: '2026-07-24T18:00:00.000Z' } },
        T3: { likelihood: 'possible', riskIndex: 0.4, confidenceIndex: 0.3, estimatedWindow: { start: '2026-07-25T02:00:00.000Z', end: '2026-07-25T08:00:00.000Z' } },
        T8: { likelihood: 'unlikely', riskIndex: 0.2, confidenceIndex: 0.25, estimatedWindow: null }
      }
    }
  }
];

assert.equal(selectRecordAtOrBefore(records, '2026-07-24T07:00:00.000Z')?.asOf, '2026-07-24T06:00:00.000Z');
assert.equal(selectRecordAtOrBefore(records, '2026-07-23T23:59:59.000Z'), null);
assert.notEqual(selectRecordAtOrBefore(records, '2026-07-24T07:00:00.000Z')?.asOf, '2026-07-24T12:00:00.000Z');

assert.deepEqual(
  evaluateEstimatedWindow('2026-07-24T12:40:00.000Z', { start: '2026-07-24T11:00:00.000Z', end: '2026-07-24T17:00:00.000Z' }),
  { status: 'inside', inside: true, nearestBoundaryHours: 0 }
);
const lateWindow = evaluateEstimatedWindow('2026-07-24T12:40:00.000Z', { start: '2026-07-24T14:40:00.000Z', end: '2026-07-24T18:40:00.000Z' });
assert.equal(lateWindow.status, 'window-after-issue');
assert.equal(lateWindow.inside, false);
assert.equal(lateWindow.nearestBoundaryHours, 2);

const manifest = {
  truth: {
    signalLifecycle: [
      { signal: 'T1', issuedAt: '2026-07-24T12:40:00.000Z' },
      { signal: 'T3', issuedAt: '2026-07-25T05:20:00.000Z' },
      { signal: 'T8NW', issuedAt: '2026-07-25T14:10:00.000Z' }
    ]
  }
};
const evaluation = evaluateReplayAgainstTruth(manifest, records);
const t1Latest = evaluation.T1.checkpoints.find(item => item.label === 'latest-pre-issue');
assert.equal(t1Latest.snapshotAsOf, '2026-07-24T12:00:00.000Z');
assert.ok(Date.parse(t1Latest.snapshotAsOf) < Date.parse(evaluation.T1.officialIssuedAt));
assert.equal(evaluation.T1.diagnostics.firstPossibleAt, '2026-07-24T06:00:00.000Z');
assert.equal(evaluation.T1.diagnostics.firstStablePossibleAt, '2026-07-24T06:00:00.000Z');
assert.equal(evaluation.T1.diagnostics.stateFlipsBeforeIssue, 1);

console.log('historical frozen-v1 replay tests: OK');
