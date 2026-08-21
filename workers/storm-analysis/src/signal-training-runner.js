import '../../../analysis/hko-signal-risk-calibration.js';
import '../../../analysis/signal-calibration-walkforward-trainer.js';
import { createHistoricalReplayAdapter } from './historical-replay-adapter.js';
import { createSignalTrainingRepository } from './signal-training-repository.js';
import { createSignalRiskRepository } from './signal-risk-repository.js';

const RUNNER_VERSION = 'signal-calibration-training-runner/v2';
const DEFAULT_MAXIMUM_STORMS = 250;
const DEFAULT_MAXIMUM_CASES = 5000;

function httpError(status, code, message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}
function stableClone(value) {
  if (Array.isArray(value)) return value.map(stableClone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableClone(value[key])]));
}
async function sha256Hex(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function timeMs(value) {
  if (value == null || value === '') return null;
  if (Number.isFinite(value)) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function requireIds(input, requireRunId = false) {
  const runId = String(input?.runId || '').trim();
  const challengerProfileId = String(input?.challengerProfileId || '').trim();
  if (!challengerProfileId || (requireRunId && !runId)) {
    throw httpError(400, 'invalid-training-request', requireRunId
      ? 'runId and challengerProfileId are required'
      : 'challengerProfileId is required');
  }
  return { runId, challengerProfileId };
}
function runLimits(input) {
  return {
    maximumStorms: Math.max(1, Math.floor(finite(input?.maximumStorms) ?? DEFAULT_MAXIMUM_STORMS)),
    maximumCases: Math.max(1, Math.floor(finite(input?.maximumCases) ?? DEFAULT_MAXIMUM_CASES))
  };
}
function coverageWithinLimits(dataset, limits) {
  const storms = Number(dataset?.coverage?.eligibleStorms) || 0;
  const cases = Number(dataset?.coverage?.eligibleCases) || 0;
  return storms <= limits.maximumStorms && cases <= limits.maximumCases;
}
function estimateHoldoutCoverage(dataset, trainerOptions = {}) {
  const minimumTrainingStorms = Math.max(2, Math.floor(finite(trainerOptions?.minimumTrainingStorms) ?? 8));
  const storms = (Array.isArray(dataset?.storms) ? dataset.storms : []).map(storm => ({
    stormKey: storm.stormKey,
    firstAsOfMs: Math.min(...(Array.isArray(storm.cases) ? storm.cases : []).map(item => timeMs(item?.asOf)).filter(Number.isFinite))
  })).filter(storm => Number.isFinite(storm.firstAsOfMs));
  return storms.map(storm => {
    const priorStormCount = storms.filter(candidate => candidate.firstAsOfMs < storm.firstAsOfMs).length;
    return { stormKey: storm.stormKey, priorStormCount, potentialHoldout: priorStormCount >= minimumTrainingStorms };
  });
}
async function resolveTrainingContext(db, input, dependencies = {}) {
  if (!db) throw new Error('ANALYSIS_DB D1 binding is required');
  const adapter = dependencies.adapter ?? createHistoricalReplayAdapter(db, dependencies.replayOptions);
  const signalRiskRepository = dependencies.signalRiskRepository ?? createSignalRiskRepository(db);
  const dataset = await adapter.loadTrainingDataset(input?.datasetOptions || {});
  const champion = await signalRiskRepository.getChampion();
  return { dataset, champion };
}
async function buildTrainingInputFingerprint(input, dataset, champion, challengerProfileId) {
  return sha256Hex(JSON.stringify(stableClone({
    runnerVersion: RUNNER_VERSION,
    datasetFingerprint: dataset.datasetFingerprint,
    challengerProfileId,
    trainerOptions: input?.trainerOptions || {},
    championProfileId: champion?.profileId ?? null,
    championProfile: champion?.profile ?? null,
    championProfileProvenance: input?.championProfileProvenance ?? null
  })));
}

export async function previewPersistedSignalCalibrationTraining(db, input, dependencies = {}) {
  const { challengerProfileId } = requireIds(input, false);
  const { dataset, champion } = await resolveTrainingContext(db, input, dependencies);
  const limits = runLimits(input);
  const holdouts = estimateHoldoutCoverage(dataset, input?.trainerOptions || {});
  const inputFingerprint = await buildTrainingInputFingerprint(input, dataset, champion, challengerProfileId);
  return {
    schemaVersion: RUNNER_VERSION,
    dryRun: true,
    writesPerformed: false,
    challengerProfileId,
    inputFingerprint,
    dataset: {
      datasetFingerprint: dataset.datasetFingerprint,
      coverage: dataset.coverage,
      stormSummaries: (Array.isArray(dataset.storms) ? dataset.storms : []).map(storm => ({
        stormKey: storm.stormKey,
        caseCount: Array.isArray(storm.cases) ? storm.cases.length : 0,
        firstAsOf: storm.cases?.[0]?.asOf ?? null,
        lastAsOf: storm.cases?.[storm.cases.length - 1]?.asOf ?? null
      }))
    },
    champion: champion ? { profileId: champion.profileId, role: champion.role, persisted: champion.persisted } : null,
    championHoldoutIndependenceConfirmed: input?.championProfileProvenance?.holdoutIndependent === true,
    limits: { ...limits, runAllowedBySize: coverageWithinLimits(dataset, limits) },
    walkForwardPreview: {
      minimumTrainingStorms: Math.max(2, Math.floor(finite(input?.trainerOptions?.minimumTrainingStorms) ?? 8)),
      potentialHoldoutStormCount: holdouts.filter(item => item.potentialHoldout).length,
      storms: holdouts
    },
    semantics: {
      analysisDbReadOnly: true,
      datasetFingerprintMustBeConfirmedForRun: true,
      challengerNotPersisted: true,
      trainingRunNotCreated: true,
      automaticPromotion: false,
      promotionPerformed: false,
      aiGenerated: false
    }
  };
}

export async function runPersistedSignalCalibrationTraining(db, input, dependencies = {}) {
  if (!db) throw new Error('ANALYSIS_DB D1 binding is required');
  const trainer = dependencies.trainer ?? globalThis.StormSignalCalibrationWalkForwardTrainer;
  const calibration = dependencies.calibration ?? globalThis.StormHkoSignalRiskCalibration;
  if (typeof trainer?.runSignalCalibrationWalkForward !== 'function') throw new Error('AI-12 trainer is unavailable');
  if (typeof calibration?.buildHkoSignalCalibrationProfile !== 'function') throw new Error('AI-11 calibration is unavailable');
  const { runId, challengerProfileId } = requireIds(input, true);
  const { dataset, champion } = await resolveTrainingContext(db, input, dependencies);
  const expectedDatasetFingerprint = String(input?.expectedDatasetFingerprint || '').trim();
  if (!expectedDatasetFingerprint) {
    throw httpError(400, 'dataset-confirmation-required', 'expectedDatasetFingerprint from training preview is required');
  }
  if (expectedDatasetFingerprint !== dataset.datasetFingerprint) {
    throw httpError(409, 'training-dataset-changed', 'training dataset changed after preview', {
      expectedDatasetFingerprint,
      actualDatasetFingerprint: dataset.datasetFingerprint
    });
  }
  const limits = runLimits(input);
  if (!coverageWithinLimits(dataset, limits)) {
    throw httpError(413, 'training-dataset-too-large', 'training dataset exceeds synchronous admin-run safety limits', {
      eligibleStorms: dataset.coverage?.eligibleStorms ?? 0,
      eligibleCases: dataset.coverage?.eligibleCases ?? 0,
      ...limits
    });
  }
  const repository = dependencies.repository ?? createSignalTrainingRepository(db);
  const signalRiskRepository = dependencies.signalRiskRepository ?? createSignalRiskRepository(db);
  const fingerprint = await buildTrainingInputFingerprint(input, dataset, champion, challengerProfileId);
  const begin = await repository.beginRun({
    runId,
    inputFingerprint: fingerprint,
    datasetFingerprint: dataset.datasetFingerprint,
    challengerProfileId,
    championProfileId: champion?.profileId ?? null,
    trainerVersion: trainer.TRAINER_VERSION ?? 'signal-calibration-walkforward-trainer/v1'
  });
  if (begin.status === 'already-completed') {
    return { schemaVersion: RUNNER_VERSION, status: 'already-completed', runId: begin.runId, result: begin.result, writesPerformed: false };
  }

  try {
    const result = await trainer.runSignalCalibrationWalkForward({
      ...(input?.trainerOptions || {}),
      storms: dataset.storms,
      challengerProfileId,
      championProfile: champion?.profile ?? null,
      championProfileProvenance: input?.championProfileProvenance ?? null,
      generatedAt: input?.generatedAt
    }, { calibration });
    const persisted = await repository.completeRun(runId, result);
    return {
      schemaVersion: RUNNER_VERSION,
      status: 'completed',
      runId,
      dataset: { datasetFingerprint: dataset.datasetFingerprint, coverage: dataset.coverage },
      challenger: result.challenger,
      replay: result.replay,
      persisted,
      semantics: {
        historicalReplayFromAnalysisDb: true,
        previewFingerprintConfirmed: true,
        synchronousDatasetLimitsEnforced: true,
        challengerPersisted: true,
        trainingRunAuditPersisted: true,
        automaticPromotion: false,
        promotionPerformed: false,
        productionDatabaseWritten: false,
        aiGenerated: false
      }
    };
  } catch (error) {
    try { await repository.failRun(runId, error); }
    catch (statusError) { console.error(JSON.stringify({ event: 'signal-training-run-fail-status-error', runId, error: String(statusError) })); }
    throw error;
  }
}

export {
  RUNNER_VERSION,
  DEFAULT_MAXIMUM_STORMS,
  DEFAULT_MAXIMUM_CASES,
  buildTrainingInputFingerprint,
  estimateHoldoutCoverage
};
