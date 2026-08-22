'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const closeout = require('../analysis/hk-signal-closeout.js');

const CASE_ID = 'STC-2026-JMA-TC2623';

function signal(likelihood, riskIndex) {
  return {
    likelihood,
    riskIndex,
    confidenceIndex: 0.5,
    persistenceHours: likelihood === 'unlikely' ? 0 : 6,
    estimatedWindow: likelihood === 'unlikely' ? null : {
      start: '2026-08-22T02:30:00Z',
      end: '2026-08-22T04:30:00Z'
    }
  };
}

function observation(key, likelihood, agencies) {
  return {
    schemaVersion: 'hk-beta-prospective-observation/v1',
    group: { key, displayName: key === 'GAENARI' ? '簡拉維 (GAENARI)' : '热带低压 (nameless)' },
    sourceAgencies: agencies,
    engineVersions: { basicForecast: 'basic-hk-signal-forecast/v1' },
    analysis: {
      basicForecast: {
        signals: {
          T1: signal(likelihood, likelihood === 'unlikely' ? 0.2 : 0.5),
          T3: signal('unlikely', 0.1),
          T8: signal('unlikely', 0.05)
        }
      },
      threatAssessment: { analyzers: { agencyDisagreement: { confidence: 0.5 } } }
    }
  };
}

function record(capturedAt, fingerprint, observations) {
  return {
    schemaVersion: 'beta-prospective-recorder/v2',
    capturedAt,
    captureFingerprint: fingerprint,
    sourceStates: ['HKO', 'CMA', 'JMA', 'CWA'].map(agency => ({ agency, state: 'ok' })),
    observations
  };
}

