import { normalizeModelWeights, builtinChampion } from './model-repository.js';
import { buildWeightedConsensusTrack, buildWeightedHongKongImpact } from './weighted-consensus.js';
import { getDeterministicEngines } from './deterministic-engines.js';

const REPLAY_ADAPTER_VERSION = 'historical-signal-replay-adapter/v1';
const HOUR_MS = 60 * 60 * 1000;

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}
function timeMs(value) {
  if (value == null || value === '') return null;
  if (Number.isFinite(value)) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function signalRank(value) {
  const text = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!text) return null;
  if (text.includes('10')) return 10;
  if (text.includes('9')) return 9;
  if (text.includes('8')) return 8;
  if (text.includes('3')) return 3;
  if (text.includes('1')) return 1;
  return null;
}
function rowModel(row) {
  if (!row) return builtinChampion();
  const weights = parseJson(row.weights_json);
  if (!weights) throw new Error(`model ${row.model_version || 'unknown'} has invalid weights_json`);
  return {
    modelVersion: String(row.model_version),
    role: 'historical-active',
    persisted: true,
    weights: normalizeModelWeights(weights),
    activatedAt: row.activated_at ?? null,
    retiredAt: row.retired_at ?? null,
    createdAt: row.created_at ?? null
  };
}
export function selectModelAsOf(rows, asOf) {
  const cutoff = timeMs(asOf);
  if (!Number.isFinite(cutoff)) return builtinChampion();
  const eligible = (Array.isArray(rows) ? rows : []).filter(row => {
    const activated = timeMs(row?.activated_at);
    const retired = timeMs(row?.retired_at);
    return Number.isFinite(activated) && activated <= cutoff && (!Number.isFinite(retired) || cutoff < retired);
  }).sort((a, b) => timeMs(b.activated_at) - timeMs(a.activated_at));
  return eligible.length ? rowModel(eligible[0]) : builtinChampion();
}
function normalizeOutcomeRows(rows) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (Number(row?.official_hko) !== 1) continue;
    if (String(row?.signal_system_era || '').toLowerCase() !== 'modern') continue;
    const rank = signalRank(row.highest_signal);
    if (rank == null) continue;
    const key = String(row.storm_key || '');
    const list = grouped.get(key) || [];
    list.push({ ...row, rank });
    grouped.set(key, list);
  }
  const accepted = new Map();
  const rejected = [];
  for (const [stormKey, list] of grouped) {
    const ranks = Array.from(new Set(list.map(item => item.rank)));
    if (ranks.length !== 1) {
      rejected.push({ stormKey, reason: 'ambiguous-official-hko-outcomes', outcomeIds: list.map(item => item.outcome_id) });
      continue;
    }
    accepted.set(stormKey, {
      highestSignal: list[0].highest_signal,
      source: list.map(item => item.source).filter(Boolean).join('; '),
      signalSystemEra: 'modern',
      officialHko: true,
      outcomeIds: list.map(item => item.outcome_id),
      fingerprints: list.map(item => item.fingerprint).filter(Boolean)
    });
  }
  return { accepted, rejected };
}
async function sha256Hex(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
function stableClone(value) {
  if (Array.isArray(value)) return value.map(stableClone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableClone(value[key])]));
}
function resultRows(result) { return Array.isArray(result?.results) ? result.results : []; }

