import { getDeterministicEngines } from './deterministic-engines.js';
import { AGENCIES, selectWeightsForLead } from './model-repository.js';

const ORCHESTRATION_VERSION = 'storm-analysis-orchestration/v1';

function weightedComparison(snapshot, model, haversineKm) {
  const entries = Array.isArray(snapshot?.comparison?.entries) ? snapshot.comparison.entries : [];
  const selection = selectWeightsForLead(model, snapshot?.comparison?.leadHours);
  const usable = entries.filter(entry => AGENCIES.includes(entry?.agency)
    && Number.isFinite(Number(entry?.lat)) && Number.isFinite(Number(entry?.lon)));
  const selected = usable.map(entry => ({ entry, weight: Number(selection.weights[entry.agency]) || 0 }));
  const sum = selected.reduce((total, item) => total + item.weight, 0);
  if (!(sum > 0) || !selected.length) {
    return {
      method: 'champion-weighted-common-valid-time-v1',
      appComputed: true,
      available: false,
      bucketId: selection.bucketId,
      modelVersion: model.modelVersion,
      agencies: [],
      weights: {},
      lat: null,
      lon: null,
      distanceToHongKongKm: null
    };
  }
  const appliedWeights = Object.fromEntries(selected.map(item => [item.entry.agency, item.weight / sum]));
  const lat = selected.reduce((total, item) => total + Number(item.entry.lat) * appliedWeights[item.entry.agency], 0);
  const sin = selected.reduce((total, item) => total + Math.sin(Number(item.entry.lon) * Math.PI / 180) * appliedWeights[item.entry.agency], 0);
  const cos = selected.reduce((total, item) => total + Math.cos(Number(item.entry.lon) * Math.PI / 180) * appliedWeights[item.entry.agency], 0);
  const lon = Math.atan2(sin, cos) * 180 / Math.PI;
  const reference = snapshot?.referencePoint;
  return {
    method: 'champion-weighted-common-valid-time-v1',
    appComputed: true,
    available: true,
    bucketId: selection.bucketId,
    modelVersion: model.modelVersion,
    agencies: selected.map(item => item.entry.agency),
    weights: appliedWeights,
    lat,
    lon,
    distanceToHongKongKm: Number.isFinite(Number(reference?.lat)) && Number.isFinite(Number(reference?.lon))
      ? haversineKm(Number(reference.lat), Number(reference.lon), lat, lon) : null
  };
}

export function createAnalysisOrchestrator({ modelRepository, engines } = {}) {
  if (!modelRepository || typeof modelRepository.getChampion !== 'function') throw new Error('modelRepository is required');
  const deterministic = engines ?? getDeterministicEngines();
  return Object.freeze({
    async run(input) {
      if (!input?.sourceGroup || typeof input.sourceGroup !== 'object') throw new Error('sourceGroup is required');
      const model = await modelRepository.getChampion();
      const snapshotOptions = {
        ...(input.snapshotOptions || {}),
        ...(input.generatedAt ? { generatedAt: input.generatedAt } : {}),
        ...(input.compareLeadHours != null ? { compareLeadHours: input.compareLeadHours } : {})
      };
      const snapshot = deterministic.snapshot.buildStormAnalysisSnapshot(input.sourceGroup, snapshotOptions);
      const impact = deterministic.impact.buildHongKongImpact(snapshot, input.impactOptions || {});
      const signalInputs = deterministic.signal.buildHkoSignalRiskInputs(
        snapshot,
        impact,
        input.sourceGroup,
        input.signalOptions || {}
      );
      const weighted = weightedComparison(snapshot, model, deterministic.snapshot.haversineKm);
      return {
        schemaVersion: ORCHESTRATION_VERSION,
        generatedAt: snapshot.generatedAt,
        storm: snapshot.storm,
        model: {
          modelVersion: model.modelVersion,
          role: model.role,
          persisted: model.persisted,
          bucketId: weighted.bucketId,
          weightsSchemaVersion: model.weights.schemaVersion
        },
        deterministic: {
          snapshot,
          impact,
          signalInputs,
          weightedComparison: weighted
        },
        semantics: {
          deterministic: true,
          officialAgencyDataRemainSeparate: true,
          weightedComparisonIsAppComputed: true,
          unweightedAnalysisPreserved: true,
          championModelReadOnly: true,
          modelPromotionPerformed: false,
          warningSignalPredictionIncluded: false,
          aiGenerated: false
        }
      };
    }
  });
}

export { ORCHESTRATION_VERSION, weightedComparison };
