import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const closeout = require('../analysis/hk-signal-closeout.js');
const coverage = require('../analysis/hk-signal-evidence-coverage.js');

const rawEvaluationFile = path.resolve(process.argv[2] || '');
const prospectiveDir = path.resolve(process.argv[3] || '');
const truthDir = path.resolve(process.argv[4] || '');
if (!process.argv[2] || !process.argv[3] || !process.argv[4]) {
  throw new Error('usage: node scripts/apply-hk-signal-closeouts.mjs <raw-evaluation.json> <prospective-corpus-dir> <hko-truth-dir>');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readNdjson(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function listJsonFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(full);
    }
  }
  return files.sort();
}

function stableSort(value) {
  if (Array.isArray(value)) return value.map(stableSort);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableSort(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableSort(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function reconcileAwaiting(awaiting, derivedCloseouts) {
  if (!awaiting || typeof awaiting !== 'object') return awaiting;

  const completedByCase = new Map();
  for (const item of derivedCloseouts || []) {
    if (!item?.caseId || !item?.signal) continue;
    if (!completedByCase.has(item.caseId)) completedByCase.set(item.caseId, new Set());
    completedByCase.get(item.caseId).add(item.signal);
  }

  const pendingSignalsByCase = {};
  const resolvedCaseIds = new Set();
  for (const [caseId, rawSignals] of Object.entries(awaiting.pendingSignalsByCase || {})) {
    const signals = Array.isArray(rawSignals) ? rawSignals : [];
    const completed = completedByCase.get(caseId) || new Set();
    const pending = signals.filter(signal => !completed.has(signal));
    if (pending.length) pendingSignalsByCase[caseId] = pending;
    else resolvedCaseIds.add(caseId);
  }

  const activeHkoCaseIds = (awaiting.activeHkoCaseIds || [])
    .filter(caseId => !resolvedCaseIds.has(caseId));
  const latestPredictions = (awaiting.latestPredictions || [])
    .filter(item => !resolvedCaseIds.has(item?.caseId));

  return {
    ...awaiting,
    activeHkoCaseIds,
    pendingSignalsByCase,
    latestPredictions
  };
}

const raw = readJson(rawEvaluationFile);
const caseRegistry = readJson(path.join(prospectiveDir, 'case-registry.json'));
const caseIndex = readNdjson(path.join(prospectiveDir, 'case-index.ndjson'));
const prospectiveHealthRecords = readNdjson(path.join(prospectiveDir, 'health.ndjson'));
const truthEvents = readNdjson(path.join(truthDir, 'truth-events.ndjson'));
const truthHealthRecords = readNdjson(path.join(truthDir, 'health.ndjson'));
const records = listJsonFiles(path.join(prospectiveDir, 'observations')).map(readJson);
const asOf = process.env.CLOSEOUT_AS_OF || new Date().toISOString();

const trustedRecords = records
  .filter(record => record?.schemaVersion === 'beta-prospective-recorder/v2')
  .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
const recordsByFingerprint = new Map(trustedRecords
  .filter(record => record?.captureFingerprint)
  .map(record => [record.captureFingerprint, record]));

function buildCoverageRecords() {
  const rows = [...trustedRecords];
  for (const heartbeat of prospectiveHealthRecords) {
    if (heartbeat?.schemaVersion !== 'beta-prospective-health/v1') continue;
    const base = recordsByFingerprint.get(heartbeat.captureFingerprint) || null;
    if (!base || !Number.isFinite(Date.parse(heartbeat?.capturedAt || ''))) continue;
    rows.push({
      ...base,
      capturedAt: heartbeat.capturedAt,
      sourceStates: Array.isArray(heartbeat.sourceStates) ? heartbeat.sourceStates : base.sourceStates,
      visibleGroupKeys: Array.isArray(heartbeat.visibleGroupKeys) ? heartbeat.visibleGroupKeys : base.visibleGroupKeys,
      coverageHeartbeat: true
    });
  }
  const deduped = new Map();
  for (const row of rows) {
    const rowKey = `${row.capturedAt || ''}\u0000${row.captureFingerprint || ''}`;
    if (!deduped.has(rowKey) || !row.coverageHeartbeat) deduped.set(rowKey, row);
  }
  return [...deduped.values()]
    .filter(row => Number.isFinite(Date.parse(row?.capturedAt || '')))
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
}

const coverageRecords = buildCoverageRecords();

const derived = closeout.deriveCloseouts({
  caseRegistry,
  caseIndex,
  records,
  truthEvents,
  evaluations: raw.evaluations || [],
  asOf
});

const registryByCase = new Map((caseRegistry?.cases || []).map(item => [item.caseId, item]));
const guardedCloseouts = [];
const coverageBlocked = [];
const effectiveMs = Date.parse(coverage.EFFECTIVE_AT);

for (const item of derived.closeouts) {
  if (item.closeoutReason !== 'case-inactive-after-healthy-absence') {
    guardedCloseouts.push(item);
    continue;
  }

  const originalClosedMs = Date.parse(item.closedAt || '');
  if (Number.isFinite(originalClosedMs) && Number.isFinite(effectiveMs) && originalClosedMs < effectiveMs) {
    guardedCloseouts.push({
      ...item,
      evidenceCoveragePolicyVersion: coverage.VERSION,
      evidenceCoverage: {
        policyVersion: coverage.VERSION,
        status: 'grandfathered-pre-policy',
        effectiveAt: coverage.EFFECTIVE_AT
      }
    });
    continue;
  }

  const stormCase = registryByCase.get(item.caseId) || null;
  const joint = coverage.findJointNoSignalCoverage({
    caseId: item.caseId,
    records: coverageRecords,
    caseIndex,
    truthHealthRecords,
    afterAt: stormCase?.lastSeen || null,
    asOf,
    durationHours: closeout.INACTIVE_GRACE_HOURS
  });

  if (!joint.complete) {
    coverageBlocked.push({
      caseId: item.caseId,
      signal: item.signal,
      reason: 'evidence-coverage-incomplete',
      detail: joint.reason,
      afterAt: stormCase?.lastSeen || null,
      checkedAt: asOf,
      evidenceCoveragePolicyVersion: coverage.VERSION,
      evidenceCoverageEffectiveAt: coverage.EFFECTIVE_AT,
      prospectiveHealthRecordCount: prospectiveHealthRecords.length,
      truthHealthRecordCount: truthHealthRecords.length,
      prospectiveMaxGapMinutes: coverage.PROSPECTIVE_MAX_GAP_MINUTES,
      truthHealthMaxGapMinutes: coverage.TRUTH_HEALTH_MAX_GAP_MINUTES
    });
    continue;
  }

  if (Date.parse(joint.closedAt) > Date.parse(asOf)) {
    coverageBlocked.push({
      caseId: item.caseId,
      signal: item.signal,
      reason: 'evidence-coverage-grace-pending',
      afterAt: stormCase?.lastSeen || null,
      coverageStartedAt: joint.coverageStartedAt,
      projectedCloseAt: joint.closedAt,
      checkedAt: asOf,
      evidenceCoveragePolicyVersion: coverage.VERSION
    });
    continue;
  }

  guardedCloseouts.push({
    ...item,
    closedAt: joint.closedAt,
    evidenceAt: joint.evidenceAt,
    evidenceCoveragePolicyVersion: coverage.VERSION,
    evidenceCoverage: {
      policyVersion: coverage.VERSION,
      status: 'covered',
      coverageStartedAt: joint.coverageStartedAt,
      coverageThrough: joint.coverageThrough,
      durationHours: joint.durationHours,
      prospectiveMaxGapMinutes: joint.prospectiveMaxGapMinutes,
      truthMaxGapMinutes: joint.truthMaxGapMinutes,
      prospectiveSegment: joint.prospectiveSegment,
      truthSegment: joint.truthSegment
    }
  });
}

guardedCloseouts.sort((a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt)
  || a.caseId.localeCompare(b.caseId)
  || a.signal.localeCompare(b.signal));
const guardedBlocked = [...derived.blocked, ...coverageBlocked].sort((a, b) =>
  String(a.caseId || '').localeCompare(String(b.caseId || ''))
  || String(a.signal || '').localeCompare(String(b.signal || ''))
  || String(a.reason || '').localeCompare(String(b.reason || '')));

const material = structuredClone(raw);
delete material.generatedAt;
delete material.sourceCommit;
delete material.evaluationFingerprint;
material.evidenceCoveragePolicyVersion = coverage.VERSION;
material.evidenceCoveragePolicy = coverage.POLICY;
material.closeoutPolicyVersion = closeout.POLICY_VERSION;
material.closeoutPolicy = closeout.POLICY;
material.closeoutSummary = {
  closeoutCount: guardedCloseouts.length,
  blockedCount: guardedBlocked.length,
  classifications: guardedCloseouts.reduce((counts, item) => {
    counts[item.forecastOutcome] = (counts[item.forecastOutcome] || 0) + 1;
    return counts;
  }, {})
};
material.closeouts = guardedCloseouts;
material.closeoutBlocked = guardedBlocked;
material.awaiting = reconcileAwaiting(material.awaiting, guardedCloseouts);

const evaluationFingerprint = sha256(stableJson(material));
const output = {
  ...material,
  closeoutCheckedAt: asOf,
  generatedAt: new Date().toISOString(),
  sourceCommit: raw.sourceCommit || process.env.SOURCE_COMMIT || null,
  evaluationFingerprint
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
