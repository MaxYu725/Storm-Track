import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'storm-track-closeout-coverage-'));
const prospectiveDir = path.join(tempRoot, 'prospective');
const truthDir = path.join(tempRoot, 'truth');
const observationsDir = path.join(prospectiveDir, 'observations');
const rawEvaluationFile = path.join(tempRoot, 'raw-evaluation.json');
const caseId = 'STC-2026-JMA-TC2622';

function observation() {
  const signal = likelihood => ({
    likelihood,
    riskIndex: likelihood === 'unlikely' ? 0.2 : 0.4,
    confidenceIndex: 0.5,
    persistenceHours: likelihood === 'unlikely' ? 0 : 6,
    estimatedWindow: null
  });
  return {
    group: { key: 'NARRA', displayName: '紫檀 (NARRA)' },
    analysis: {
      basicForecast: {
        signals: {
          T1: signal('possible'),
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

function runApply(asOf) {
  return JSON.parse(execFileSync(process.execPath, [
    path.join(repoRoot, 'scripts/apply-hk-signal-closeouts.mjs'),
    rawEvaluationFile,
    prospectiveDir,
    truthDir
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, CLOSEOUT_AS_OF: asOf }
  }));
}

try {
  fs.mkdirSync(observationsDir, { recursive: true });
  fs.mkdirSync(truthDir, { recursive: true });

  const presentAt = '2026-08-28T09:10:00.000Z';
  const present = record(presentAt, 'p0', true);
  const records = [present];
  for (let minute = 30; minute <= 24 * 60 + 60; minute += 30) {
    const capturedAt = new Date(Date.parse(presentAt) + minute * 60000).toISOString();
    records.push(record(capturedAt, `p${minute}`, false));
  }

  fs.writeFileSync(path.join(prospectiveDir, 'case-registry.json'), JSON.stringify({
    schemaVersion: 'storm-case-identity/v1',
    cases: [{
      caseId,
      firstSeen: presentAt,
      lastSeen: presentAt,
      sourceTokens: ['HKO:2629', 'JMA:TC2622']
    }]
  }));
  fs.writeFileSync(path.join(prospectiveDir, 'case-index.ndjson'), `${JSON.stringify({
    captureFingerprint: 'p0',
    rawGroupKey: 'NARRA',
    caseId
  })}\n`);
  records.forEach((item, index) => {
    fs.writeFileSync(path.join(observationsDir, `${String(index).padStart(3, '0')}.json`), JSON.stringify(item));
  });
  fs.writeFileSync(path.join(truthDir, 'truth-events.ndjson'), '');

  fs.writeFileSync(rawEvaluationFile, JSON.stringify({
    schemaVersion: 'hk-signal-evaluator/v2',
    status: 'awaiting-tc1',
    awaiting: {
      status: 'awaiting-tc1',
      activeHkoCaseIds: [caseId],
      pendingSignalsByCase: { [caseId]: ['T1', 'T3', 'T8'] },
      latestPredictions: [{ caseId, likelihood: 'possible' }],
      latestHkoTruth: null
    },
    evaluations: []
  }));

  const asOf = '2026-08-29T10:10:00.000Z';
  const blocked = runApply(asOf);
  assert.equal(blocked.closeouts.length, 0);
  assert.equal(blocked.closeoutBlocked.length, 3);
  assert.ok(blocked.closeoutBlocked.every(item => item.reason === 'evidence-coverage-incomplete'));
  assert.ok(blocked.closeoutBlocked.every(item => item.detail === 'truth-health-history-unavailable'));
  assert.deepEqual(blocked.awaiting.activeHkoCaseIds, [caseId]);

  const health = [];
  for (let minute = 30; minute <= 24 * 60 + 60; minute += 30) {
    const retrievedAt = new Date(Date.parse(presentAt) + minute * 60000).toISOString();
    health.push({
      schemaVersion: 'hko-warning-truth-health/v1',
      retrievedAt,
      captureFingerprint: `h${minute}`,
      truthFingerprint: 'truth',
      sourceCommit: 'test'
    });
  }
  fs.writeFileSync(path.join(truthDir, 'health.ndjson'), `${health.map(item => JSON.stringify(item)).join('\n')}\n`);

  const covered = runApply(asOf);
  assert.deepEqual(covered.closeouts.map(item => item.signal), ['T1', 'T3', 'T8']);
  assert.ok(covered.closeouts.every(item => item.closedAt === '2026-08-29T09:40:00.000Z'));
  assert.ok(covered.closeouts.every(item => item.evidenceCoverage?.status === 'covered'));
  assert.deepEqual(covered.awaiting.activeHkoCaseIds, []);
  assert.deepEqual(covered.awaiting.pendingSignalsByCase, {});

  console.log('hk signal closeout evidence coverage tests: OK');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