function indexRow(capturedAt, fingerprint, groupKey, sourceTokens, specificNames = []) {
  return {
    resolverVersion: 'storm-case-identity/v1',
    capturedAt,
    captureFingerprint: fingerprint,
    rawGroupKey: groupKey,
    rawDisplayName: groupKey,
    caseId: CASE_ID,
    resolution: { reason: 'source-id-overlap', score: 1000, gapHours: 0, distanceKm: 0 },
    sourceTokens,
    specificNames
  };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-signal-ambiguous-'));
const prospective = path.join(tmp, 'prospective');
const truth = path.join(tmp, 'truth');
fs.mkdirSync(path.join(prospective, 'observations', '2026', '08', '22'), { recursive: true });
fs.mkdirSync(truth, { recursive: true });

const f0 = record('2026-08-22T00:00:00Z', 'f0', [
  observation('GAENARI', 'unlikely', ['HKO', 'JMA'])
]);
const f1 = record('2026-08-22T01:00:00Z', 'f1', [
  observation('GAENARI', 'possible', ['HKO', 'JMA', 'CWA']),
  observation('热带低压', 'likely', ['CMA'])
]);
const f2 = record('2026-08-22T02:00:00Z', 'f2', [
  observation('GAENARI', 'unlikely', ['CMA', 'CWA', 'HKO', 'JMA'])
]);

for (const [name, value] of [['f0.json', f0], ['f1.json', f1], ['f2.json', f2]]) {
  fs.writeFileSync(path.join(prospective, 'observations', '2026', '08', '22', name), `${JSON.stringify(value)}\n`);
}

const registry = {
  schemaVersion: 'storm-case-identity/v1',
  reconciledThrough: f2.capturedAt,
  caseCount: 1,
  cases: [{
    caseId: CASE_ID,
    firstSeen: f0.capturedAt,
    lastSeen: f2.capturedAt,
    sourceTokens: ['CMA:3308554', 'CWA:2026-22', 'HKO:2631', 'JMA:TC2623']
  }]
};
fs.writeFileSync(path.join(prospective, 'case-registry.json'), `${JSON.stringify(registry)}\n`);

const caseIndex = [
  indexRow(f0.capturedAt, 'f0', 'GAENARI', ['HKO:2631', 'JMA:TC2623'], ['GAENARI', '簡拉維']),
  indexRow(f1.capturedAt, 'f1', 'GAENARI', ['CWA:2026-22', 'HKO:2631', 'JMA:TC2623'], ['GAENARI', '簡拉維']),
  indexRow(f1.capturedAt, 'f1', '热带低压', ['CMA:3308554']),
  indexRow(f2.capturedAt, 'f2', 'GAENARI', ['CMA:3308554', 'CWA:2026-22', 'HKO:2631', 'JMA:TC2623'], ['GAENARI', '簡拉維'])
];
fs.writeFileSync(path.join(prospective, 'case-index.ndjson'), `${caseIndex.map(row => JSON.stringify(row)).join('\n')}\n`);

const baseline = {
  eventType: 'BASELINE',
  eventTime: '2026-08-22T00:00:00Z',
  observedAt: '2026-08-22T00:00:10Z',
  truthFingerprint: 'truth-baseline',
  previousTruth: null,
  currentTruth: { present: false, code: null, level: null }
};
const issue = {
  eventType: 'ISSUE',
  eventTime: '2026-08-22T03:00:00Z',
  observedAt: '2026-08-22T03:00:10Z',
  timeSource: 'HKO_OFFICIAL',
  truthFingerprint: 'truth-t1',
  previousTruth: { present: false, code: null, level: null },
  currentTruth: {
    present: true,
    code: 'TC1',
    level: 1,
    type: '一號戒備信號',
    actionCode: 'ISSUE',
    issueTime: '2026-08-22T03:00:00Z',
    updateTime: '2026-08-22T03:00:00Z',
    details: []
  }
};
fs.writeFileSync(path.join(truth, 'truth-events.ndjson'), `${JSON.stringify(baseline)}\n${JSON.stringify(issue)}\n`);
fs.writeFileSync(path.join(truth, 'latest.json'), `${JSON.stringify({
  schemaVersion: 'hko-warning-truth/v1',
  retrievedAt: '2026-08-22T03:00:10Z',
  truthFingerprint: 'truth-t1',
  truth: issue.currentTruth,
  context: { pre8: [], specialWeatherTips: [] }
})}\n`);

const evaluation = JSON.parse(execFileSync(process.execPath, [
  path.join(__dirname, '..', 'scripts', 'evaluate-hk-signal.mjs'),
  prospective,
  truth
], { encoding: 'utf8' }));

assert.equal(evaluation.prospective.excludedAmbiguousCaseCaptureCount, 1);
assert.deepEqual(evaluation.prospective.excludedAmbiguousCaseCaptures[0].rawGroupKeys, ['GAENARI', '热带低压']);
const t1 = evaluation.evaluations.find(item => item.signal === 'T1' && item.status === 'evaluated');
assert.ok(t1, 'synthetic TC1 must be evaluated');
assert.equal(t1.evidence.preEventSnapshotCount, 2, 'ambiguous capture must contribute zero forecast snapshots');
assert.equal(t1.lifecycle.firstPossibleAt, null, 'positive states from the split capture must not affect lifecycle scoring');
assert.equal(t1.finalPreEvent.captureFingerprint, 'f2');
assert.equal(t1.finalPreEvent.likelihood, 'unlikely');

const absent = record('2026-08-22T02:00:00Z', 'absent', []);
const negativeRecords = [f0, f1, absent];
const negativeIndex = caseIndex.filter(row => ['f0', 'f1'].includes(row.captureFingerprint));
const negative = closeout.deriveCloseouts({
  caseRegistry: { ...registry, reconciledThrough: absent.capturedAt, cases: [{ ...registry.cases[0], lastSeen: f1.capturedAt }] },
  caseIndex: negativeIndex,
  records: negativeRecords,
  truthEvents: [],
  evaluations: [],
  asOf: '2026-08-23T02:00:00Z'
});
const t1Closeout = negative.closeouts.find(item => item.signal === 'T1');
assert.ok(t1Closeout, 'negative case must close after the normal 24h healthy absence grace');
assert.equal(t1Closeout.forecastOutcome, 'correct-negative', 'ambiguous positive split must not create a false alarm');
assert.equal(t1Closeout.forecastEvidence.snapshotCount, 1);
assert.equal(t1Closeout.forecastEvidence.positiveSnapshotCount, 0);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('hk signal ambiguous case capture tests: OK');