export function createHistoricalReplayAdapter(db, options = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('ANALYSIS_DB D1 binding is required');
  const engines = options.engines ?? getDeterministicEngines();
  const buildTrack = options.buildWeightedConsensusTrack ?? buildWeightedConsensusTrack;
  const buildImpact = options.buildWeightedHongKongImpact ?? buildWeightedHongKongImpact;
  return Object.freeze({
    async loadTrainingDataset(loadOptions = {}) {
      const [snapshotResult, outcomeResult, modelResult] = await Promise.all([
        db.prepare(`SELECT snapshot_id, storm_key, as_of, provenance_type, provenance_source, original_issued_at,
          snapshot_json, signal_inputs_json, source_availability_json, fingerprint
          FROM forecast_snapshots WHERE eligible_for_walkforward = 1 ORDER BY storm_key, as_of, snapshot_id`).all(),
        db.prepare(`SELECT outcome_id, storm_key, source, signal_system_era, highest_signal, official_hko, fingerprint
          FROM signal_outcomes ORDER BY storm_key, issued_at, outcome_id`).all(),
        db.prepare(`SELECT model_version, weights_json, created_at, activated_at, retired_at
          FROM model_versions WHERE activated_at IS NOT NULL ORDER BY activated_at, model_version`).all()
      ]);
      const startMs = timeMs(loadOptions.startAsOf);
      const endMs = timeMs(loadOptions.endAsOf);
      const snapshots = resultRows(snapshotResult).filter(row => {
        const at = timeMs(row.as_of);
        return Number.isFinite(at) && (!Number.isFinite(startMs) || at >= startMs) && (!Number.isFinite(endMs) || at <= endMs);
      });
      const models = resultRows(modelResult);
      const outcomes = normalizeOutcomeRows(resultRows(outcomeResult));
      const stormMap = new Map();
      const rejectedCases = [];

      for (const row of snapshots) {
        const stormKey = String(row.storm_key || '');
        const outcome = outcomes.accepted.get(stormKey);
        if (!outcome) continue;
        const snapshot = parseJson(row.snapshot_json);
        const signalInputs = parseJson(row.signal_inputs_json);
        if (!snapshot) { rejectedCases.push({ caseId: row.snapshot_id, stormKey, reason: 'invalid-snapshot-json' }); continue; }
        if (!signalInputs) { rejectedCases.push({ caseId: row.snapshot_id, stormKey, reason: 'missing-signal-inputs' }); continue; }
        const model = selectModelAsOf(models, row.as_of);
        const modelWeightsFingerprint = await sha256Hex(JSON.stringify(stableClone(model.weights)));
        const snapshotContentFingerprint = await sha256Hex(String(row.snapshot_json));
        const signalInputsContentFingerprint = await sha256Hex(String(row.signal_inputs_json));
        const weightedTrack = buildTrack(snapshot, model, engines.impact, loadOptions.weightedTrackOptions || {});
        const weightedImpact = buildImpact(weightedTrack, snapshot.referencePoint, engines.impact, loadOptions.weightedTrackOptions || {});
        if (!weightedTrack?.available || !weightedImpact?.available) {
          rejectedCases.push({ caseId: row.snapshot_id, stormKey, reason: 'weighted-replay-unavailable' });
          continue;
        }
        const storm = stormMap.get(stormKey) || { stormKey, outcome, cases: [] };
        storm.cases.push({
          caseId: row.snapshot_id,
          asOf: row.as_of,
          snapshot,
          signalInputs,
          weightedConsensusTrack: weightedTrack,
          weightedHongKongImpact: weightedImpact,
          sourceAvailability: parseJson(row.source_availability_json, {}),
          provenanceType: row.provenance_type,
          provenanceSource: row.provenance_source,
          originalIssuedAt: row.original_issued_at,
          replayModel: {
            modelVersion: model.modelVersion,
            persisted: model.persisted,
            activatedAt: model.activatedAt ?? null,
            retiredAt: model.retiredAt ?? null,
            weightsFingerprint: modelWeightsFingerprint
          },
          snapshotContentFingerprint,
          signalInputsContentFingerprint,
          sourceFingerprint: row.fingerprint
        });
        stormMap.set(stormKey, storm);
      }
      const storms = Array.from(stormMap.values()).map(storm => ({
        ...storm,
        cases: storm.cases.sort((a, b) => timeMs(a.asOf) - timeMs(b.asOf) || a.caseId.localeCompare(b.caseId))
      })).sort((a, b) => timeMs(a.cases[0]?.asOf) - timeMs(b.cases[0]?.asOf) || a.stormKey.localeCompare(b.stormKey));
      const fingerprintPayload = {
        adapterVersion: REPLAY_ADAPTER_VERSION,
        weightedTrackOptions: loadOptions.weightedTrackOptions || {},
        storms: storms.map(storm => ({
          stormKey: storm.stormKey,
          outcome: {
            highestSignal: storm.outcome.highestSignal,
            source: storm.outcome.source,
            signalSystemEra: storm.outcome.signalSystemEra,
            officialHko: storm.outcome.officialHko,
            outcomeIds: storm.outcome.outcomeIds,
            fingerprints: storm.outcome.fingerprints
          },
          cases: storm.cases.map(item => ({
            caseId: item.caseId,
            sourceFingerprint: item.sourceFingerprint,
            snapshotContentFingerprint: item.snapshotContentFingerprint,
            signalInputsContentFingerprint: item.signalInputsContentFingerprint,
            modelVersion: item.replayModel.modelVersion,
            modelWeightsFingerprint: item.replayModel.weightsFingerprint
          }))
        }))
      };
      const datasetFingerprint = await sha256Hex(JSON.stringify(stableClone(fingerprintPayload)));
      return {
        schemaVersion: REPLAY_ADAPTER_VERSION,
        storms,
        datasetFingerprint,
        coverage: {
          eligibleStorms: storms.length,
          eligibleCases: storms.reduce((sum, storm) => sum + storm.cases.length, 0),
          rejectedCases,
          rejectedOutcomeStorms: outcomes.rejected
        },
        semantics: {
          explicitOfficialHkoFlagRequired: true,
          modernSignalEraOnly: true,
          historicalModelSelectedByActivationWindow: true,
          futureActivatedModelRejected: true,
          missingHistoricalModelFallsBackToBuiltinEqual: true,
          currentChampionNotBackfilledIntoHistory: true,
          aiGenerated: false
        }
      };
    }
  });
}

export { REPLAY_ADAPTER_VERSION, signalRank };
