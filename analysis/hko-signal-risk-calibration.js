(function attachHkoSignalRiskCalibration(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StormHkoSignalRiskCalibration = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHkoSignalRiskCalibration() {
  'use strict';

  const PROFILE_VERSION = 'hko-signal-calibration-profile/v1';
  const ESTIMATE_VERSION = 'hko-signal-risk-estimate/v1';
  const SIGNALS = Object.freeze(['T1', 'T3', 'T8']);
  const LEVELS = Object.freeze(['global', 'distance', 'distanceLead', 'distanceLeadWind']);
  const HOUR_MS = 60 * 60 * 1000;

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

  function signalRank(value) {
    if (value == null) return null;
    const text = String(value).trim().toUpperCase().replace(/NO\.?\s*/g, '').replace(/SIGNAL\s*/g, '').replace(/T/g, '');
    if (/10/.test(text)) return 10;
    if (/9/.test(text)) return 9;
    if (/8/.test(text)) return 8;
    if (/3/.test(text)) return 3;
    if (/1/.test(text)) return 1;
    return null;
  }

  function deriveTargets(highestSignal) {
    const rank = signalRank(highestSignal);
    if (rank == null) return null;
    return {
      rank,
      T1: rank >= 1,
      T3: rank >= 3,
      T8: rank >= 8,
      T9: rank >= 9,
      T10: rank >= 10
    };
  }

  function distanceBucket(value) {
    const km = finite(value);
    if (km == null || km < 0) return 'unknown';
    if (km < 100) return '0-100km';
    if (km < 200) return '100-200km';
    if (km < 300) return '200-300km';
    if (km < 500) return '300-500km';
    if (km < 800) return '500-800km';
    return '800km+';
  }

  function leadBucket(value) {
    const hours = finite(value);
    if (hours == null) return 'unknown';
    if (hours < 0) return 'past';
    if (hours < 12) return '0-12h';
    if (hours < 24) return '12-24h';
    if (hours < 48) return '24-48h';
    if (hours < 72) return '48-72h';
    if (hours < 120) return '72-120h';
    return '120h+';
  }

  function windBucket(value) {
    const ms = finite(value);
    if (ms == null || ms < 0) return 'unknown';
    if (ms < 20) return '<20mps';
    if (ms < 30) return '20-30mps';
    if (ms < 40) return '30-40mps';
    if (ms < 50) return '40-50mps';
    return '50mps+';
  }

  function buildFeatureContext(signalInputs, weightedImpact, weightedTrack) {
    const weightedClosest = weightedImpact?.closestApproach ?? null;
    const distanceKm = finite(weightedClosest?.distanceKm)
      ?? finite(signalInputs?.featureVector?.consensusClosestDistanceKm)
      ?? finite(signalInputs?.featureVector?.closestDistanceMinKm);
    const referenceBaseMs = timeMs(weightedTrack?.referenceBaseTime);
    const closestMs = timeMs(weightedClosest?.time);
    const leadHours = Number.isFinite(referenceBaseMs) && Number.isFinite(closestMs)
      ? (closestMs - referenceBaseMs) / HOUR_MS
      : finite(signalInputs?.featureVector?.consensusClosestLeadHours);
    const windMs = finite(signalInputs?.featureVector?.closestMaximumWindMedianMs)
      ?? finite(signalInputs?.featureVector?.currentMaximumWindMedianMs);
    const distance = distanceBucket(distanceKm);
    const lead = leadBucket(leadHours);
    const wind = windBucket(windMs);
    return {
      distanceKm,
      closestLeadHours: leadHours,
      representativeMaximumWindMs: windMs,
      distanceBucket: distance,
      leadBucket: lead,
      windBucket: wind,
      keys: {
        global: 'global',
        distance,
        distanceLead: `${distance}|${lead}`,
        distanceLeadWind: `${distance}|${lead}|${wind}`
      },
      diagnostics: {
        usableAgencyCount: finite(signalInputs?.featureVector?.usableAgencyCount),
        comparisonSpreadKm: finite(signalInputs?.featureVector?.comparisonSpreadKm),
        closestTimeSpreadHours: finite(signalInputs?.featureVector?.closestTimeSpreadHours),
        windRadiusAgencyCount: finite(signalInputs?.featureVector?.windRadiusAgencyCount)
      }
    };
  }

  function validateCalibrationRecord(record, options) {
    const toleranceMs = Math.max(0, finite(options?.leakageToleranceMs) ?? 1000);
    if (!record || typeof record !== 'object') return { eligible: false, reason: 'invalid-record' };
    const stormKey = String(record.stormKey ?? '').trim();
    if (!stormKey) return { eligible: false, reason: 'missing-storm-key' };
    const asOfMs = timeMs(record.asOf);
    if (!Number.isFinite(asOfMs)) return { eligible: false, reason: 'missing-as-of' };
    const outcome = record.outcome && typeof record.outcome === 'object' ? record.outcome : {};
    if (outcome.officialHko !== true) return { eligible: false, reason: 'outcome-not-explicit-official-hko' };
    if (String(outcome.signalSystemEra || '').toLowerCase() !== 'modern') return { eligible: false, reason: 'non-modern-signal-era' };
    const targets = deriveTargets(outcome.highestSignal ?? outcome.signal);
    if (!targets) return { eligible: false, reason: 'invalid-highest-signal' };
    const generatedMs = timeMs(record.signalInputs?.generatedAt);
    if (Number.isFinite(generatedMs) && generatedMs > asOfMs + toleranceMs) return { eligible: false, reason: 'signal-inputs-after-as-of' };
    const context = buildFeatureContext(record.signalInputs, record.weightedHongKongImpact, record.weightedConsensusTrack);
    return {
      eligible: true,
      stormKey,
      asOf: new Date(asOfMs).toISOString(),
      context,
      targets,
      outcome: {
        highestSignal: outcome.highestSignal ?? outcome.signal,
        source: outcome.source ?? null,
        signalSystemEra: 'modern',
        officialHko: true
      }
    };
  }

  function createAccumulator() {
    return { samples: [], storms: new Map() };
  }

  function addToAccumulator(acc, item) {
    acc.samples.push(item);
    const list = acc.storms.get(item.stormKey) || [];
    list.push(item);
    acc.storms.set(item.stormKey, list);
  }

  function rawCell(acc) {
    const stormCount = acc.storms.size;
    const events = { T1: 0, T3: 0, T8: 0 };
    for (const samples of acc.storms.values()) {
      const weight = 1 / samples.length;
      samples.forEach(sample => SIGNALS.forEach(signal => {
        if (sample.targets[signal]) events[signal] += weight;
      }));
    }
    const rawRate = Object.fromEntries(SIGNALS.map(signal => [signal, stormCount ? events[signal] / stormCount : null]));
    return {
      stormCount,
      sampleCount: acc.samples.length,
      effectiveSampleCount: stormCount,
      events,
      rawRate
    };
  }

  function enforceHierarchy(probabilities) {
    const t1 = Math.max(0, Math.min(1, finite(probabilities?.T1) ?? 0));
    const t3 = Math.min(t1, Math.max(0, Math.min(1, finite(probabilities?.T3) ?? 0)));
    const t8 = Math.min(t3, Math.max(0, Math.min(1, finite(probabilities?.T8) ?? 0)));
    return { T1: t1, T3: t3, T8: t8 };
  }

  function smoothCell(cell, parentProbabilities, priorStrength, isGlobal) {
    const probabilities = {};
    SIGNALS.forEach(signal => {
      const parent = isGlobal ? 0.5 : finite(parentProbabilities?.[signal]) ?? 0.5;
      const strength = isGlobal ? 2 : priorStrength;
      probabilities[signal] = (cell.events[signal] + parent * strength) / (cell.effectiveSampleCount + strength);
    });
    return { ...cell, probabilities: enforceHierarchy(probabilities) };
  }

  function buildHkoSignalCalibrationProfile(records, options) {
    const input = Array.isArray(records) ? records : [];
    const minimumStorms = Math.max(2, Math.floor(finite(options?.minimumStorms) ?? 5));
    const priorStrength = Math.max(0, finite(options?.priorStrength) ?? 4);
    const generatedAt = options?.generatedAt || new Date().toISOString();
    const accepted = [];
    const rejected = [];
    input.forEach((record, index) => {
      const result = validateCalibrationRecord(record, options);
      if (result.eligible) accepted.push(result);
      else rejected.push({ index, stormKey: record?.stormKey ?? null, reason: result.reason });
    });

    const accumulators = Object.fromEntries(LEVELS.map(level => [level, new Map()]));
    accepted.forEach(item => {
      LEVELS.forEach(level => {
        const key = item.context.keys[level];
        if (!accumulators[level].has(key)) accumulators[level].set(key, createAccumulator());
        addToAccumulator(accumulators[level].get(key), item);
      });
    });

    const cells = { global: {}, distance: {}, distanceLead: {}, distanceLeadWind: {} };
    const globalRaw = rawCell(accumulators.global.get('global') || createAccumulator());
    cells.global.global = smoothCell(globalRaw, null, priorStrength, true);

    const parentKey = {
      distance: key => 'global',
      distanceLead: key => key.split('|')[0],
      distanceLeadWind: key => key.split('|').slice(0, 2).join('|')
    };
    ['distance', 'distanceLead', 'distanceLeadWind'].forEach(level => {
      for (const [key, acc] of accumulators[level]) {
        const parentLevel = level === 'distance' ? 'global' : (level === 'distanceLead' ? 'distance' : 'distanceLead');
        const parent = cells[parentLevel][parentKey[level](key)] || cells.global.global;
        cells[level][key] = smoothCell(rawCell(acc), parent.probabilities, priorStrength, false);
      }
    });

    const asOfValues = accepted.map(item => timeMs(item.asOf)).filter(Number.isFinite);
    const includedStorms = Array.from(new Set(accepted.map(item => item.stormKey))).sort();
    return {
      schemaVersion: PROFILE_VERSION,
      profileId: options?.profileId ?? null,
      generatedAt,
      trainingWindow: asOfValues.length ? {
        start: new Date(Math.min(...asOfValues)).toISOString(),
        end: new Date(Math.max(...asOfValues)).toISOString()
      } : null,
      coverage: {
        suppliedSamples: input.length,
        eligibleSamples: accepted.length,
        rejectedSamples: rejected.length,
        distinctStorms: includedStorms.length,
        includedStorms,
        rejected
      },
      config: { minimumStorms, priorStrength, leakageToleranceMs: Math.max(0, finite(options?.leakageToleranceMs) ?? 1000) },
      cells,
      semantics: {
        modernSignalEraOnly: true,
        officialHkoOutcomeRequired: true,
        stormBalancedWithinCell: true,
        advisoryRowsDoNotCountAsIndependentStorms: true,
        hierarchicalBackoff: true,
        probabilityHierarchyEnforced: true,
        t9T10StatisticalCalibrationIncluded: false,
        trainingDoesNotPromoteProfile: true,
        aiGenerated: false
      }
    };
  }

  function selectCalibrationCell(profile, context) {
    const minimumStorms = Math.max(2, Math.floor(finite(profile?.config?.minimumStorms) ?? 5));
    const candidates = [
      ['distanceLeadWind', context.keys.distanceLeadWind],
      ['distanceLead', context.keys.distanceLead],
      ['distance', context.keys.distance],
      ['global', 'global']
    ];
    for (const [level, key] of candidates) {
      const cell = profile?.cells?.[level]?.[key];
      if (cell && finite(cell.stormCount) >= minimumStorms) return { level, key, cell };
    }
    return null;
  }

  function confidenceForStormCount(stormCount) {
    if (stormCount >= 25) return 'high';
    if (stormCount >= 10) return 'medium';
    return 'low';
  }

  function estimateHkoSignalRisk(profile, signalInputs, weightedImpact, weightedTrack) {
    if (!profile || profile.schemaVersion !== PROFILE_VERSION) {
      return { schemaVersion: ESTIMATE_VERSION, available: false, reason: 'no-compatible-calibration-profile' };
    }
    const context = buildFeatureContext(signalInputs, weightedImpact, weightedTrack);
    const selected = selectCalibrationCell(profile, context);
    if (!selected) {
      return { schemaVersion: ESTIMATE_VERSION, available: false, reason: 'insufficient-calibration-storms', context };
    }
    const modelProbabilities = enforceHierarchy(selected.cell.probabilities);
    const officialContext = signalInputs?.officialHkoWarningContext || {};
    const currentRank = officialContext.provided ? signalRank(officialContext.currentSignal) : null;
    const probabilities = { ...modelProbabilities };
    if (currentRank != null) {
      if (currentRank >= 1) probabilities.T1 = 1;
      if (currentRank >= 3) probabilities.T3 = 1;
      if (currentRank >= 8) probabilities.T8 = 1;
    }
    const finalProbabilities = enforceHierarchy(probabilities);
    return {
      schemaVersion: ESTIMATE_VERSION,
      available: true,
      profileId: profile.profileId ?? null,
      profileVersion: profile.schemaVersion,
      context,
      selectedCell: {
        level: selected.level,
        key: selected.key,
        stormCount: selected.cell.stormCount,
        sampleCount: selected.cell.sampleCount,
        effectiveSampleCount: selected.cell.effectiveSampleCount,
        confidence: confidenceForStormCount(selected.cell.stormCount)
      },
      probabilities: finalProbabilities,
      modelProbabilities,
      officialContextAdjustment: {
        applied: currentRank != null,
        currentSignal: officialContext.currentSignal ?? null,
        currentSignalRank: currentRank,
        source: officialContext.source ?? null,
        issuedAt: officialContext.issuedAt ?? null
      },
      rareSignals: {
        T9: { probability: null, mode: 'rule-evidence-only', currentlyObserved: currentRank != null && currentRank >= 9 },
        T10: { probability: null, mode: 'rule-evidence-only', currentlyObserved: currentRank != null && currentRank >= 10 }
      },
      semantics: {
        stormTrackRiskEstimate: true,
        officialHkoForecast: false,
        officialHkoDecisionInferred: false,
        probabilityHierarchy: 'T1>=T3>=T8',
        t9T10StatisticalProbabilitySuppressed: true,
        officialAlreadyIssuedSignalMayFloorProbabilityToOne: true,
        aiGenerated: false
      }
    };
  }

  function evaluateSignalPredictions(predictions, options) {
    const rows = Array.isArray(predictions) ? predictions : [];
    const binCount = Math.max(2, Math.floor(finite(options?.binCount) ?? 5));
    const metrics = {};
    SIGNALS.forEach(signal => {
      const samples = [];
      rows.forEach(row => {
        const targets = deriveTargets(row?.outcome?.highestSignal ?? row?.outcome?.signal);
        const probability = finite(row?.probabilities?.[signal]);
        if (!targets || probability == null || probability < 0 || probability > 1) return;
        samples.push({ probability, actual: targets[signal] ? 1 : 0 });
      });
      const brierScore = samples.length
        ? samples.reduce((sum, item) => sum + (item.probability - item.actual) ** 2, 0) / samples.length
        : null;
      const reliabilityBins = Array.from({ length: binCount }, (_, index) => {
        const min = index / binCount;
        const max = (index + 1) / binCount;
        const bucket = samples.filter(item => item.probability >= min && (index === binCount - 1 ? item.probability <= max : item.probability < max));
        const meanProbability = bucket.length ? bucket.reduce((sum, item) => sum + item.probability, 0) / bucket.length : null;
        const observedRate = bucket.length ? bucket.reduce((sum, item) => sum + item.actual, 0) / bucket.length : null;
        return { minProbability: min, maxProbability: max, count: bucket.length, meanProbability, observedRate, calibrationGap: bucket.length ? meanProbability - observedRate : null };
      });
      const expectedCalibrationError = samples.length
        ? reliabilityBins.reduce((sum, bin) => sum + (bin.count / samples.length) * Math.abs(bin.calibrationGap ?? 0), 0)
        : null;
      metrics[signal] = { count: samples.length, brierScore, expectedCalibrationError, reliabilityBins };
    });
    return {
      metrics,
      binCount,
      semantics: { holdoutPredictionsExpected: true, reliabilityDiagramDataIncluded: true, evaluationDoesNotTrainOrPromote: true }
    };
  }

  return Object.freeze({
    PROFILE_VERSION,
    ESTIMATE_VERSION,
    SIGNALS,
    signalRank,
    deriveTargets,
    distanceBucket,
    leadBucket,
    windBucket,
    buildFeatureContext,
    validateCalibrationRecord,
    buildHkoSignalCalibrationProfile,
    selectCalibrationCell,
    estimateHkoSignalRisk,
    evaluateSignalPredictions
  });
});
