import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'storm-track-closeout-awaiting-'));
const prospectiveDir = path.join(tempRoot, 'prospective');
const truthDir = path.join(tempRoot, 'truth');
const observationsDir = path.join(prospectiveDir, 'observations');
const rawEvaluationFile = path.join(tempRoot, 'raw-evaluation.json');
const closedCaseId = 'STC-2026-JMA-TC2622';
const openCaseId = 'STC-2026-JMA-TC9999';

function observation(t1 = 'possible') {
  const signal = likelihood => ({
    likelihood,
    riskIndex: likelihood === 'unlikely' ? 0.2 : 0.4,
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
          T1: signal(t1),
          T3: signal('unlikely'),
          T8: signal('unlikely')
        }
      }
    }
  };
}

function record(capturedAt, fingerprint, present) {
  return {
    schemaVersion: 'beta-prospective-recorder/v2',
    capturedAt,
    captureFingerprint: fingerprint,
    sourceStates: ['HKO', 'CMA', 'JMA', 'CWA'].map(agency => ({ agency, state: 'ok' })),
    observations: present ? [observation()] : []
  };
}

try {
  fs.mkdirSync(observationsDir, { recursive: true });
  fs.mkdirSync(truthDir, { recursive: true });

  const present = record('2026-08-22T00:00:00Z', 'f0', true);
  const absent = record('2026-08-22T01:00:00Z', 'f1', false);

  fs.writeFileSync(path.join(prospectiveDir, 'case-registry.json'), JSON.stringify({
    schemaVersion: 'storm-case-identity/v1',
    cases: [{
      caseId: closedCaseId,
      firstSeen: '2026-08-22T00:00:00Z',
      lastSeen: '2026-08-22T00:00:00Z',
      sourceTokens: ['HKO:2629', 'JMA:TC2622']
    }]
  }));
  fs.writeFileSync(path.join(prospectiveDir, 'case-index.ndjson'), `${JSON.stringify({
    captureFingerprint: 'f0',
    rawGroupKey: 'NARRA',
    caseId: closedCaseId
  })}\n`);
  fs.writeFileSync(path.join(observationsDir, '000-present.json'), JSON.stringify(present));
  fs.writeFileSync(path.join(observationsDir, '001-absent.json'), JSON.stringify(absent));
  fs.writeFileSync(path.join(truthDir, 'truth-events.ndjson'), '');

  fs.writeFileSync(rawEvaluationFile, JSON.stringify({
    schemaVersion: 'hk-signal-evaluator/v2',
    status: 'awaiting-tc1',
    awaiting: {
      status: 'awaiting-tc1',
      activeHkoCaseIds: [closedCaseId, openCaseId],
      pendingSignalsByCase: {
        [closedCaseId]: ['T1', 'T3', 'T8'],
        [openCaseId]: ['T1', 'T3', 'T8']
      },
      latestPredictions: [
        { caseId: closedCaseId, likelihood: 'possible' },
        { caseId: openCaseId, likelihood: 'possible' }
      ],
      latestHkoTruth: null
    },
    evaluations: []
  }));

  const stdout = execFileSync(process.execPath, [
    path.join(repoRoot, 'scripts/apply-hk-signal-closeouts.mjs'),
    rawEvaluationFile,
    prospectiveDir,
    truthDir
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLOSEOUT_AS_OF: '2026-08-23T01:00:00Z'
    }
  });

  const output = JSON.parse(stdout);
  assert.deepEqual(output.closeouts.map(item => item.signal), ['T1', 'T3', 'T8']);
  assert.deepEqual(output.awaiting.activeHkoCaseIds, [openCaseId]);
  assert.deepEqual(output.awaiting.pendingSignalsByCase, {
    [openCaseId]: ['T1', 'T3', 'T8']
  });
  assert.deepEqual(output.awaiting.latestPredictions.map(item => item.caseId), [openCaseId]);
  assert.equal(output.awaiting.pendingSignalsByCase[closedCaseId], undefined);

  console.log('hk signal closeout awaiting reconciliation tests: OK');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
