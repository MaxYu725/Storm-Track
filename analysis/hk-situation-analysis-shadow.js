(function attachStormHkSituationAnalysisShadow(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StormHkSituationAnalysisShadow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormHkSituationAnalysisShadow() {
  'use strict';

  const VERSION = 'hk-situation-analysis-shadow-input/v0.1';
  const OUTPUT_CONTRACT_VERSION = 'hk-situation-analysis-shadow-output/v0.2';
  const EVIDENCE_CATALOG_VERSION = 'hk-situation-analysis-evidence-catalog/v1';

  function finite(value) {
    if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function cloneSerializable(value) {
    if (value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); }
    catch { return null; }
  }

  function compactWindow(window) {
    if (!window || typeof window !== 'object') return null;
    return { start: window.start ?? null, end: window.end ?? null };
  }

  function compactCheckpoint(checkpoint) {
    if (!checkpoint || typeof checkpoint !== 'object') return null;
    return {
      label: checkpoint.label ?? null,
      validTime: checkpoint.validTime ?? checkpoint.time ?? null,
      evidence: finite(checkpoint.evidence),
      consensusEvidence: finite(checkpoint.consensusEvidence),
      scenarioMaxEvidence: finite(checkpoint.scenarioMaxEvidence),
      supportAgencyCount: finite(checkpoint.supportAgencyCount),
      totalAgencyCount: finite(checkpoint.totalAgencyCount)
    };
  }

  function compactSignal(signal) {
    if (!signal || typeof signal !== 'object') return null;
    return {
      likelihood: signal.likelihood ?? null,
      riskIndex: finite(signal.riskIndex),
      confidenceIndex: finite(signal.confidenceIndex),
      persistenceHours: finite(signal.persistenceHours),
      timingState: signal.timingState ?? null,
      estimatedWindow: compactWindow(signal.estimatedWindow),
      strongestCheckpoint: compactCheckpoint(signal.strongestCheckpoint),
      baselineRiskIndex: finite(signal.baselineRiskIndex),
      adjustmentFactor: finite(signal.adjustmentFactor),
      shadowDiagnostics: cloneSerializable(signal.shadowDiagnostics ?? null),
      basis: cloneSerializable(signal.basis ?? null)
    };
  }

  function compactForecast(forecast) {
    if (!forecast || typeof forecast !== 'object') return null;
    return {
      schemaVersion: forecast.schemaVersion ?? null,
      available: forecast.available !== false,
      generatedAt: forecast.generatedAt ?? null,
      impact: cloneSerializable(forecast.impact ?? null),
      signals: {
        T1: compactSignal(forecast?.signals?.T1),
        T3: compactSignal(forecast?.signals?.T3),
        T8: compactSignal(forecast?.signals?.T8)
      },
      shadow: cloneSerializable(forecast.shadow ?? null),
      semantics: cloneSerializable(forecast.semantics ?? null)
    };
  }

  function analyzerEvidence(threatAssessment) {
    const analyzers = threatAssessment?.analyzers || {};
    return {
      directApproach: cloneSerializable(analyzers.directApproach ?? null),
      directDepart: cloneSerializable(analyzers.directDepart ?? null),
      reApproach: cloneSerializable(analyzers.reApproach ?? null),
      quasiStationary: cloneSerializable(analyzers.quasiStationary ?? null),
      forecastEdge: cloneSerializable(analyzers.forecastEdge ?? null),
      agencyDisagreement: cloneSerializable(analyzers.agencyDisagreement ?? null),
      interpolationReliability: cloneSerializable(analyzers.interpolationReliability ?? null),
      windField: cloneSerializable(analyzers.windField ?? null),
      rapidEvolution: cloneSerializable(analyzers.rapidEvolution ?? null)
    };
  }

  function agencyPatternEvidence(threatAssessment) {
    return Object.fromEntries(Object.entries(threatAssessment?.agencies || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([agency, pattern]) => [agency, cloneSerializable(pattern)]));
  }

  function localWindEvidence(localWindShadow) {
    if (!localWindShadow || typeof localWindShadow !== 'object') {
      return { provided: false, affectsForecast: false, interpretation: 'observation-only' };
    }
    const summary = localWindShadow.summary && typeof localWindShadow.summary === 'object'
      ? localWindShadow.summary
      : localWindShadow;
    const rows = Array.isArray(localWindShadow.stations)
      ? localWindShadow.stations
      : (Array.isArray(localWindShadow.observations)
          ? localWindShadow.observations
          : (Array.isArray(localWindShadow.rows) ? localWindShadow.rows : []));
    return {
      provided: true,
      schemaVersion: localWindShadow.schemaVersion ?? summary.schemaVersion ?? null,
      shadowVersion: localWindShadow.shadowVersion ?? null,
      authority: localWindShadow.authority ?? null,
      retrievedAt: localWindShadow.retrievedAt ?? null,
      dataTimestamp: summary.dataTimestamp ?? localWindShadow.dataTimestamp ?? null,
      affectsForecast: false,
      interpretation: 'observation-only',
      summary: cloneSerializable(summary),
      stations: cloneSerializable(rows)
    };
  }

  function officialHkoEvidence(signalInputs, hkoSignalStatement) {
    return {
      warningContext: cloneSerializable(signalInputs?.officialHkoWarningContext ?? null),
      signalStatement: cloneSerializable(hkoSignalStatement ?? null),
      semantics: {
        authorityContextOnly: true,
        mayDescribeMaintenanceCancellationOrEscalation: true,
        mustNotRewriteEarlierForecast: true
      }
    };
  }

  function valueAtPath(rootValue, path) {
    if (!path.startsWith('$.evidence.')) return undefined;
    const relative = path.slice('$.evidence.'.length);
    const tokens = relative.split('.');
    let current = rootValue?.evidence;
    for (const token of tokens) {
      if (current == null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, token)) return undefined;
      current = current[token];
    }
    return current;
  }

  function buildEvidenceCatalog(packet) {
    const definitions = [
      ['E_V1_IMPACT', '$.evidence.deterministicForecasts.v1.impact', 'forecast', 'Frozen V1 Hong Kong impact summary.'],
      ['E_V1_T1', '$.evidence.deterministicForecasts.v1.signals.T1', 'signal', 'Frozen V1 T1 likelihood, risk, confidence and timing guidance.'],
      ['E_V1_T3', '$.evidence.deterministicForecasts.v1.signals.T3', 'signal', 'Frozen V1 T3 likelihood, risk, confidence and timing guidance.'],
      ['E_V1_T8', '$.evidence.deterministicForecasts.v1.signals.T8', 'signal', 'Frozen V1 T8 likelihood, risk, confidence and timing guidance.'],
      ['E_V2_IMPACT', '$.evidence.deterministicForecasts.v2Shadow.impact', 'forecast', 'V2 Shadow Hong Kong impact summary.'],
      ['E_V2_T1', '$.evidence.deterministicForecasts.v2Shadow.signals.T1', 'signal', 'V2 Shadow T1 interpretation and timing state.'],
      ['E_V2_T3', '$.evidence.deterministicForecasts.v2Shadow.signals.T3', 'signal', 'V2 Shadow T3 interpretation and timing state.'],
      ['E_V2_T8', '$.evidence.deterministicForecasts.v2Shadow.signals.T8', 'signal', 'V2 Shadow T8 interpretation and timing state.'],
      ['E_GEOMETRY', '$.evidence.geometry', 'geometry', 'Current, minimum and full-horizon Hong Kong geometry evidence.'],
      ['E_IMPACT_TREND', '$.evidence.geometry.impactTrend', 'geometry', 'Aggregate impact-distance trend evidence.'],
      ['E_IMPACT_UNCERTAINTY', '$.evidence.geometry.impactUncertainty', 'uncertainty', 'Impact uncertainty evidence.'],
      ['E_DIRECT_APPROACH', '$.evidence.lifecycleAnalyzers.directApproach', 'lifecycle', 'Direct-approach analyzer evidence.'],
      ['E_DIRECT_DEPART', '$.evidence.lifecycleAnalyzers.directDepart', 'lifecycle', 'Direct-departure analyzer evidence.'],
      ['E_REAPPROACH', '$.evidence.lifecycleAnalyzers.reApproach', 'lifecycle', 'Re-approach analyzer evidence.'],
      ['E_QUASI_STATIONARY', '$.evidence.lifecycleAnalyzers.quasiStationary', 'lifecycle', 'Quasi-stationary analyzer evidence.'],
      ['E_FORECAST_EDGE', '$.evidence.lifecycleAnalyzers.forecastEdge', 'uncertainty', 'Forecast-edge / horizon-limitation evidence.'],
      ['E_AGENCY_DISAGREEMENT', '$.evidence.lifecycleAnalyzers.agencyDisagreement', 'uncertainty', 'Cross-agency disagreement analyzer evidence.'],
      ['E_INTERPOLATION_RELIABILITY', '$.evidence.lifecycleAnalyzers.interpolationReliability', 'uncertainty', 'Interpolation reliability evidence.'],
      ['E_TC_WIND_FIELD', '$.evidence.lifecycleAnalyzers.windField', 'wind-field', 'Tropical-cyclone forecast wind-field evidence, separate from local observed wind.'],
      ['E_RAPID_EVOLUTION', '$.evidence.lifecycleAnalyzers.rapidEvolution', 'lifecycle', 'Rapid-evolution analyzer evidence.'],
      ['E_AGENCY_PATTERNS', '$.evidence.agencyPatterns', 'agency', 'Per-agency movement and geometry patterns.'],
      ['E_THREAT_TIMELINE', '$.evidence.threatTimeline', 'timeline', 'Prospective multi-agency threat timeline.'],
      ['E_SIGNAL_FEATURES', '$.evidence.signalFeatureVector', 'signal-input', 'Deterministic HK signal feature vector.'],
      ['E_SIGNAL_COVERAGE', '$.evidence.signalCoverage', 'coverage', 'Deterministic source/agency coverage evidence.'],
      ['E_SIGNAL_DISAGREEMENT', '$.evidence.signalDisagreement', 'uncertainty', 'Signal-specific agency spread and disagreement evidence.'],
      ['E_HKO_WARNING_CONTEXT', '$.evidence.officialHko.warningContext', 'official-context', 'Structured HKO warning context carried by deterministic signal inputs.'],
      ['E_HKO_SIGNAL_STATEMENT', '$.evidence.officialHko.signalStatement', 'official-context', 'Contemporaneous HKO operational signal statement, when safely joined.'],
      ['E_LOCAL_WIND_SUMMARY', '$.evidence.localWind.summary', 'local-observation', 'HKO local 10-minute wind summary; observation-only and not a forecast input.'],
      ['E_LOCAL_WIND_STATIONS', '$.evidence.localWind.stations', 'local-observation', 'HKO local station wind observations; observation-only.'],
      ['E_PREVIOUS_SITUATION', '$.evidence.previousSituation', 'continuity', 'Previous AI situation shadow state if explicitly supplied.']
    ];

    const entries = definitions
      .map(([id, path, kind, description]) => ({ id, path, kind, description, value: valueAtPath(packet, path) }))
      .filter(entry => entry.value !== undefined && entry.value !== null)
      .map(({ value, ...entry }) => entry);

    return {
      schemaVersion: EVIDENCE_CATALOG_VERSION,
      referenceMode: 'catalog-id-only',
      entries,
      semantics: {
        deterministic: true,
        stormAgnostic: true,
        idsAreStableAcrossCasesWhenEvidenceKindMatches: true,
        idsResolveToExactPacketPaths: true,
        modelMustNotInventIds: true
      }
    };
  }

  function targetOutputContract() {
    return {
      schemaVersion: OUTPUT_CONTRACT_VERSION,
      requiredFields: [
        'currentPhase', 'currentPhaseConfidence', 'futurePhases', 'currentThreatInterpretation',
        'nextDecisionWindow', 'signalInterpretation', 'supportingEvidence', 'contradictingEvidence',
        'modelSemanticConcerns', 'uncertainties'
      ],
      signalKeys: ['T1', 'T3', 'T8'],
      evidenceReferenceRequired: true,
      evidenceReferenceMode: 'catalog-id-only',
      uncertainAnswerAllowed: true
    };
  }

  function analysisConstraints() {
    return {
      stormIdentityIsProvenanceOnly: true,
      caseSpecificRuleApplicationForbidden: true,
      noGeneratedTrackCoordinates: true,
      noGeneratedWindMeasurements: true,
      noSilentAgencySubstitution: true,
      noSingleGustSignalInference: true,
      localWindRemainsSeparateFromTcWindField: true,
      officialOutcomeCannotRewriteEarlierForecast: true,
      underlyingV1V2RiskIndicesImmutable: true,
      officialHkoDecisionMustNotBeInvented: true,
      evidenceCatalogIdsOnly: true,
      uncertaintyMayBeExplicit: true
    };
  }

  function buildSituationAnalysisInput({
    caseInfo, generatedAt, impact, signalInputs, threatAssessment, basicForecast, shadowForecastV2,
    hkoSignalStatement, localWindShadow, previousSituation
  } = {}) {
    const referenceTime = generatedAt
      ?? basicForecast?.generatedAt
      ?? threatAssessment?.generatedAt
      ?? signalInputs?.generatedAt
      ?? impact?.generatedAt
      ?? null;
    const summary = threatAssessment?.summary || {};

    const packet = {
      schemaVersion: VERSION,
      generatedAt: referenceTime,
      mode: 'ai-situation-analysis-shadow-input',
      case: {
        caseId: caseInfo?.caseId ?? null,
        displayName: caseInfo?.displayName ?? caseInfo?.name ?? null,
        nameTc: caseInfo?.nameTc ?? null,
        nameEn: caseInfo?.nameEn ?? null,
        provenanceOnly: true
      },
      evidence: {
        deterministicForecasts: {
          v1: compactForecast(basicForecast),
          v2Shadow: compactForecast(shadowForecastV2)
        },
        geometry: {
          impactClosestApproach: cloneSerializable(impact?.closestApproach ?? null),
          impactTrend: cloneSerializable(impact?.trend ?? null),
          impactUncertainty: cloneSerializable(impact?.uncertainty ?? null),
          currentDistanceKm: finite(summary.currentDistanceKm),
          forecastMinimumKm: finite(summary.forecastMinimumKm),
          forecastMinimumLeadHours: finite(summary.forecastMinimumLeadHours),
          representativeMinimum: cloneSerializable(summary.representativeMinimum ?? null),
          strongestTimelineThreat: cloneSerializable(summary.strongestTimelineThreat ?? null)
        },
        lifecycleAnalyzers: analyzerEvidence(threatAssessment),
        agencyPatterns: agencyPatternEvidence(threatAssessment),
        threatTimeline: cloneSerializable(threatAssessment?.timeline ?? []),
        signalFeatureVector: cloneSerializable(signalInputs?.featureVector ?? null),
        signalCoverage: cloneSerializable(signalInputs?.coverage ?? null),
        signalDisagreement: cloneSerializable(signalInputs?.disagreement ?? null),
        officialHko: officialHkoEvidence(signalInputs, hkoSignalStatement),
        localWind: localWindEvidence(localWindShadow),
        previousSituation: cloneSerializable(previousSituation ?? null)
      },
      evidenceCatalog: null,
      aiTask: {
        purpose: 'Interpret lifecycle, conflicting evidence, operational timing semantics, and uncertainty without changing deterministic forecast values.',
        targetOutput: targetOutputContract(),
        constraints: analysisConstraints()
      },
      semantics: {
        shadowOnly: true,
        affectsForecast: false,
        affectsEvaluator: false,
        noForecastMutation: true,
        noTruthFeedback: true,
        aiInvocationIncluded: false,
        evidencePacketOnly: true,
        caseSpecificRulesForbidden: true,
        localWindAffectsForecast: false,
        evidenceReferencesUseCatalogIds: true,
        officialHkoForecast: false,
        officialHkoDecisionInferred: false,
        label: 'Storm Track AI Situation Analysis Shadow evidence packet'
      }
    };
    packet.evidenceCatalog = buildEvidenceCatalog(packet);
    return packet;
  }

  return Object.freeze({
    VERSION,
    OUTPUT_CONTRACT_VERSION,
    EVIDENCE_CATALOG_VERSION,
    buildEvidenceCatalog,
    buildSituationAnalysisInput
  });
});
