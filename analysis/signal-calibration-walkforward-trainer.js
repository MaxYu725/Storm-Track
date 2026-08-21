(function attachSignalCalibrationWalkForwardTrainer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StormSignalCalibrationWalkForwardTrainer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSignalCalibrationWalkForwardTrainer() {
  'use strict';

  const TRAINER_VERSION = 'signal-calibration-walkforward-trainer/v1';
  const CHALLENGER_VERSION = 'signal-calibration-challenger/v1';
  const SIGNALS = Object.freeze(['T1', 'T3', 'T8']);

  const AGENCIES = Object.freeze(['HKO', 'CMA', 'JMA', 'CWA']);

  function latestKnownSourceTime(item) {
    const snapshot = item?.snapshot ?? item?.analysis?.deterministic?.snapshot ?? null;
    const availability = item?.sourceAvailability ?? {};
    const values = [];
    AGENCIES.forEach(agency => {
      const explicit = availability?.[agency] ?? {};
      const source = snapshot?.sources?.[agency] ?? {};
      [explicit.availableAt, explicit.collectedAt, explicit.issuedAt,
       source.availableAt, source.collectedAt, source.bulletinTime, source.baseTime]
        .map(timeMs).filter(Number.isFinite).forEach(value => values.push(value));
    });
    return values.length ? Math.max(...values) : null;
  }

  function validateHistoricalCaseCutoff(item, options, deps) {
    const asOfMs = timeMs(item?.asOf);
    if (!Number.isFinite(asOfMs)) return { valid: false, reason: 'missing-as-of' };
    if (item?.status === 'rejected-leakage') return { valid: false, reason: 'upstream-rejected-leakage' };
    if (options?.strictLeakage !== false && Array.isArray(item?.leakageIssues) && item.leakageIssues.length) {
      return { valid: false, reason: 'upstream-leakage-issues' };
    }
    const toleranceMs = Math.max(0, finite(options?.leakageToleranceMs) ?? 1000);
    const snapshotGeneratedMs = timeMs(item?.snapshot?.generatedAt ?? item?.analysis?.deterministic?.snapshot?.generatedAt);
    if (Number.isFinite(snapshotGeneratedMs) && snapshotGeneratedMs > asOfMs + toleranceMs) {
      return { valid: false, reason: 'snapshot-after-as-of' };
    }
    const sourceTime = latestKnownSourceTime(item);
    if (Number.isFinite(sourceTime) && sourceTime > asOfMs + toleranceMs) {
      return { valid: false, reason: 'source-available-after-as-of' };
    }
    if (typeof deps?.validateHistoricalCase === 'function') {
      const result = deps.validateHistoricalCase(item);
      if (result === false || result?.valid === false) return { valid: false, reason: result?.reason ?? 'external-historical-case-validation-failed' };
    }
    return { valid: true, asOfMs };
  }

  const finite = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const timeMs = value => {
    if (value == null || value === '') return null;
    if (Number.isFinite(value)) return value;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const iso = value => Number.isFinite(value) ? new Date(value).toISOString() : null;

  function requireCalibration(deps) {
    const calibration = deps?.calibration || deps?.signalCalibration;
    const required = ['validateCalibrationRecord', 'buildHkoSignalCalibrationProfile', 'estimateHkoSignalRisk', 'evaluateSignalPredictions'];
    if (!calibration || required.some(name => typeof calibration[name] !== 'function')) {
      throw new Error('AI-12 requires AI-11 signal calibration dependency');
    }
    return calibration;
  }

  function normalizeOutcome(outcome) {
    if (!outcome || typeof outcome !== 'object') return null;
    return {
      highestSignal: outcome.highestSignal ?? outcome.signal ?? null,
      source: outcome.source ?? null,
      signalSystemEra: outcome.signalSystemEra ?? null,
      officialHko: outcome.officialHko === true
    };
  }

  function analysisArtifacts(caseItem, replayResult) {
    const source = replayResult ?? caseItem?.analysis ?? caseItem?.replayResult ?? null;
    const deterministic = source?.deterministic ?? source?.analysis?.deterministic ?? source ?? {};
    return {
      signalInputs: caseItem?.signalInputs ?? deterministic?.signalInputs ?? null,
      weightedHongKongImpact: caseItem?.weightedHongKongImpact ?? deterministic?.weightedHongKongImpact ?? null,
      weightedConsensusTrack: caseItem?.weightedConsensusTrack ?? deterministic?.weightedConsensusTrack ?? null
    };
  }

  async function materializeStorm(storm, deps, calibration, options) {
    const stormKey = String(storm?.stormKey ?? '').trim();
    if (!stormKey) return { eligible: false, reason: 'missing-storm-key', stormKey: null, cases: [] };
    const outcome = normalizeOutcome(storm?.outcome);
    const list = Array.isArray(storm?.cases) ? storm.cases : [];
    const seenCaseIds = new Set();
    const accepted = [];
    const rejected = [];

    for (let index = 0; index < list.length; index += 1) {
      const item = list[index] || {};
      const asOfMs = timeMs(item.asOf);
      const caseId = String(item.caseId ?? `${stormKey}:${iso(asOfMs) ?? index}`);
      const cutoff = validateHistoricalCaseCutoff(item, options, deps);
      if (!cutoff.valid) {
        rejected.push({ caseId, reason: cutoff.reason });
        continue;
      }
      if (seenCaseIds.has(caseId)) {
        rejected.push({ caseId, reason: 'duplicate-case-id' });
        continue;
      }
      seenCaseIds.add(caseId);
      let replayResult = null;
      if (!item.analysis && !item.replayResult && !item.signalInputs && typeof deps?.replayCase === 'function') {
        try {
          replayResult = await deps.replayCase(item, storm);
        } catch (error) {
          rejected.push({ caseId, reason: 'replay-error', error: error instanceof Error ? error.message : String(error) });
          continue;
        }
      }
      const artifacts = analysisArtifacts(item, replayResult);
      const record = {
        stormKey,
        asOf: item.asOf,
        signalInputs: artifacts.signalInputs,
        weightedHongKongImpact: artifacts.weightedHongKongImpact,
        weightedConsensusTrack: artifacts.weightedConsensusTrack,
        outcome
      };
      const validation = calibration.validateCalibrationRecord(record, options?.calibrationOptions);
      if (!validation?.eligible) {
        rejected.push({ caseId, reason: validation?.reason ?? 'invalid-calibration-record' });
        continue;
      }
      accepted.push({
        caseId,
        stormKey,
        asOf: validation.asOf,
        asOfMs: timeMs(validation.asOf),
        record,
        artifacts
      });
    }

    accepted.sort((a, b) => a.asOfMs - b.asOfMs || a.caseId.localeCompare(b.caseId));
    const sortTimeMs = accepted.length ? accepted[0].asOfMs : null;
    return {
      eligible: accepted.length > 0,
      reason: accepted.length ? null : 'no-eligible-cases',
      stormKey,
      sortTimeMs,
      sortTime: iso(sortTimeMs),
      outcome,
      cases: accepted,
      rejectedCases: rejected
    };
  }

  async function materializeHistoricalStorms(input, deps) {
    const calibration = requireCalibration(deps);
    const raw = Array.isArray(input?.storms) ? input.storms : [];
    const materialized = [];
    for (const storm of raw) materialized.push(await materializeStorm(storm, deps, calibration, input));
    const eligible = materialized.filter(storm => storm.eligible && Number.isFinite(storm.sortTimeMs));
    const duplicateKeys = new Set();
    const seen = new Set();
    eligible.forEach(storm => {
      if (seen.has(storm.stormKey)) duplicateKeys.add(storm.stormKey);
      seen.add(storm.stormKey);
    });
    const filtered = eligible.filter(storm => !duplicateKeys.has(storm.stormKey));
    filtered.sort((a, b) => a.sortTimeMs - b.sortTimeMs || a.stormKey.localeCompare(b.stormKey));
    return {
      storms: filtered,
      rejectedStorms: [
        ...materialized.filter(storm => !storm.eligible).map(storm => ({ stormKey: storm.stormKey, reason: storm.reason, rejectedCases: storm.rejectedCases })),
        ...Array.from(duplicateKeys).map(stormKey => ({ stormKey, reason: 'duplicate-storm-key' }))
      ]
    };
  }

  function reliabilitySummary(metric, minimumBinCount) {
    const bins = Array.isArray(metric?.reliabilityBins) ? metric.reliabilityBins : [];
    const usable = bins.filter(bin => Number(bin?.count) >= minimumBinCount && Number.isFinite(Number(bin?.calibrationGap)));
    return {
      usableBinCount: usable.length,
      maximumAbsoluteGap: usable.length ? Math.max(...usable.map(bin => Math.abs(Number(bin.calibrationGap)))) : null
    };
  }

  function fractionalImprovement(champion, challenger) {
    const oldValue = finite(champion);
    const newValue = finite(challenger);
    if (oldValue == null || newValue == null || oldValue < 0 || newValue < 0) return null;
    if (oldValue === 0) return newValue === 0 ? 0 : -Infinity;
    return (oldValue - newValue) / oldValue;
  }

  function fractionalRegression(champion, challenger) {
    const improvement = fractionalImprovement(champion, challenger);
    return improvement == null ? null : -improvement;
  }

  function evaluateChallengerGate(input) {
    const champion = input?.championEvaluation?.metrics ?? input?.championMetrics ?? null;
    const challenger = input?.challengerEvaluation?.metrics ?? input?.challengerMetrics ?? null;
    const holdoutStormCount = Math.max(0, Math.floor(finite(input?.holdoutStormCount) ?? 0));
    const thresholds = {
      minimumHoldoutStorms: Math.max(1, Math.floor(finite(input?.minimumHoldoutStorms) ?? 5)),
      minimumPredictionsPerSignal: Math.max(1, Math.floor(finite(input?.minimumPredictionsPerSignal) ?? 20)),
      minimumPrimaryBrierImprovementFraction: Math.max(0, finite(input?.minimumPrimaryBrierImprovementFraction) ?? 0.03),
      maximumOtherBrierRegressionFraction: Math.max(0, finite(input?.maximumOtherBrierRegressionFraction) ?? 0.02),
      maximumEceRegressionAbsolute: Math.max(0, finite(input?.maximumEceRegressionAbsolute) ?? 0.03),
      minimumReliabilityBinCount: Math.max(1, Math.floor(finite(input?.minimumReliabilityBinCount) ?? 3)),
      maximumReliabilityGapRegressionAbsolute: Math.max(0, finite(input?.maximumReliabilityGapRegressionAbsolute) ?? 0.10)
    };
    const primarySignal = SIGNALS.includes(input?.primarySignal) ? input.primarySignal : 'T8';
    const failedGates = [];
    if (!champion) failedGates.push('champion-evaluation-required');
    if (!challenger) failedGates.push('challenger-evaluation-required');
    if (input?.championEvaluationProvenanceConfirmed !== true) failedGates.push('champion-holdout-independence-unconfirmed');
    if (holdoutStormCount < thresholds.minimumHoldoutStorms) failedGates.push('insufficient-holdout-storms');

    const comparisons = {};
    SIGNALS.forEach(signal => {
      const c = champion?.[signal] ?? null;
      const n = challenger?.[signal] ?? null;
      const championReliability = reliabilitySummary(c, thresholds.minimumReliabilityBinCount);
      const challengerReliability = reliabilitySummary(n, thresholds.minimumReliabilityBinCount);
      const brierImprovement = fractionalImprovement(c?.brierScore, n?.brierScore);
      const brierRegression = fractionalRegression(c?.brierScore, n?.brierScore);
      const eceRegression = finite(c?.expectedCalibrationError) != null && finite(n?.expectedCalibrationError) != null
        ? finite(n.expectedCalibrationError) - finite(c.expectedCalibrationError) : null;
      const reliabilityGapRegression = championReliability.maximumAbsoluteGap != null && challengerReliability.maximumAbsoluteGap != null
        ? challengerReliability.maximumAbsoluteGap - championReliability.maximumAbsoluteGap : null;
      comparisons[signal] = {
        count: finite(n?.count) ?? 0,
        championBrierScore: finite(c?.brierScore),
        challengerBrierScore: finite(n?.brierScore),
        brierImprovementFraction: brierImprovement,
        brierRegressionFraction: brierRegression,
        championEce: finite(c?.expectedCalibrationError),
        challengerEce: finite(n?.expectedCalibrationError),
        eceRegressionAbsolute: eceRegression,
        championReliability,
        challengerReliability,
        reliabilityGapRegressionAbsolute: reliabilityGapRegression
      };
      if ((finite(n?.count) ?? 0) < thresholds.minimumPredictionsPerSignal) failedGates.push(`insufficient-predictions:${signal}`);
      if (signal === primarySignal) {
        if (brierImprovement == null || brierImprovement < thresholds.minimumPrimaryBrierImprovementFraction) failedGates.push(`primary-brier-improvement:${signal}`);
      } else if (brierRegression != null && brierRegression > thresholds.maximumOtherBrierRegressionFraction) {
        failedGates.push(`brier-regression:${signal}`);
      }
      if (eceRegression != null && eceRegression > thresholds.maximumEceRegressionAbsolute) failedGates.push(`ece-regression:${signal}`);
      if (reliabilityGapRegression != null && reliabilityGapRegression > thresholds.maximumReliabilityGapRegressionAbsolute) failedGates.push(`reliability-gap-regression:${signal}`);
    });

    return {
      eligibleForPromotion: failedGates.length === 0,
      promotionPerformed: false,
      primarySignal,
      holdoutStormCount,
      comparisons,
      failedGates: Array.from(new Set(failedGates)),
      thresholds,
      semantics: {
        championComparisonRequired: true,
        championHoldoutIndependenceRequired: true,
        brierGateIncluded: true,
        eceGateIncluded: true,
        reliabilityGapGateIncluded: true,
        manualPromotionRequired: true,
        automaticPromotion: false
      }
    };
  }

  function profileRecords(storms) {
    return storms.flatMap(storm => storm.cases.map(item => item.record));
  }

  function predictionRow(storm, item, estimate) {
    return {
      stormKey: storm.stormKey,
      caseId: item.caseId,
      asOf: item.asOf,
      probabilities: estimate?.available ? estimate.probabilities : null,
      outcome: storm.outcome,
      selectedCell: estimate?.selectedCell ?? null,
      estimateAvailable: Boolean(estimate?.available),
      unavailableReason: estimate?.available ? null : estimate?.reason ?? 'estimate-unavailable'
    };
  }

  async function runSignalCalibrationWalkForward(input, deps) {
    const calibration = requireCalibration(deps);
    const minimumTrainingStorms = Math.max(2, Math.floor(finite(input?.minimumTrainingStorms) ?? 8));
    const challengerProfileId = String(input?.challengerProfileId ?? '').trim();
    if (!challengerProfileId) throw new Error('challengerProfileId is required');
    const generatedAt = input?.generatedAt || new Date().toISOString();
    const materialized = await materializeHistoricalStorms(input, deps);
    const storms = materialized.storms;
    const challengerPredictions = [];
    const championPredictions = [];
    const holdoutStorms = [];
    const skippedHoldouts = [];

    for (const storm of storms) {
      const trainingStorms = storms.filter(candidate => candidate.sortTimeMs < storm.sortTimeMs);
      if (trainingStorms.length < minimumTrainingStorms) {
        skippedHoldouts.push({ stormKey: storm.stormKey, reason: 'insufficient-prior-storms', priorStormCount: trainingStorms.length });
        continue;
      }
      const trainingRecords = profileRecords(trainingStorms);
      const profile = calibration.buildHkoSignalCalibrationProfile(trainingRecords, {
        ...(input?.calibrationOptions || {}),
        profileId: `walkforward:${challengerProfileId}:${storm.stormKey}`,
        generatedAt
      });
      holdoutStorms.push({
        stormKey: storm.stormKey,
        sortTime: storm.sortTime,
        trainingStormCount: trainingStorms.length,
        trainingStorms: trainingStorms.map(item => item.stormKey)
      });
      for (const item of storm.cases) {
        const estimate = calibration.estimateHkoSignalRisk(profile, item.artifacts.signalInputs, item.artifacts.weightedHongKongImpact, item.artifacts.weightedConsensusTrack);
        challengerPredictions.push(predictionRow(storm, item, estimate));
        if (input?.championProfile) {
          const championEstimate = calibration.estimateHkoSignalRisk(input.championProfile, item.artifacts.signalInputs, item.artifacts.weightedHongKongImpact, item.artifacts.weightedConsensusTrack);
          championPredictions.push(predictionRow(storm, item, championEstimate));
        }
      }
    }

    const usableChallengerPredictions = challengerPredictions.filter(row => row.estimateAvailable && row.probabilities);
    const usableChampionPredictions = championPredictions.filter(row => row.estimateAvailable && row.probabilities);
    const challengerEvaluation = calibration.evaluateSignalPredictions(usableChallengerPredictions, input?.evaluationOptions);
    const championEvaluation = input?.championProfile
      ? calibration.evaluateSignalPredictions(usableChampionPredictions, input?.evaluationOptions)
      : null;
    const gate = evaluateChallengerGate({
      championEvaluation,
      challengerEvaluation,
      holdoutStormCount: holdoutStorms.length,
      championEvaluationProvenanceConfirmed: input?.championProfileProvenance?.holdoutIndependent === true,
      ...(input?.gateOptions || {})
    });

    const allRecords = profileRecords(storms);
    const finalProfile = calibration.buildHkoSignalCalibrationProfile(allRecords, {
      ...(input?.calibrationOptions || {}),
      profileId: challengerProfileId,
      generatedAt
    });
    const profileRow = {
      profile_id: challengerProfileId,
      profile_version: finalProfile.schemaVersion,
      role: 'challenger',
      training_window_start: finalProfile?.trainingWindow?.start ?? null,
      training_window_end: finalProfile?.trainingWindow?.end ?? null,
      storm_count: finalProfile?.coverage?.distinctStorms ?? 0,
      sample_count: finalProfile?.coverage?.eligibleSamples ?? 0,
      profile_json: JSON.stringify(finalProfile),
      metrics_json: JSON.stringify({ walkForward: challengerEvaluation, champion: championEvaluation, gate })
    };

    return {
      schemaVersion: TRAINER_VERSION,
      generatedAt,
      challenger: {
        schemaVersion: CHALLENGER_VERSION,
        profileId: challengerProfileId,
        role: 'challenger',
        profile: finalProfile,
        profileRow,
        walkForwardEvaluation: challengerEvaluation,
        championEvaluation,
        championProfileProvenance: input?.championProfileProvenance ?? null,
        gate,
        eligibleForPromotion: gate.eligibleForPromotion,
        promotionPerformed: false
      },
      replay: {
        suppliedStorms: Array.isArray(input?.storms) ? input.storms.length : 0,
        eligibleStorms: storms.length,
        rejectedStorms: materialized.rejectedStorms,
        holdoutStormCount: holdoutStorms.length,
        holdoutStorms,
        skippedHoldouts,
        challengerPredictionCount: challengerPredictions.length,
        usableChallengerPredictionCount: usableChallengerPredictions.length,
        championPredictionCount: championPredictions.length,
        usableChampionPredictionCount: usableChampionPredictions.length
      },
      semantics: {
        expandingWindowWalkForward: true,
        splitByStorm: true,
        holdoutStormNeverTrainsItsOwnProfile: true,
        sameTimestampStormsDoNotTrainEachOther: true,
        ai11LeakageValidatorReused: true,
        finalProfileMayTrainOnAllEligibleStormsAfterWalkForwardEvaluation: true,
        challengerOnly: true,
        automaticPromotion: false,
        databaseWritePerformed: false,
        aiGenerated: false
      }
    };
  }

  return Object.freeze({
    TRAINER_VERSION,
    CHALLENGER_VERSION,
    SIGNALS,
    validateHistoricalCaseCutoff,
    materializeHistoricalStorms,
    evaluateChallengerGate,
    runSignalCalibrationWalkForward
  });
});
