import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchCmaHistoricalCase } from './cma-historical-adapter.mjs';

const require = createRequire(import.meta.url);
const analysisCore = require('../analysis/storm-analysis-core.js');
const impactEngine = require('../analysis/hk-impact-engine.js');
const signalInputsEngine = require('../analysis/hko-signal-risk-inputs.js');
const threatEngine = require('../analysis/hk-threat-assessment.js');
const basicForecastEngine = require('../analysis/basic-hk-signal-forecast.js');

export const REPLAY_VERSION = 'historical-frozen-v1-replay/v1';
export const FIXED_HORIZONS_HOURS = Object.freeze([48, 24, 12, 6, 3]);
const HOUR_MS = 3600000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function timeMs(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : null;
}

function iso(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function signalTruthEvent(manifest, signal) {
  const lifecycle = Array.isArray(manifest?.truth?.signalLifecycle) ? manifest.truth.signalLifecycle : [];
  if (signal === 'T8') return lifecycle.find(item => /^T8/i.test(String(item?.signal || ''))) || null;
  return lifecycle.find(item => String(item?.signal || '').toUpperCase() === signal) || null;
}

export function selectRecordAtOrBefore(records, targetTime) {
  const targetMs = timeMs(targetTime);
  if (!Number.isFinite(targetMs)) return null;
  const eligible = (Array.isArray(records) ? records : [])
    .filter(item => Number.isFinite(timeMs(item?.asOf)) && timeMs(item.asOf) <= targetMs)
    .sort((a, b) => timeMs(a.asOf) - timeMs(b.asOf));
  return eligible.at(-1) || null;
}

export function evaluateEstimatedWindow(actualIssueTime, window) {
  const actualMs = timeMs(actualIssueTime);
  const startMs = timeMs(window?.start);
  const endMs = timeMs(window?.end);
  if (!Number.isFinite(actualMs) || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return { status: 'no-window', inside: null, nearestBoundaryHours: null };
  }
  if (actualMs >= startMs && actualMs <= endMs) {
    return { status: 'inside', inside: true, nearestBoundaryHours: 0 };
  }
  const nearestBoundaryHours = Math.min(Math.abs(actualMs - startMs), Math.abs(actualMs - endMs)) / HOUR_MS;
  return {
    status: actualMs < startMs ? 'window-after-issue' : 'window-before-issue',
    inside: false,
    nearestBoundaryHours
  };
}

function buildSourceGroup(manifest, historicalSnapshot) {
  return {
    key: manifest.caseId,
    displayName: `${manifest.storm.nameZh} (${manifest.storm.nameEn})`,
    nameTc: manifest.storm.nameZh,
    nameEn: manifest.storm.nameEn,
    sources: { CMA: historicalSnapshot.source }
  };
}

export function runFrozenV1Forecast(manifest, historicalSnapshot) {
  assert(manifest?.safety?.currentV1ModelFrozen === true, `${manifest?.caseId || 'case'}: frozen-v1 guard is required`);
  assert(manifest?.safety?.truthMayNotBeUsedAsForecastInput === true, `${manifest?.caseId || 'case'}: truth/input separation guard is required`);
  assert(historicalSnapshot?.provenance?.futureSourceLeakage === false, `${manifest.caseId}: historical source leakage guard failed`);

  const group = buildSourceGroup(manifest, historicalSnapshot);
  const snapshot = analysisCore.buildStormAnalysisSnapshot(group, { generatedAt: historicalSnapshot.asOf });
  const impact = impactEngine.buildHongKongImpact(snapshot);
  const signalInputs = signalInputsEngine.buildHkoSignalRiskInputs(snapshot, impact, group, {});
  assert(signalInputs?.officialHkoWarningContext?.provided === false, `${manifest.caseId}: HKO truth leaked into forecast input`);
  const threatAssessment = threatEngine.buildHkThreatAssessment({
    snapshot,
    impact,
    signalInputs,
    generatedAt: historicalSnapshot.asOf
  });
  const forecast = basicForecastEngine.buildBasicHkSignalForecast({
    impact,
    signalInputs,
    threatAssessment,
    generatedAt: historicalSnapshot.asOf
  });

  return {
    asOf: historicalSnapshot.asOf,
    sourceProvenance: historicalSnapshot.provenance,
    usableAgencies: snapshot?.coverage?.usableAgencies || [],
    impactUncertainty: impact?.uncertainty?.level ?? null,
    threatAvailable: threatAssessment?.available === true,
    forecastAvailable: forecast?.available === true,
    forecast
  };
}

function signalSnapshot(record, signal) {
  const value = record?.forecast?.signals?.[signal];
  return value ? {
    likelihood: value.likelihood ?? null,
    riskIndex: value.riskIndex ?? null,
    confidenceIndex: value.confidenceIndex ?? null,
    estimatedWindow: value.estimatedWindow ?? null,
    persistenceHours: value.persistenceHours ?? null
  } : null;
}

function activeLikelihood(value) {
  return value === 'possible' || value === 'likely';
}

function leadHours(issueTime, snapshotTime) {
  const issueMs = timeMs(issueTime);
  const snapshotMs = timeMs(snapshotTime);
  return Number.isFinite(issueMs) && Number.isFinite(snapshotMs) ? (issueMs - snapshotMs) / HOUR_MS : null;
}

function buildSignalDiagnostics(records, signal, issueTime) {
  const issueMs = timeMs(issueTime);
  const preIssue = records.filter(item => Number.isFinite(timeMs(item.asOf)) && timeMs(item.asOf) < issueMs);
  const active = preIssue.filter(item => activeLikelihood(item?.forecast?.signals?.[signal]?.likelihood));
  const firstPossible = active[0] || null;

  let firstStablePossible = null;
  for (let index = 0; index < preIssue.length; index += 1) {
    if (!activeLikelihood(preIssue[index]?.forecast?.signals?.[signal]?.likelihood)) continue;
    const later = preIssue.slice(index);
    if (later.every(item => activeLikelihood(item?.forecast?.signals?.[signal]?.likelihood))) {
      firstStablePossible = preIssue[index];
      break;
    }
  }

  let stateFlips = 0;
  let previous = null;
  for (const item of preIssue) {
    const state = activeLikelihood(item?.forecast?.signals?.[signal]?.likelihood);
    if (previous != null && state !== previous) stateFlips += 1;
    previous = state;
  }

  return {
    firstPossibleAt: firstPossible?.asOf ?? null,
    firstPossibleLeadHours: firstPossible ? leadHours(issueTime, firstPossible.asOf) : null,
    firstStablePossibleAt: firstStablePossible?.asOf ?? null,
    firstStablePossibleLeadHours: firstStablePossible ? leadHours(issueTime, firstStablePossible.asOf) : null,
    stateFlipsBeforeIssue: stateFlips
  };
}

function checkpointResult(records, signal, issueTime, targetTime, label) {
  const record = selectRecordAtOrBefore(records, targetTime);
  if (!record) {
    return { label, targetTime, snapshotAsOf: null, status: 'no-snapshot-at-or-before-target' };
  }
  const value = signalSnapshot(record, signal);
  return {
    label,
    targetTime,
    snapshotAsOf: record.asOf,
    snapshotLagHours: (timeMs(targetTime) - timeMs(record.asOf)) / HOUR_MS,
    issueLeadHours: leadHours(issueTime, record.asOf),
    usableAgencies: record.usableAgencies,
    impactUncertainty: record.impactUncertainty,
    forecast: value,
    windowVerification: evaluateEstimatedWindow(issueTime, value?.estimatedWindow)
  };
}

export function evaluateReplayAgainstTruth(manifest, records) {
  const events = {};
  for (const signal of ['T1', 'T3', 'T8']) {
    const truth = signalTruthEvent(manifest, signal);
    if (!truth?.issuedAt) {
      events[signal] = { officialIssuedAt: null, status: 'truth-unavailable' };
      continue;
    }
    const issueMs = timeMs(truth.issuedAt);
    const checkpoints = FIXED_HORIZONS_HOURS.map(hours => {
      const targetTime = iso(issueMs - hours * HOUR_MS);
      return checkpointResult(records, signal, truth.issuedAt, targetTime, `T-${hours}h`);
    });
    const latestTarget = iso(issueMs - 1);
    checkpoints.push(checkpointResult(records, signal, truth.issuedAt, latestTarget, 'latest-pre-issue'));
    events[signal] = {
      officialIssuedAt: truth.issuedAt,
      officialSignal: truth.signal,
      diagnostics: buildSignalDiagnostics(records, signal, truth.issuedAt),
      checkpoints
    };
  }
  return events;
}

export async function replayHistoricalCase(manifest, options = {}) {
  assert(manifest?.caseId === '2026-noul', 'first frozen-v1 historical replay is intentionally bounded to 2026-noul');
  const historical = await fetchCmaHistoricalCase(manifest, options);
  const records = historical.snapshots.map(item => runFrozenV1Forecast(manifest, item));
  const unavailable = records.filter(item => !item.forecastAvailable);
  const report = {
    schemaVersion: REPLAY_VERSION,
    caseId: manifest.caseId,
    retrospective: true,
    generatedAt: new Date().toISOString(),
    historicalSource: {
      agency: historical.source.agency,
      provider: historical.source.provider,
      storm: historical.source.storm,
      snapshotCount: historical.snapshotCount,
      firstAsOf: historical.firstAsOf,
      lastAsOf: historical.lastAsOf
    },
    engineVersions: {
      snapshot: analysisCore.SNAPSHOT_VERSION,
      impact: impactEngine.IMPACT_VERSION,
      signalInputs: signalInputsEngine.INPUT_VERSION,
      threatAssessment: threatEngine.VERSION,
      basicForecast: basicForecastEngine.VERSION
    },
    replay: {
      recordCount: records.length,
      availableForecastCount: records.length - unavailable.length,
      unavailableForecastCount: unavailable.length,
      usableAgencySet: Array.from(new Set(records.flatMap(item => item.usableAgencies))).sort(),
      events: evaluateReplayAgainstTruth(manifest, records)
    },
    semantics: {
      frozenCurrentV1: true,
      retrospectiveValidation: true,
      onlySourcesAvailableAtSnapshotUsed: true,
      futureForecastValidTimesAllowed: true,
      futureIssuedSourcesForbidden: true,
      HkoTruthUsedOnlyAfterForecastGeneration: true,
      HkoTruthUsedAsForecastInput: false,
      missingAgencySubstitutionUsed: false,
      calibrationOrTrainingPerformed: false,
      modelParametersModified: false,
      productionWorkerModified: false,
      productionDatabaseWritten: false
    }
  };
  return { report, records };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

async function main() {
  const filePath = process.argv[2];
  assert(filePath, 'usage: node scripts/replay-historical-case.mjs <historical-case.json> [--full]');
  const result = await replayHistoricalCase(readJson(filePath));
  process.stdout.write(`${JSON.stringify(process.argv.includes('--full') ? result : result.report, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
  });
}
