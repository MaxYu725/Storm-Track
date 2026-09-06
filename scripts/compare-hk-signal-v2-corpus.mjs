import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const v2engine = require('../analysis/hk-signal-forecast-v2.js');

const prospectiveDir = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!prospectiveDir) {
  throw new Error('usage: node scripts/compare-hk-signal-v2-corpus.mjs <beta-prospective-corpus-dir>');
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
  const output = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith('.json')) output.push(full);
    }
  }
  return output.sort();
}

function observationKey(fingerprint, groupKey) {
  return `${fingerprint || ''}\u0000${groupKey || ''}`;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positive(likelihood) {
  return likelihood === 'possible' || likelihood === 'likely';
}

function emptySignalStats() {
  return {
    snapshots: 0,
    positive: 0,
    possible: 0,
    likely: 0,
    maxRisk: null,
    firstPositiveAt: null,
    firstLikelyAt: null,
    lastPositiveAt: null
  };
}

function updateSignalStats(stats, signal, capturedAt) {
  stats.snapshots += 1;
  const likelihood = signal?.likelihood || 'unknown';
  if (likelihood === 'possible') stats.possible += 1;
  if (likelihood === 'likely') stats.likely += 1;
  if (positive(likelihood)) {
    stats.positive += 1;
    if (!stats.firstPositiveAt) stats.firstPositiveAt = capturedAt;
    stats.lastPositiveAt = capturedAt;
  }
  if (likelihood === 'likely' && !stats.firstLikelyAt) stats.firstLikelyAt = capturedAt;
  const risk = finite(signal?.riskIndex);
  if (Number.isFinite(risk)) stats.maxRisk = stats.maxRisk == null ? risk : Math.max(stats.maxRisk, risk);
}

function newCase(caseId, displayName) {
  return {
    caseId,
    displayName: displayName || caseId,
    firstCapturedAt: null,
    lastCapturedAt: null,
    captureCount: 0,
    signals: Object.fromEntries(['T1', 'T3', 'T8'].map(code => [code, {
      v1: emptySignalStats(),
      v2: emptySignalStats(),
      transitions: {
        unchanged: 0,
        likelyToPossible: 0,
        positiveToUnlikely: 0,
        other: 0
      },
      timingStates: {},
      readinessAppliedCount: 0,
      longHorizonAdjustmentCount: 0
    }])),
    phaseStates: {},
    multiPhaseCaptureCount: 0,
    sourceCoverageAdjustmentCount: 0,
    terminalAdjustmentCount: 0,
    departureAdjustmentCount: 0
  };
}

function transitionBucket(v1, v2) {
  if (v1 === v2) return 'unchanged';
  if (v1 === 'likely' && v2 === 'possible') return 'likelyToPossible';
  if (positive(v1) && v2 === 'unlikely') return 'positiveToUnlikely';
  return 'other';
}

function sourceLifecycle(observation, capturedAt) {
  return v2engine.buildSourceLifecycleContext(
    observation?.sources || {},
    observation?.observedAt || capturedAt,
    { sourcesDirect: true }
  );
}

const records = listJsonFiles(path.join(prospectiveDir, 'observations'))
  .map(readJson)
  .filter(record => record?.schemaVersion === 'beta-prospective-recorder/v2')
  .filter(record => Number.isFinite(Date.parse(record?.capturedAt || '')))
  .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
const caseIndex = readNdjson(path.join(prospectiveDir, 'case-index.ndjson'));
const identity = new Map(caseIndex.map(row => [
  observationKey(row.captureFingerprint, row.rawGroupKey),
  row
]));

const cases = new Map();
let observationCount = 0;
let unresolvedIdentityCount = 0;

for (const record of records) {
  for (const observation of record?.observations || []) {
    const groupKey = observation?.group?.key || null;
    const row = identity.get(observationKey(record.captureFingerprint, groupKey));
    const caseId = row?.caseId || `UNRESOLVED:${groupKey || 'unknown'}`;
    if (!row?.caseId) unresolvedIdentityCount += 1;
    if (!cases.has(caseId)) cases.set(caseId, newCase(caseId, observation?.group?.displayName || groupKey));
    const target = cases.get(caseId);
    const analysis = observation?.analysis || {};
    if (analysis?.basicForecast?.available !== true) continue;

    const lifecycle = sourceLifecycle(observation, record.capturedAt);
    const v2 = v2engine.buildForecast({
      basicForecast: analysis.basicForecast,
      signalInputs: analysis.signalInputs,
      threatAssessment: analysis.threatAssessment,
      generatedAt: analysis.generatedAt || analysis.basicForecast.generatedAt || record.capturedAt,
      sourceLifecycle: lifecycle
    });
    if (v2?.available !== true) continue;

    observationCount += 1;
    target.captureCount += 1;
    if (!target.firstCapturedAt) target.firstCapturedAt = record.capturedAt;
    target.lastCapturedAt = record.capturedAt;

    const phase = v2?.shadow?.diagnostics?.phaseContext?.operationalPhase || 'unavailable';
    target.phaseStates[phase] = (target.phaseStates[phase] || 0) + 1;
    if (v2?.shadow?.diagnostics?.phaseContext?.multiPhase === true) target.multiPhaseCaptureCount += 1;
    const adjustments = v2?.shadow?.adjustments || [];
    if (adjustments.some(item => item.code === 'source-coverage-confidence-v2')) target.sourceCoverageAdjustmentCount += 1;
    if (adjustments.some(item => item.code === 'terminal-stale-lifecycle-decay')) target.terminalAdjustmentCount += 1;
    if (adjustments.some(item => item.code === 'post-minimum-departure-decay')) target.departureAdjustmentCount += 1;

    for (const code of ['T1', 'T3', 'T8']) {
      const v1Signal = analysis?.basicForecast?.signals?.[code] || null;
      const v2Signal = v2?.signals?.[code] || null;
      const signalStats = target.signals[code];
      updateSignalStats(signalStats.v1, v1Signal, record.capturedAt);
      updateSignalStats(signalStats.v2, v2Signal, record.capturedAt);
      const bucket = transitionBucket(v1Signal?.likelihood, v2Signal?.likelihood);
      signalStats.transitions[bucket] += 1;
      const timing = v2Signal?.timingState || 'unavailable';
      signalStats.timingStates[timing] = (signalStats.timingStates[timing] || 0) + 1;
      if (adjustments.some(item => item.code === 't1-likely-readiness') && code === 'T1') {
        signalStats.readinessAppliedCount += 1;
      }
      if (adjustments.some(item => item.code === `${code.toLowerCase()}-long-horizon-evidence`)) {
        signalStats.longHorizonAdjustmentCount += 1;
      }
    }
  }
}

const material = {
  schemaVersion: 'hk-signal-v2-corpus-comparison/v1',
  v2Version: v2engine.VERSION,
  prospectiveRecorderSchema: 'beta-prospective-recorder/v2',
  recordCount: records.length,
  observationCount,
  unresolvedIdentityCount,
  caseCount: cases.size,
  cases: [...cases.values()].sort((a, b) => a.caseId.localeCompare(b.caseId)),
  interpretation: {
    purpose: 'retrospective shadow recomputation from immutable prospective derived snapshots',
    truthUsedInForecastCalculation: false,
    v1Mutated: false,
    promotionDecisionImplied: false
  }
};

process.stdout.write(`${JSON.stringify(material, null, 2)}\n`);