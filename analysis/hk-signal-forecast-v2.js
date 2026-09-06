(function attachStormHkSignalForecastV2(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StormHkSignalForecastV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormHkSignalForecastV2() {
  'use strict';

  const VERSION = 'hk-signal-shadow-v2/0.3';
  const HOUR_MS = 60 * 60 * 1000;
  const TERMINAL_STALE_HOURS = 12;
  const PHASE_NEAR_TERM_HOURS = 36;
  const SIGNAL_THRESHOLDS = Object.freeze({
    T1: Object.freeze({ possible: 0.35, likely: 0.58 }),
    T3: Object.freeze({ possible: 0.38, likely: 0.65 }),
    T8: Object.freeze({ possible: 0.40, likely: 0.70 })
  });

  function finite(value) {
    if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
  }

  function timeMs(value) {
    if (value == null || value === '') return null;
    if (Number.isFinite(value)) return value;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function leadHours(reference, target) {
    const referenceMs = timeMs(reference);
    const targetMs = timeMs(target);
    if (!Number.isFinite(referenceMs) || !Number.isFinite(targetMs)) return null;
    return (targetMs - referenceMs) / HOUR_MS;
  }

  function cloneSerializable(value) {
    if (value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); }
    catch { return null; }
  }

  function terminalIntensityHint(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return false;
    return /low pressure area|\blpa\b|低壓區|低压区|dissipat|remnant low/.test(text);
  }

  function sourceShape(source) {
    const positions = Array.isArray(source?.positions) ? source.positions : [];
    const forecast = Array.isArray(source?.forecast) ? source.forecast : [];
    const current = positions[positions.length - 1]
      || source?.current
      || null;
    const forecastCount = Array.isArray(source?.forecast)
      ? forecast.length
      : Math.max(0, finite(source?.forecastCount) ?? 0);
    return {
      bulletinTime: source?.bulletinTime ?? null,
      current,
      forecastCount
    };
  }

  function buildSourceLifecycleContext(groupOrSources, observedAt, options = {}) {
    const observedMs = timeMs(observedAt);
    const rawSources = options.sourcesDirect === true
      ? (groupOrSources || {})
      : (groupOrSources?.sources || {});
    const sourceEntries = Object.entries(rawSources)
      .filter(([, source]) => source && typeof source === 'object');
    const sourceAges = [];
    const intensities = {};
    let forecastPointTotal = 0;

    for (const [agency, source] of sourceEntries) {
      const normalized = sourceShape(source);
      forecastPointTotal += normalized.forecastCount;
      if (normalized.current?.intensity != null && String(normalized.current.intensity).trim()) {
        intensities[agency] = String(normalized.current.intensity);
      }
      const evidenceMs = timeMs(normalized.bulletinTime) ?? timeMs(normalized.current?.time);
      if (Number.isFinite(observedMs) && Number.isFinite(evidenceMs) && observedMs >= evidenceMs) {
        sourceAges.push({ agency, ageHours: (observedMs - evidenceMs) / HOUR_MS });
      }
    }

    const ages = sourceAges.map(item => item.ageHours).filter(Number.isFinite);
    const sourceAgencyCount = sourceEntries.length;
    const freshestBulletinAgeHours = ages.length ? Math.min(...ages) : null;
    const stalestBulletinAgeHours = ages.length ? Math.max(...ages) : null;
    const terminalIntensityAgencyCount = Object.values(intensities).filter(terminalIntensityHint).length;
    const allSourcesStale = sourceAgencyCount > 0
      && ages.length === sourceAgencyCount
      && ages.every(age => age >= TERMINAL_STALE_HOURS);
    const terminalStateCandidate = sourceAgencyCount === 1
      && forecastPointTotal === 0
      && allSourcesStale
      && terminalIntensityAgencyCount === 1;

    return {
      observedAt: Number.isFinite(observedMs) ? new Date(observedMs).toISOString() : null,
      sourceAgencyCount,
      sourceAgencies: sourceEntries.map(([agency]) => agency).sort(),
      forecastPointTotal,
      sourceAgeHoursByAgency: Object.fromEntries(sourceAges.map(item => [item.agency, item.ageHours])),
      freshestBulletinAgeHours,
      stalestBulletinAgeHours,
      allSourcesStale,
      terminalStaleThresholdHours: TERMINAL_STALE_HOURS,
      currentIntensityByAgency: intensities,
      terminalIntensityAgencyCount,
      terminalStateCandidate
    };
  }

  function timelinePoints(threatAssessment, generatedAt) {
    return (Array.isArray(threatAssessment?.timeline) ? threatAssessment.timeline : [])
      .map(item => {
        const lead = finite(item?.leadHours) ?? leadHours(generatedAt, item?.validTime ?? item?.time);
        const distanceKm = finite(item?.distanceMedianKm);
        if (!Number.isFinite(lead) || lead < -1e-6 || !Number.isFinite(distanceKm)) return null;
        return {
          label: item?.label ?? null,
          validTime: item?.validTime ?? item?.time ?? null,
          leadHours: lead,
          distanceKm,
          windMedianMs: finite(item?.windMedianMs),
          agencyCount: Math.max(0, finite(item?.agencyCount) ?? (Array.isArray(item?.agencies) ? item.agencies.length : 0))
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.leadHours - b.leadHours);
  }

  function minimumPoint(points) {
    if (!points.length) return null;
    return points.reduce((best, item) => item.distanceKm < best.distanceKm ? item : best, points[0]);
  }

  function derivePhaseContext(threatAssessment, generatedAt) {
    const points = timelinePoints(threatAssessment, generatedAt);
    const analyzers = threatAssessment?.analyzers || {};
    const directApproach = clamp(finite(analyzers?.directApproach?.confidence) ?? 0);
    const directDepart = clamp(finite(analyzers?.directDepart?.confidence) ?? 0);
    const reApproach = clamp(finite(analyzers?.reApproach?.confidence) ?? 0);
    const quasiStationary = clamp(finite(analyzers?.quasiStationary?.confidence) ?? 0);

    if (!points.length) {
      return {
        schemaVersion: 'hk-signal-phase-context/v1',
        available: false,
        reason: 'no-future-timeline',
        operationalPhase: directDepart > directApproach + 0.15 ? 'departure'
          : (directApproach > directDepart + 0.15 ? 'approach' : 'unresolved'),
        directApproach,
        directDepart,
        reApproach,
        quasiStationary,
        currentPhaseMinimum: null,
        laterPhaseMinimum: null,
        globalFutureMinimum: null,
        globalMinimumBelongsToLaterPhase: false,
        multiPhase: false
      };
    }

    const nearPoints = points.filter(item => item.leadHours <= PHASE_NEAR_TERM_HOURS);
    const currentPool = nearPoints.length ? nearPoints : points.slice(0, Math.min(3, points.length));
    const currentPhaseMinimum = minimumPoint(currentPool);
    const laterStart = Math.max(
      PHASE_NEAR_TERM_HOURS,
      (finite(currentPhaseMinimum?.leadHours) ?? 0) + 12
    );
    const laterPoints = points.filter(item => item.leadHours > laterStart);
    const laterPhaseMinimum = minimumPoint(laterPoints);
    const globalFutureMinimum = minimumPoint(points);
    const materialLaterImprovement = Boolean(currentPhaseMinimum && laterPhaseMinimum)
      && laterPhaseMinimum.distanceKm <= currentPhaseMinimum.distanceKm - Math.max(30, currentPhaseMinimum.distanceKm * 0.10);
    const globalMinimumBelongsToLaterPhase = Boolean(currentPhaseMinimum && globalFutureMinimum)
      && globalFutureMinimum.leadHours > currentPhaseMinimum.leadHours + 12
      && globalFutureMinimum.distanceKm <= currentPhaseMinimum.distanceKm - Math.max(20, currentPhaseMinimum.distanceKm * 0.07);
    const multiPhase = (reApproach >= 0.30 && materialLaterImprovement)
      || globalMinimumBelongsToLaterPhase;

    let operationalPhase = 'mixed';
    if (multiPhase && directDepart > directApproach + 0.10) operationalPhase = 'departure-before-reapproach';
    else if (multiPhase) operationalPhase = 'multi-phase';
    else if (directDepart > directApproach + 0.15) operationalPhase = 'departure';
    else if (directApproach > directDepart + 0.15) operationalPhase = 'approach';
    else if (quasiStationary >= 0.45) operationalPhase = 'quasi-stationary';

    return {
      schemaVersion: 'hk-signal-phase-context/v1',
      available: true,
      operationalPhase,
      directApproach,
      directDepart,
      reApproach,
      quasiStationary,
      currentPhaseMinimum,
      laterPhaseMinimum,
      globalFutureMinimum,
      globalMinimumBelongsToLaterPhase,
      materialLaterImprovement,
      multiPhase,
      nearTermHours: PHASE_NEAR_TERM_HOURS,
      futureCheckpointCount: points.length
    };
  }

  function degradedLikelihood(original, riskIndex, code) {
    const thresholds = SIGNAL_THRESHOLDS[code];
    if (!thresholds || original === 'unlikely' || !Number.isFinite(riskIndex)) return original;
    if (riskIndex < thresholds.possible) return 'unlikely';
    if (original === 'likely' && riskIndex < thresholds.likely) return 'possible';
    return original;
  }

  function strongestSupport(signal, usableAgencyCount, generatedAt) {
    const strongest = signal?.strongestCheckpoint || null;
    const total = Math.max(0, finite(strongest?.totalAgencyCount) ?? 0);
    const support = Math.max(0, finite(strongest?.supportAgencyCount) ?? 0);
    const participationFraction = usableAgencyCount > 0 && total > 0
      ? clamp(total / usableAgencyCount)
      : (total > 0 ? 1 : 0);
    const positiveSupportFraction = total > 0 ? clamp(support / total) : 0;
    const strongestLeadHours = strongest?.validTime ? leadHours(generatedAt, strongest.validTime) : null;
    return {
      totalAgencyCount: total,
      supportAgencyCount: support,
      participationFraction,
      positiveSupportFraction,
      strongestLeadHours
    };
  }

  function t1DecisionReadiness(signal, support, phaseContext) {
    const risk = finite(signal?.riskIndex);
    if (!Number.isFinite(risk)) return null;
    const lead = Math.max(0, finite(support?.strongestLeadHours) ?? 72);
    const leadCredibility = 1 / (1 + lead / 48);
    const persistence = Math.max(0, finite(signal?.persistenceHours) ?? 0);
    const persistenceCredibility = 1 - Math.exp(-persistence / 12);
    const supportFraction = support?.totalAgencyCount > 0
      ? support.positiveSupportFraction
      : 0.50;
    let phaseFactor = 1;
    if (phaseContext?.operationalPhase === 'departure') phaseFactor = 0.76;
    else if (phaseContext?.operationalPhase === 'departure-before-reapproach') phaseFactor = 0.86;
    else if (phaseContext?.operationalPhase === 'multi-phase') phaseFactor = 0.92;
    const readinessFactor = clamp(
      0.60
      + 0.18 * supportFraction
      + 0.12 * leadCredibility
      + 0.10 * persistenceCredibility,
      0.55,
      1
    ) * phaseFactor;
    return {
      index: clamp(risk * readinessFactor),
      factor: readinessFactor,
      supportFraction,
      leadCredibility,
      persistenceCredibility,
      phaseFactor,
      likelyFloor: 0.52
    };
  }

  function classifyTiming(signal, futureTimelineCount, hoursAfterMinimum, phaseContext, generatedAt) {
    if (signal?.likelihood === 'unlikely') return 'not-applicable';
    const startLead = leadHours(generatedAt, signal?.estimatedWindow?.start);
    if (signal?.estimatedWindow?.start && signal?.estimatedWindow?.end) {
      if (phaseContext?.multiPhase === true
          && Number.isFinite(startLead)
          && startLead > PHASE_NEAR_TERM_HOURS) return 'later-phase-estimated';
      return 'estimated';
    }
    if (futureTimelineCount > 0) {
      return phaseContext?.multiPhase === true
        ? 'multi-phase-left-censored-or-horizon-limited'
        : 'left-censored-or-horizon-limited';
    }
    if (hoursAfterMinimum > 0) return 'post-minimum-no-future';
    return 'unresolved';
  }

  function buildForecast({ basicForecast, signalInputs, threatAssessment, generatedAt, sourceLifecycle } = {}) {
    if (basicForecast?.available !== true) {
      return {
        schemaVersion: VERSION,
        available: false,
        reason: basicForecast?.reason || 'v1-unavailable',
        semantics: { shadowOnly: true, officialHkoForecast: false, aiGenerated: false }
      };
    }

    const output = cloneSerializable(basicForecast);
    output.schemaVersion = VERSION;
    output.baseForecastSchemaVersion = basicForecast.schemaVersion ?? null;
    output.generatedAt = generatedAt ?? basicForecast.generatedAt ?? null;

    const usableAgencyCount = Math.max(0, finite(signalInputs?.featureVector?.usableAgencyCount)
      ?? finite(signalInputs?.coverage?.usableAgencyCount)
      ?? 0);
    const presentAgencyCount = Math.max(0, finite(sourceLifecycle?.sourceAgencyCount) ?? usableAgencyCount);
    const presenceCoverage = clamp(presentAgencyCount / 4);
    const usableWithinPresent = presentAgencyCount > 0
      ? clamp(usableAgencyCount / presentAgencyCount)
      : 0;
    const presenceConfidenceFactor = 0.72 + 0.28 * presenceCoverage;
    const usabilityConfidenceFactor = 0.72 + 0.28 * usableWithinPresent;
    const confidenceCoverageFactor = clamp(presenceConfidenceFactor * usabilityConfidenceFactor);

    const closestTime = basicForecast?.impact?.closestApproach?.time ?? null;
    const minimumLeadHours = leadHours(output.generatedAt, closestTime);
    const hoursAfterMinimum = Number.isFinite(minimumLeadHours) ? Math.max(0, -minimumLeadHours) : 0;
    const phaseContext = derivePhaseContext(threatAssessment, output.generatedAt);
    const directDepart = clamp(finite(threatAssessment?.analyzers?.directDepart?.confidence) ?? 0);
    const futureTimelineCount = phaseContext?.futureCheckpointCount ?? 0;
    const futureThreatExists = futureTimelineCount > 0;
    const lifecyclePenalty = !futureThreatExists && hoursAfterMinimum > 0
      ? clamp(directDepart * (hoursAfterMinimum / (hoursAfterMinimum + 12)) * 0.40, 0, 0.40)
      : 0;
    const terminalCandidate = sourceLifecycle?.terminalStateCandidate === true
      && !futureThreatExists
      && hoursAfterMinimum > 0;
    const terminalAgeHours = finite(sourceLifecycle?.freshestBulletinAgeHours);
    const terminalAgeBlend = terminalCandidate && Number.isFinite(terminalAgeHours)
      ? clamp((terminalAgeHours - TERMINAL_STALE_HOURS) / TERMINAL_STALE_HOURS)
      : 0;
    const terminalLifecyclePenalty = terminalCandidate
      ? clamp(0.22 + terminalAgeBlend * 0.10, 0, 0.32)
      : 0;
    const adjustments = [];

    if (confidenceCoverageFactor < 0.999) adjustments.push({
      code: 'source-coverage-confidence-v2',
      label: '來源存在/可用度信心修正',
      factor: confidenceCoverageFactor,
      presentAgencyCount,
      usableAgencyCount,
      presenceCoverage,
      usableWithinPresent
    });
    if (lifecyclePenalty >= 0.01) adjustments.push({
      code: 'post-minimum-departure-decay',
      label: '最近點後離港殘留衰減',
      penalty: lifecyclePenalty,
      hoursAfterMinimum,
      directDepart
    });
    if (terminalLifecyclePenalty >= 0.01) adjustments.push({
      code: 'terminal-stale-lifecycle-decay',
      label: '退化後陳舊資料殘留衰減',
      penalty: terminalLifecyclePenalty,
      freshestBulletinAgeHours: terminalAgeHours,
      sourceAgencyCount: sourceLifecycle?.sourceAgencyCount ?? null,
      forecastPointTotal: sourceLifecycle?.forecastPointTotal ?? null,
      currentIntensityByAgency: cloneSerializable(sourceLifecycle?.currentIntensityByAgency ?? {})
    });
    if (phaseContext?.multiPhase) adjustments.push({
      code: 'phase-aware-interpretation',
      label: '多階段接近/離港語義分離',
      operationalPhase: phaseContext.operationalPhase,
      globalMinimumBelongsToLaterPhase: phaseContext.globalMinimumBelongsToLaterPhase
    });

    for (const code of ['T1', 'T3', 'T8']) {
      const baselineSignal = basicForecast?.signals?.[code];
      const signal = output?.signals?.[code];
      if (!baselineSignal || !signal) continue;
      const baselineRisk = finite(baselineSignal.riskIndex);
      let riskFactor = (1 - lifecyclePenalty) * (1 - terminalLifecyclePenalty);
      const support = strongestSupport(baselineSignal, usableAgencyCount, output.generatedAt);
      let longHorizonFactor = 1;
      let supportConfidenceFactor = 1;

      if (code !== 'T1'
          && Number.isFinite(support.strongestLeadHours)
          && support.strongestLeadHours > 72
          && usableAgencyCount > 0
          && support.totalAgencyCount > 0) {
        const horizonBlend = clamp((support.strongestLeadHours - 72) / 48);
        const evidenceWeakness = 0.45 * (1 - support.participationFraction)
          + 0.55 * (1 - support.positiveSupportFraction);
        longHorizonFactor = clamp(1 - horizonBlend * evidenceWeakness * 0.50, 0.50, 1);
        supportConfidenceFactor = clamp(
          0.68
          + 0.17 * support.participationFraction
          + 0.15 * support.positiveSupportFraction,
          0.68,
          1
        );
        riskFactor *= longHorizonFactor;
        if (longHorizonFactor < 0.999) adjustments.push({
          code: `${code.toLowerCase()}-long-horizon-evidence`,
          label: `${code} 遠期參與/正向支援折減`,
          factor: longHorizonFactor,
          strongestLeadHours: support.strongestLeadHours,
          checkpointAgencyCount: support.totalAgencyCount,
          supportAgencyCount: support.supportAgencyCount,
          usableAgencyCount,
          participationFraction: support.participationFraction,
          positiveSupportFraction: support.positiveSupportFraction
        });
      }

      signal.baselineRiskIndex = baselineRisk;
      signal.adjustmentFactor = riskFactor;
      if (Number.isFinite(baselineRisk)) signal.riskIndex = clamp(baselineRisk * riskFactor);
      signal.likelihood = degradedLikelihood(baselineSignal.likelihood, finite(signal.riskIndex), code);

      const baselineConfidence = finite(baselineSignal.confidenceIndex);
      signal.confidenceIndex = Number.isFinite(baselineConfidence)
        ? clamp(baselineConfidence * confidenceCoverageFactor * supportConfidenceFactor)
        : baselineSignal.confidenceIndex;

      let decisionReadiness = null;
      if (code === 'T1' && signal.likelihood !== 'unlikely') {
        decisionReadiness = t1DecisionReadiness(signal, support, phaseContext);
        signal.decisionReadinessIndex = decisionReadiness?.index ?? null;
        if (baselineSignal.likelihood === 'likely'
            && Number.isFinite(decisionReadiness?.index)
            && decisionReadiness.index < decisionReadiness.likelyFloor) {
          signal.likelihood = 'possible';
          adjustments.push({
            code: 't1-likely-readiness',
            label: 'T1 likely 決策成熟度折減',
            decisionReadinessIndex: decisionReadiness.index,
            likelyFloor: decisionReadiness.likelyFloor,
            supportFraction: decisionReadiness.supportFraction,
            leadCredibility: decisionReadiness.leadCredibility,
            persistenceCredibility: decisionReadiness.persistenceCredibility,
            phaseFactor: decisionReadiness.phaseFactor
          });
        }
      }

      signal.timingState = classifyTiming(
        signal,
        futureTimelineCount,
        hoursAfterMinimum,
        phaseContext,
        output.generatedAt
      );
      if (signal.likelihood === 'unlikely') signal.estimatedWindow = null;
      signal.windowRole = signal.estimatedWindow ? 'risk-evidence-window' : null;
      signal.shadowDiagnostics = {
        baselineLikelihood: baselineSignal.likelihood,
        confidenceCoverageFactor,
        presenceConfidenceFactor,
        usabilityConfidenceFactor,
        longHorizonFactor,
        supportConfidenceFactor,
        support,
        decisionReadiness,
        lifecyclePenalty,
        terminalLifecyclePenalty,
        terminalStateCandidate: terminalCandidate,
        phaseContext: cloneSerializable(phaseContext)
      };
    }

    output.impact = {
      ...(output.impact || {}),
      phaseContext: cloneSerializable(phaseContext)
    };
    output.shadow = {
      version: VERSION,
      mode: 'parallel-shadow-development',
      adjustments,
      diagnostics: {
        presentAgencyCount,
        usableAgencyCount,
        presenceCoverage,
        usableWithinPresent,
        presenceConfidenceFactor,
        usabilityConfidenceFactor,
        confidenceCoverageFactor,
        hoursAfterMinimum,
        directDepart,
        futureTimelineCount,
        lifecyclePenalty,
        terminalLifecyclePenalty,
        phaseContext: cloneSerializable(phaseContext),
        sourceLifecycle: cloneSerializable(sourceLifecycle ?? null)
      }
    };
    output.semantics = {
      ...(output.semantics || {}),
      shadowOnly: true,
      developmentRevision: true,
      v1RemainsEvaluationBaseline: true,
      noTruthFeedback: true,
      sourcePresenceAndUsabilitySeparatedForConfidence: true,
      longHorizonParticipationAndPositiveSupportSeparated: true,
      t1LikelyCarriesDecisionReadiness: true,
      postMinimumDepartureResidualRiskCanDecay: true,
      staleTerminalLifecycleEvidenceCanDecayResidualRisk: true,
      phaseAwareInterpretationIncluded: true,
      riskWindowIsNotIssuanceTime: true,
      missingPositiveWindowCarriesExplicitTimingState: true,
      noNewProbabilityOutput: true,
      officialHkoForecast: false,
      officialHkoDecisionInferred: false,
      aiGenerated: false,
      label: 'Storm Track warning signal risk estimate V2 shadow 0.3'
    };
    return output;
  }

  return Object.freeze({
    VERSION,
    TERMINAL_STALE_HOURS,
    PHASE_NEAR_TERM_HOURS,
    SIGNAL_THRESHOLDS,
    buildSourceLifecycleContext,
    derivePhaseContext,
    buildForecast
  });
});