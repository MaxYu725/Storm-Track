import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const evaluator = require('../analysis/hk-signal-evaluator.js');

const prospectiveDir = path.resolve(process.argv[2] || '');
const truthDir = path.resolve(process.argv[3] || '');
if (!process.argv[2] || !process.argv[3]) {
  throw new Error('usage: node scripts/evaluate-hk-signal.mjs <prospective-corpus-dir> <hko-truth-dir>');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableSort(value) {
  if (Array.isArray(value)) return value.map(stableSort);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableSort(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableSort(value));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonIfExists(file, fallback = null) {
  return fs.existsSync(file) ? readJson(file) : fallback;
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

function key(fingerprint, groupKey) {
  return `${fingerprint || ''}\u0000${groupKey || ''}`;
}

function caseCaptureKey(caseId, fingerprint) {
  return `${caseId || ''}\u0000${fingerprint || ''}`;
}

function eventMs(event) {
  const value = Date.parse(event?.eventTime || '');
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function latestTimestamp(...values) {
  const times = values.map(value => Date.parse(value || '')).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : new Date(0).toISOString();
}

const caseRegistry = readJsonIfExists(path.join(prospectiveDir, 'case-registry.json'), {
  schemaVersion: 'storm-case-identity/v1',
  reconciledThrough: null,
  caseCount: 0,
  cases: []
});
const caseIndex = readNdjson(path.join(prospectiveDir, 'case-index.ndjson'));
const truthEvents = readNdjson(path.join(truthDir, 'truth-events.ndjson'))
  .sort((a, b) => eventMs(a) - eventMs(b));
const latestTruth = readJsonIfExists(path.join(truthDir, 'latest.json'), null);

const observationFiles = listJsonFiles(path.join(prospectiveDir, 'observations'));
const records = observationFiles.map(readJson);
const recorderSchemaCounts = {};
for (const record of records) {
  const schema = record?.schemaVersion || 'unknown';
  recorderSchemaCounts[schema] = (recorderSchemaCounts[schema] || 0) + 1;
}
const trustedRecords = records
  .filter(record => record?.schemaVersion === 'beta-prospective-recorder/v2')
  .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));

const trustedCaptureFingerprints = new Set(trustedRecords.map(record => record.captureFingerprint).filter(Boolean));
const caseCaptureRows = new Map();
for (const row of caseIndex) {
  if (!row?.caseId || !row?.captureFingerprint || !trustedCaptureFingerprints.has(row.captureFingerprint)) continue;
  const captureKey = caseCaptureKey(row.caseId, row.captureFingerprint);
  if (!caseCaptureRows.has(captureKey)) caseCaptureRows.set(captureKey, []);
  caseCaptureRows.get(captureKey).push(row);
}
const ambiguousCaseCaptures = [...caseCaptureRows.entries()]
  .filter(([, rows]) => rows.length > 1)
  .map(([captureKey, rows]) => ({
    captureKey,
    caseId: rows[0].caseId,
    captureFingerprint: rows[0].captureFingerprint,
    capturedAt: rows[0].capturedAt || null,
    rawGroupKeys: [...new Set(rows.map(row => row.rawGroupKey).filter(Boolean))].sort()
  }))
  .sort((a, b) => Date.parse(a.capturedAt || '') - Date.parse(b.capturedAt || '')
    || a.caseId.localeCompare(b.caseId));
const ambiguousCaseCaptureKeys = new Set(ambiguousCaseCaptures.map(item => item.captureKey));
const evaluationCaseIndex = caseIndex.filter(row => !ambiguousCaseCaptureKeys.has(caseCaptureKey(row.caseId, row.captureFingerprint)));

const identityByObservation = new Map();
for (const row of caseIndex) {
  identityByObservation.set(key(row.captureFingerprint, row.rawGroupKey), row);
}

const timelines = new Map();
for (const record of trustedRecords) {
  for (const observation of record.observations || []) {
    const groupKey = observation?.group?.key || null;
    const identity = identityByObservation.get(key(record.captureFingerprint, groupKey));
    if (!identity?.caseId) continue;
    if (ambiguousCaseCaptureKeys.has(caseCaptureKey(identity.caseId, record.captureFingerprint))) continue;
    if (!timelines.has(identity.caseId)) timelines.set(identity.caseId, []);
    timelines.get(identity.caseId).push({
      caseId: identity.caseId,
      capturedAt: record.capturedAt,
      captureFingerprint: record.captureFingerprint,
      rawGroupKey: groupKey,
      identityResolution: identity.resolution || null,
      observation
    });
  }
}

const signalEvents = Object.fromEntries(evaluator.SIGNALS.map(signal => [
  signal,
  truthEvents.filter(event => evaluator.isInitialSignalEvent(event, signal))
]));

function unresolvedEvaluation(signal, event, attribution) {
  return {
    schemaVersion: evaluator.VERSION,
    rubricVersion: evaluator.RUBRIC_VERSION,
    eventPolicyVersion: evaluator.EVENT_POLICY_VERSION,
    status: attribution.status,
    signal,
    caseId: null,
    attribution,
    truth: {
      signal,
      eventType: event.eventType,
      eventTime: event.eventTime,
      timeSource: event.timeSource,
      code: event?.currentTruth?.code || null,
      level: event?.currentTruth?.level ?? null,
      issueTime: event?.currentTruth?.issueTime || null,
      updateTime: event?.currentTruth?.updateTime || null,
      truthFingerprint: event.truthFingerprint || null
    },
    rubric: evaluator.RUBRIC,
    eventPolicy: evaluator.EVENT_POLICY
  };
}

const realEvaluations = [];
for (const signal of evaluator.SIGNALS) {
  for (const event of signalEvents[signal]) {
    const attribution = evaluator.attributeCase(event, evaluationCaseIndex);
    if (attribution.status !== 'attributed') {
      realEvaluations.push(unresolvedEvaluation(signal, event, attribution));
      continue;
    }
    realEvaluations.push(evaluator.evaluateSignalEvent({
      signal,
      event,
      timeline: timelines.get(attribution.caseId) || [],
      caseId: attribution.caseId,
      attribution
    }));
  }
}

function eligibleTruthBefore(signal, cutoff) {
  const cutoffMs = Date.parse(cutoff || '');
  if (!Number.isFinite(cutoffMs)) return false;
  return signalEvents[signal].some(event => {
    const ms = Date.parse(event?.eventTime || '');
    return Number.isFinite(ms) && ms <= cutoffMs;
  });
}

const skipped = [];
const skippedKeys = new Set();
for (const higher of realEvaluations.filter(item => item.status === 'evaluated')) {
  const lowerSignals = higher.signal === 'T8' ? ['T1', 'T3'] : higher.signal === 'T3' ? ['T1'] : [];
  for (const lower of lowerSignals) {
    if (eligibleTruthBefore(lower, higher.truth.eventTime)) continue;
    const skipKey = `${higher.caseId}\u0000${lower}`;
    if (skippedKeys.has(skipKey)) continue;
    skippedKeys.add(skipKey);
    skipped.push(evaluator.skippedLowerSignal({ signal: lower, higherSignalEvaluation: higher }));
  }
}

const evaluations = [...realEvaluations, ...skipped].sort((a, b) => {
  const timeDiff = Date.parse(a?.truth?.eventTime || '') - Date.parse(b?.truth?.eventTime || '');
  if (Number.isFinite(timeDiff) && timeDiff !== 0) return timeDiff;
  return evaluator.SIGNALS.indexOf(a.signal) - evaluator.SIGNALS.indexOf(b.signal);
});

function latestPrediction(caseId) {
  const timeline = timelines.get(caseId) || [];
  const row = timeline.at(-1) || null;
  if (!row) return null;
  const signals = Object.fromEntries(evaluator.SIGNALS.map(signal => {
    const prediction = evaluator.signalPrediction(row.observation, signal);
    return [signal, {
      likelihood: prediction.likelihood,
      riskIndex: prediction.riskIndex,
      confidenceIndex: prediction.confidenceIndex,
      persistenceHours: prediction.persistenceHours,
      estimatedWindow: prediction.window
    }];
  }));
  return {
    caseId,
    capturedAt: row.capturedAt,
    captureFingerprint: row.captureFingerprint,
    rawGroupKey: row.rawGroupKey,
    displayName: row.observation?.group?.displayName || null,
    likelihood: signals.T1.likelihood,
    estimatedWindow: signals.T1.estimatedWindow,
    signals,
    sourceAgencies: row.observation?.sourceAgencies || [],
    engineVersions: row.observation?.engineVersions || null
  };
}

const pseudoEvent = {
  eventTime: latestTimestamp(latestTruth?.retrievedAt, caseRegistry?.reconciledThrough),
  currentTruth: latestTruth?.truth || null
};
const candidates = evaluator.candidateCasesForEvent(pseudoEvent, evaluationCaseIndex);
const activeCaseIds = [...new Set(candidates.map(row => row.caseId))];
const completedByCase = new Map();
for (const item of evaluations.filter(item => item.caseId && (item.status === 'evaluated' || item.status === 'not-issued'))) {
  if (!completedByCase.has(item.caseId)) completedByCase.set(item.caseId, new Set());
  completedByCase.get(item.caseId).add(item.signal);
}
const pendingSignalsByCase = Object.fromEntries(activeCaseIds.map(caseId => [
  caseId,
  evaluator.SIGNALS.filter(signal => !completedByCase.get(caseId)?.has(signal))
]));

const awaiting = {
  status: signalEvents.T1.length ? 'monitoring-higher-signals' : 'awaiting-tc1',
  activeHkoCaseIds: activeCaseIds,
  pendingSignalsByCase,
  latestPredictions: activeCaseIds.map(latestPrediction).filter(Boolean),
  latestHkoTruth: latestTruth ? {
    retrievedAt: latestTruth.retrievedAt,
    truthFingerprint: latestTruth.truthFingerprint,
    truth: latestTruth.truth,
    context: latestTruth.context
  } : null
};

const signalEventCounts = Object.fromEntries(evaluator.SIGNALS.map(signal => [signal, signalEvents[signal].length]));
const hasTruthEvents = Object.values(signalEventCounts).some(count => count > 0);
const hasEvaluated = evaluations.some(item => item.status === 'evaluated');
const material = {
  schemaVersion: evaluator.VERSION,
  rubricVersion: evaluator.RUBRIC_VERSION,
  eventPolicyVersion: evaluator.EVENT_POLICY_VERSION,
  rubric: evaluator.RUBRIC,
  eventPolicy: evaluator.EVENT_POLICY,
  prospective: {
    caseIdentitySchemaVersion: caseRegistry.schemaVersion || null,
    reconciledThrough: caseRegistry.reconciledThrough || null,
    trustedRecorderSchema: 'beta-prospective-recorder/v2',
    trustedRecordCount: trustedRecords.length,
    recorderSchemaCounts,
    excludedRecordCount: records.length - trustedRecords.length,
    excludedAmbiguousCaseCaptureCount: ambiguousCaseCaptures.length,
    excludedAmbiguousCaseCaptures: ambiguousCaseCaptures.map(({ captureKey, ...item }) => item),
    caseCount: caseRegistry.caseCount || caseRegistry.cases?.length || 0
  },
  hkoTruth: {
    latestRetrievedAt: latestTruth?.retrievedAt || null,
    latestTruthFingerprint: latestTruth?.truthFingerprint || null,
    eventCount: truthEvents.length,
    initialTc1IssueCount: signalEvents.T1.length,
    signalEventCounts
  },
  status: !hasTruthEvents ? 'awaiting-tc1' : hasEvaluated ? 'evaluated' : 'truth-unresolved',
  awaiting,
  evaluations
};

const evaluationFingerprint = sha256(stableJson(material));
const output = {
  ...material,
  generatedAt: new Date().toISOString(),
  sourceCommit: process.env.SOURCE_COMMIT || null,
  evaluationFingerprint
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
