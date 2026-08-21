import { getDeterministicEngines } from './deterministic-engines.js';
import { AGENCIES, selectWeightsForLead } from './model-repository.js';
import { buildWeightedConsensusTrack, buildWeightedHongKongImpact } from './weighted-consensus.js';

const ORCHESTRATION_VERSION = 'storm-analysis-orchestration/v2';

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

function weightedTrackUnavailable(modelVersion) {
  return {
    schemaVersion: 'weighted-consensus-track/v1',
    modelVersion,
    available: false,
    points: [],
    reason: 'track-helpers-unavailable'
  };
}

export function createAnalysisOrchestrator({ modelRepository, engines } = {}) {
  if (!modelRepository || typeof modelRepository.getChampion !== 'function') throw new Error('modelRepository is required');
  const deterministic = engines ?? getDeterministicEngines();
  return Object.freeze({
    async run(input, options = {}) {
      if (!input?.sourceGroup || typeof input.sourceGroup !== 'object') throw new Error('sourceGroup is required');
      const model = options.model ?? await modelRepository.getChampion();
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
      const trackHelpersAvailable = typeof deterministic.impact?.buildSourceTrack === 'function'
        && typeof deterministic.impact?.interpolateTrackAtTime === 'function'
        && typeof deterministic.impact?.calculateContinuousNearest === 'function'
        && typeof deterministic.impact?.calculateBandIntervals === 'function';
      const weightedTrack = trackHelpersAvailable
        ? buildWeightedConsensusTrack(snapshot, model, deterministic.impact, input.weightedTrackOptions || {})
        : weightedTrackUnavailable(model.modelVersion);
      const weightedImpact = trackHelpersAvailable
        ? buildWeightedHongKongImpact(weightedTrack, snapshot.referencePoint, deterministic.impact, input.weightedTrackOptions || {})
        : {
            schemaVersion: 'weighted-hk-impact/v1',
            sourceTrackVersion: weightedTrack.schemaVersion,
            available: false,
            closestApproach: null,
            distanceBands: {}
          };
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
          weightedComparison: weighted,
          weightedConsensusTrack: weightedTrack,
          weightedHongKongImpact: weightedImpact
        },
        semantics: {
          deterministic: true,
          officialAgencyDataRemainSeparate: true,
          weightedComparisonIsAppComputed: true,
          weightedTrackIsAppComputed: true,
          weightedHongKongImpactIsAppComputed: true,
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
