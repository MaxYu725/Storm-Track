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

const caseRegistry = readJsonIfExists(path.join(prospectiveDir, 'case-registry.json'), {
  schemaVersion: 'storm-case-identity/v1',
  reconciledThrough: null,
  caseCount: 0,
  cases: []
});
const caseIndex = readNdjson(path.join(prospectiveDir, 'case-index.ndjson'));
const truthEvents = readNdjson(path.join(truthDir, 'truth-events.ndjson'));
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

const tc1Events = truthEvents.filter(evaluator.isInitialTc1Issue);
const evaluations = tc1Events.map(event => {
  const attribution = evaluator.attributeCase(event, caseIndex);
  if (attribution.status !== 'attributed') {
    return {
      schemaVersion: evaluator.VERSION,
      rubricVersion: evaluator.RUBRIC_VERSION,
      status: attribution.status,
      caseId: null,
      attribution,
      truth: {
        eventType: event.eventType,
        eventTime: event.eventTime,
        timeSource: event.timeSource,
        code: event?.currentTruth?.code || null,
        level: event?.currentTruth?.level ?? null,
        issueTime: event?.currentTruth?.issueTime || null,
        truthFingerprint: event.truthFingerprint || null
      },
      rubric: evaluator.RUBRIC
    };
  }
  return evaluator.evaluateTc1Event({
    event,
    timeline: timelines.get(attribution.caseId) || [],
    caseId: attribution.caseId,
    attribution
  });
});

function latestPrediction(caseId) {
  const timeline = timelines.get(caseId) || [];
  const row = timeline.at(-1) || null;
  if (!row) return null;
  const prediction = evaluator.t1Prediction(row.observation);
  return {
    caseId,
    capturedAt: row.capturedAt,
    captureFingerprint: row.captureFingerprint,
    rawGroupKey: row.rawGroupKey,
    displayName: row.observation?.group?.displayName || null,
    likelihood: prediction.likelihood,
    estimatedWindow: prediction.window,
    sourceAgencies: row.observation?.sourceAgencies || [],
    engineVersions: row.observation?.engineVersions || null
  };
}

let awaiting = null;
if (!tc1Events.length) {
  const pseudoEvent = {
    eventTime: latestTruth?.retrievedAt || caseRegistry?.reconciledThrough || new Date(0).toISOString(),
    currentTruth: latestTruth?.truth || null
  };
  const candidates = evaluator.candidateCasesForEvent(pseudoEvent, caseIndex);
  const caseIds = [...new Set(candidates.map(row => row.caseId))];
  awaiting = {
    status: 'awaiting-tc1',
    activeHkoCaseIds: caseIds,
    latestPredictions: caseIds.map(latestPrediction).filter(Boolean),
    latestHkoTruth: latestTruth ? {
      retrievedAt: latestTruth.retrievedAt,
      truthFingerprint: latestTruth.truthFingerprint,
      truth: latestTruth.truth,
      context: latestTruth.context
    } : null
  };
}

const material = {
  schemaVersion: evaluator.VERSION,
  rubricVersion: evaluator.RUBRIC_VERSION,
  rubric: evaluator.RUBRIC,
  prospective: {
    caseIdentitySchemaVersion: caseRegistry.schemaVersion || null,
    reconciledThrough: caseRegistry.reconciledThrough || null,
    trustedRecorderSchema: 'beta-prospective-recorder/v2',
    trustedRecordCount: trustedRecords.length,
    recorderSchemaCounts,
    excludedRecordCount: records.length - trustedRecords.length,
    caseCount: caseRegistry.caseCount || caseRegistry.cases?.length || 0
  },
  hkoTruth: {
    latestRetrievedAt: latestTruth?.retrievedAt || null,
    latestTruthFingerprint: latestTruth?.truthFingerprint || null,
    eventCount: truthEvents.length,
    initialTc1IssueCount: tc1Events.length
  },
  status: tc1Events.length ? (evaluations.some(item => item.status === 'evaluated') ? 'evaluated' : 'truth-unresolved') : 'awaiting-tc1',
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
