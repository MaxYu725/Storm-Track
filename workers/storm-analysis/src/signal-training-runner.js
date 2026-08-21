import '../../../analysis/hko-signal-risk-calibration.js';
import '../../../analysis/signal-calibration-walkforward-trainer.js';
import { createHistoricalReplayAdapter } from './historical-replay-adapter.js';
import { createSignalTrainingRepository } from './signal-training-repository.js';
import { createSignalRiskRepository } from './signal-risk-repository.js';

const RUNNER_VERSION = 'signal-calibration-training-runner/v1';
function stableClone(value) { if (Array.isArray(value)) return value.map(stableClone); if (!value || typeof value !== 'object') return value; return Object.fromEntries(Object.keys(value).sort().map(k => [k, stableClone(value[k])])); }
async function sha256Hex(value) { const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); }

export async function runPersistedSignalCalibrationTraining(db, input, dependencies = {}) {
  if (!db) throw new Error('ANALYSIS_DB D1 binding is required');
  const trainer = dependencies.trainer ?? globalThis.StormSignalCalibrationWalkForwardTrainer;
  const calibration = dependencies.calibration ?? globalThis.StormHkoSignalRiskCalibration;
  if (typeof trainer?.runSignalCalibrationWalkForward !== 'function') throw new Error('AI-12 trainer is unavailable');
  if (typeof calibration?.buildHkoSignalCalibrationProfile !== 'function') throw new Error('AI-11 calibration is unavailable');
  const adapter = dependencies.adapter ?? createHistoricalReplayAdapter(db, dependencies.replayOptions);
  const repository = dependencies.repository ?? createSignalTrainingRepository(db);
  const signalRiskRepository = dependencies.signalRiskRepository ?? createSignalRiskRepository(db);
  const runId = String(input?.runId || '').trim();
  const challengerProfileId = String(input?.challengerProfileId || '').trim();
  if (!runId || !challengerProfileId) throw new Error('runId and challengerProfileId are required');

  const dataset = await adapter.loadTrainingDataset(input?.datasetOptions || {});
  const champion = await signalRiskRepository.getChampion();
  const fingerprint = await sha256Hex(JSON.stringify(stableClone({
    runnerVersion: RUNNER_VERSION,
    datasetFingerprint: dataset.datasetFingerprint,
    challengerProfileId,
    trainerOptions: input?.trainerOptions || {},
    championProfileId: champion?.profileId ?? null,
    championProfile: champion?.profile ?? null,
    championProfileProvenance: input?.championProfileProvenance ?? null
  })));
  const begin = await repository.beginRun({
    runId,
    inputFingerprint: fingerprint,
    datasetFingerprint: dataset.datasetFingerprint,
    challengerProfileId,
    championProfileId: champion?.profileId ?? null,
    trainerVersion: trainer.TRAINER_VERSION ?? 'signal-calibration-walkforward-trainer/v1'
  });
  if (begin.status === 'already-completed') return { schemaVersion: RUNNER_VERSION, status: 'already-completed', runId: begin.runId, result: begin.result, writesPerformed: false };

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
        challengerPersisted: true,
        trainingRunAuditPersisted: true,
        automaticPromotion: false,
        promotionPerformed: false,
        productionDatabaseWritten: false,
        aiGenerated: false
      }
    };
  } catch (error) {
    try { await repository.failRun(runId, error); } catch (statusError) { console.error(JSON.stringify({ event: 'signal-training-run-fail-status-error', runId, error: String(statusError) })); }
    throw error;
  }
}

export { RUNNER_VERSION };
