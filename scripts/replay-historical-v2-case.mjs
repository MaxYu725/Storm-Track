import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { fetchCmaHistoricalCase } from './cma-historical-adapter.mjs';
import { evaluateReplayAgainstTruth } from './replay-historical-case.mjs';

const require = createRequire(import.meta.url);
const analysisCore = require('../analysis/storm-analysis-core.js');
const impactEngine = require('../analysis/hk-impact-engine.js');
const signalInputsEngine = require('../analysis/hko-signal-risk-inputs.js');
const threatEngine = require('../analysis/hk-threat-assessment.js');
const basicForecastEngine = require('../analysis/basic-hk-signal-forecast.js');
const v2Engine = require('../analysis/hk-signal-forecast-v2.js');

export const REPLAY_VERSION = 'historical-v2-shadow-replay/v1';

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

export function runV2HistoricalSnapshot(manifest, historicalSnapshot) {
  assert(manifest?.safety?.currentV1ModelFrozen === true, `${manifest?.caseId || 'case'}: frozen-v1 guard is required`);
  assert(manifest?.safety?.truthMayNotBeUsedAsForecastInput === true, `${manifest?.caseId || 'case'}: truth/input separation guard is required`);
  assert(manifest?.safety?.futureAdvisoryLeakageForbidden === true, `${manifest?.caseId || 'case'}: future-advisory leakage guard is required`);
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
  const v1Forecast = basicForecastEngine.buildBasicHkSignalForecast({
    impact,
    signalInputs,
    threatAssessment,
    generatedAt: historicalSnapshot.asOf
  });
  const sourceLifecycle = v2Engine.buildSourceLifecycleContext(group, historicalSnapshot.asOf);
  const v2Forecast = v2Engine.buildForecast({
    basicForecast: v1Forecast,
    signalInputs,
    threatAssessment,
    generatedAt: historicalSnapshot.asOf,
    sourceLifecycle
  });

  return {
    asOf: historicalSnapshot.asOf,
    sourceProvenance: historicalSnapshot.provenance,
    usableAgencies: snapshot?.coverage?.usableAgencies || [],
    impactUncertainty: impact?.uncertainty?.level ?? null,
    threatAvailable: threatAssessment?.available === true,
    v1Available: v1Forecast?.available === true,
    v2Available: v2Forecast?.available === true,
    v1Forecast,
    forecast: v2Forecast
  };
}

function firstSignalTime(records, signal, likelihoods) {
  const allowed = new Set(likelihoods);
  const match = records.find(record => allowed.has(record?.forecast?.signals?.[signal]?.likelihood));
  return match?.asOf ?? null;
}

function signalSummary(records, signal) {
  const states = { unlikely: 0, possible: 0, likely: 0, unknown: 0 };
  for (const record of records) {
    const state = record?.forecast?.signals?.[signal]?.likelihood;
    if (Object.hasOwn(states, state)) states[state] += 1;
    else states.unknown += 1;
  }
  return {
    states,
    firstPositiveAt: firstSignalTime(records, signal, ['possible', 'likely']),
    firstLikelyAt: firstSignalTime(records, signal, ['likely'])
  };
}

export async function replayHistoricalV2Case(manifest, options = {}) {
  assert(manifest?.retrospective === true, `${manifest?.caseId || 'case'}: retrospective manifest required`);
  assert(manifest?.truth?.role === 'verification-only', `${manifest?.caseId || 'case'}: truth must be verification-only`);
  assert(manifest?.forecastSources?.CMA?.role === 'forecast-input-primary', `${manifest?.caseId || 'case'}: current historical V2 replay requires CMA primary input`);

  const historical = await fetchCmaHistoricalCase(manifest, options);
  const paired = historical.snapshots.map(item => runV2HistoricalSnapshot(manifest, item));
  const v1Records = paired.map(item => ({
    asOf: item.asOf,
    usableAgencies: item.usableAgencies,
    impactUncertainty: item.impactUncertainty,
    forecast: item.v1Forecast
  }));
  const v2Records = paired.map(item => ({
    asOf: item.asOf,
    usableAgencies: item.usableAgencies,
    impactUncertainty: item.impactUncertainty,
    forecast: item.forecast
  }));

  // Truth is intentionally consulted only after every forecast snapshot above has
  // already been generated from its as-issued historical source state.
  const v1Events = evaluateReplayAgainstTruth(manifest, v1Records);
  const v2Events = evaluateReplayAgainstTruth(manifest, v2Records);

  return {
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
      v1: basicForecastEngine.VERSION,
      v2: v2Engine.VERSION
    },
    replay: {
      recordCount: paired.length,
      v1AvailableForecastCount: paired.filter(item => item.v1Available).length,
      v2AvailableForecastCount: paired.filter(item => item.v2Available).length,
      usableAgencySet: Array.from(new Set(paired.flatMap(item => item.usableAgencies))).sort(),
      signalStateSummary: Object.fromEntries(['T1', 'T3', 'T8'].map(signal => [signal, {
        v1: signalSummary(v1Records, signal),
        v2: signalSummary(v2Records, signal)
      }])),
      v1Events,
      v2Events
    },
    semantics: {
      retrospectiveValidation: true,
      v1RemainsFrozenBenchmark: true,
      v2ShadowOnly: true,
      onlySourcesAvailableAtSnapshotUsed: true,
      futureForecastValidTimesAllowed: true,
      futureIssuedSourcesForbidden: true,
      HkoTruthUsedOnlyAfterForecastGeneration: true,
      HkoTruthUsedAsForecastInput: false,
      missingAgencySubstitutionUsed: false,
      calibrationOrTrainingPerformedInsideReplay: false,
      productionWorkerModified: false,
      productionDatabaseWritten: false
    }
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

async function main() {
  const filePath = process.argv[2];
  assert(filePath, 'usage: node scripts/replay-historical-v2-case.mjs <historical-case.json>');
  const report = await replayHistoricalV2Case(readJson(filePath));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
  });
}
