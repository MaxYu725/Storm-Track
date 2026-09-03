(function attachStormHkThreatUi(root, factory) {
  installSettingsPanelUi(root);
  installHkoSignalStatementUi(root);
  installOptionalWindLayer(root);
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StormHkThreatUi = api;

  function installSettingsPanelUi(browserRoot) {
    if (!browserRoot?.document) return;
    if (browserRoot.document.querySelector('script[data-storm-settings-panel]')) return;
    const script = browserRoot.document.createElement('script');
    script.src = './analysis/settings-panel-ui.js';
    script.async = true;
    script.dataset.stormSettingsPanel = 'true';
    browserRoot.document.head.appendChild(script);
  }

  function installHkoSignalStatementUi(browserRoot) {
    if (!browserRoot?.document) return;
    if (browserRoot.document.querySelector('script[data-hko-signal-statement]')) return;
    const script = browserRoot.document.createElement('script');
    script.src = './analysis/hko-signal-statement.js';
    script.async = true;
    script.dataset.hkoSignalStatement = 'true';
    browserRoot.document.head.appendChild(script);
  }

  function installOptionalWindLayer(browserRoot) {
    if (!browserRoot?.document || !browserRoot?.L || typeof browserRoot.L.map !== 'function') return;
    try {
      if (new URLSearchParams(browserRoot.location?.search || '').get('beta') !== 'hk-signal') return;
    } catch {
      return;
    }

    const runtime = browserRoot.StormTrackRuntime || (browserRoot.StormTrackRuntime = {});
    if (!runtime.mapCaptureInstalled) {
      const originalMap = browserRoot.L.map;
      const captureMap = function captureStormTrackMap(...args) {
        const leafletMap = originalMap.apply(this, args);
        const container = args[0];
        const id = typeof container === 'string' ? container : container?.id;
        if (id === 'storm-map') {
          runtime.map = leafletMap;
          browserRoot.dispatchEvent?.(new CustomEvent('stormtrack:map-ready', { detail: { map: leafletMap } }));
        }
        return leafletMap;
      };
      Object.assign(captureMap, originalMap);
      browserRoot.L.map = captureMap;
      runtime.mapCaptureInstalled = true;
    }

    if (!browserRoot.document.querySelector('script[data-storm-wind-field]')) {
      const script = browserRoot.document.createElement('script');
      script.src = './analysis/wind-field-overlay.js';
      script.async = true;
      script.dataset.stormWindField = 'true';
      browserRoot.document.head.appendChild(script);
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormHkThreatUi(root) {
  'use strict';

  const VERSION = 'frontend-hk-threat-ui/v2';
  const SHADOW_V2_VERSION = 'hk-signal-shadow-v2/0.2';
  const PROSPECTIVE_SCHEMA_VERSION = 'hk-beta-prospective-observation/v1';
  const TERMINAL_STALE_HOURS = 12;
  const prospectiveObservations = new Map();
  const SIGNAL_THRESHOLDS = Object.freeze({
    T1: Object.freeze({ possible: 0.35, likely: 0.58 }),
    T3: Object.freeze({ possible: 0.38, likely: 0.65 }),
    T8: Object.freeze({ possible: 0.40, likely: 0.70 })
  });

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
  }

  function timeMs(value) {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }

  function leadHours(reference, target) {
    const referenceMs = timeMs(reference);
    const targetMs = timeMs(target);
    if (!Number.isFinite(referenceMs) || !Number.isFinite(targetMs)) return null;
    return (targetMs - referenceMs) / (60 * 60 * 1000);
  }

  function isBetaEnabled() {
    if (!root?.location) return true;
    try {
      return new URLSearchParams(root.location.search || '').get('beta') === 'hk-signal';
    } catch {
      return false;
    }
  }

  function latestDataTime(group) {
    const times = [];
    Object.values(group?.sources || {}).forEach(source => {
      const current = Array.isArray(source?.positions) ? source.positions[source.positions.length - 1] : null;
      [current?.time, source?.bulletinTime, source?.forecast?.[0]?.baseTime]
        .map(timeMs).filter(Number.isFinite).forEach(value => times.push(value));
    });
    return times.length ? new Date(Math.max(...times)).toISOString() : new Date().toISOString();
  }

  function terminalIntensityHint(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return false;
    return /low pressure area|\blpa\b|低壓區|低压区|dissipat|remnant low/.test(text);
  }

  function buildSourceLifecycleContext(group, observedAt) {
    const observedMs = timeMs(observedAt);
    const sourceEntries = Object.entries(group?.sources || {})
      .filter(([, source]) => source && typeof source === 'object');
    const sourceAges = [];
    const intensities = {};
    let forecastPointTotal = 0;

    for (const [agency, source] of sourceEntries) {
      const positions = Array.isArray(source?.positions) ? source.positions : [];
      const forecast = Array.isArray(source?.forecast) ? source.forecast : [];
      const current = positions[positions.length - 1] || null;
      forecastPointTotal += forecast.length;
      if (current?.intensity != null && String(current.intensity).trim()) {
        intensities[agency] = String(current.intensity);
      }
      const evidenceMs = timeMs(source?.bulletinTime) ?? timeMs(current?.time);
      if (Number.isFinite(observedMs) && Number.isFinite(evidenceMs) && observedMs >= evidenceMs) {
        sourceAges.push({ agency, ageHours: (observedMs - evidenceMs) / 3600000 });
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
      sourceAgencies: sourceEntries.map(([agency]) => agency),
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

  function engines() {
    const snapshot = root?.StormAnalysisCore;
    const impact = root?.StormHongKongImpactEngine;
    const signal = root?.StormHkoSignalRiskInputs;
    const threat = root?.StormHkThreatAssessment;
    const forecast = root?.StormBasicHkSignalForecast;
    if (typeof snapshot?.buildStormAnalysisSnapshot !== 'function'
        || typeof impact?.buildHongKongImpact !== 'function'
        || typeof signal?.buildHkoSignalRiskInputs !== 'function'
        || typeof threat?.buildHkThreatAssessment !== 'function'
        || typeof forecast?.buildBasicHkSignalForecast !== 'function') return null;
    return { snapshot, impact, signal, threat, forecast };
  }

  function cloneSerializable(value) {
    if (value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); }
    catch { return null; }
  }

  function pointSummary(point) {
    if (!point || typeof point !== 'object') return null;
    return {
      time: point.time ?? null,
      baseTime: point.baseTime ?? null,
      forecastHour: point.forecastHour ?? null,
      lat: finite(point.lat),
      lon: finite(point.lon),
      maximumWind: point.maximumWind ?? null,
      pressure: point.pressure ?? null,
      intensity: point.intensity ?? null
    };
  }

  function sourceObservation(source) {
    const positions = Array.isArray(source?.positions) ? source.positions : [];
    const forecast = Array.isArray(source?.forecast) ? source.forecast : [];
    return {
      agency: source?.agency ?? null,
      sourceId: source?.sourceId ?? null,
      bulletinTime: source?.bulletinTime ?? null,
      positionCount: positions.length,
      forecastCount: forecast.length,
      current: pointSummary(positions[positions.length - 1]),
      forecastStart: pointSummary(forecast[0]),
      forecastEnd: pointSummary(forecast[forecast.length - 1]),
      rawInput: cloneSerializable(source)
    };
  }

  function engineVersionSummary() {
    return {
      ui: VERSION,
      snapshot: root?.StormAnalysisCore?.VERSION ?? root?.StormAnalysisCore?.SNAPSHOT_VERSION ?? null,
      impact: root?.StormHongKongImpactEngine?.VERSION ?? root?.StormHongKongImpactEngine?.IMPACT_VERSION ?? null,
      signalInputs: root?.StormHkoSignalRiskInputs?.VERSION ?? root?.StormHkoSignalRiskInputs?.INPUT_VERSION ?? null,
      threatAssessment: root?.StormHkThreatAssessment?.VERSION ?? null,
      basicForecast: root?.StormBasicHkSignalForecast?.VERSION ?? null,
      shadowForecastV2: SHADOW_V2_VERSION
    };
  }

  function compactAnalysis(result) {
    return {
      available: result?.available === true,
      reason: result?.reason ?? null,
      generatedAt: result?.generatedAt ?? null,
      snapshotSchemaVersion: result?.snapshot?.schemaVersion ?? null,
      impact: cloneSerializable({
        schemaVersion: result?.impact?.schemaVersion ?? null,
        closestApproach: result?.impact?.closestApproach ?? null,
        trend: result?.impact?.trend ?? null,
        uncertainty: result?.impact?.uncertainty ?? null
      }),
      signalInputs: cloneSerializable({
        schemaVersion: result?.signalInputs?.schemaVersion ?? null,
        coverage: result?.signalInputs?.coverage ?? null,
        disagreement: result?.signalInputs?.disagreement ?? null,
        featureVector: result?.signalInputs?.featureVector ?? null,
        officialHkoWarningContext: result?.signalInputs?.officialHkoWarningContext ?? null
      }),
      threatAssessment: cloneSerializable({
        schemaVersion: result?.threatAssessment?.schemaVersion ?? null,
        summary: result?.threatAssessment?.summary ?? null,
        analyzers: result?.threatAssessment?.analyzers ?? null,
        timeline: result?.threatAssessment?.timeline ?? [],
        semantics: result?.threatAssessment?.semantics ?? null
      }),
      basicForecast: cloneSerializable(result?.basicForecast ?? null),
      shadowForecastV2: cloneSerializable(result?.shadowForecastV2 ?? null)
    };
  }

  function rememberProspectiveObservation(group, result) {
    const sourceEntries = Object.entries(group?.sources || {})
      .filter(([, source]) => source && typeof source === 'object')
      .sort(([left], [right]) => left.localeCompare(right));
    const sources = Object.fromEntries(sourceEntries.map(([agency, source]) => [agency, sourceObservation(source)]));
    const sourceAgencies = Object.keys(sources);
    const key = String(group?.key || group?.displayName || sourceAgencies.join('+') || 'unknown-group');
    prospectiveObservations.set(key, {
      schemaVersion: PROSPECTIVE_SCHEMA_VERSION,
      observedAt: new Date().toISOString(),
      group: {
        key: group?.key ?? null,
        displayName: group?.displayName ?? null,
        nameTc: group?.nameTc ?? null,
        nameEn: group?.nameEn ?? null
      },
      sourceAgencies,
      sources,
      engineVersions: engineVersionSummary(),
      analysis: compactAnalysis(result)
    });
  }

  function readProspectiveObservations() {
    return cloneSerializable([...prospectiveObservations.values()]
      .sort((left, right) => String(left?.group?.key || '').localeCompare(String(right?.group?.key || '')))) || [];
  }

  function degradedLikelihood(original, riskIndex, code) {
    const thresholds = SIGNAL_THRESHOLDS[code];
    if (!thresholds || original === 'unlikely' || !Number.isFinite(riskIndex)) return original;
    if (riskIndex < thresholds.possible) return 'unlikely';
    if (original === 'likely' && riskIndex < thresholds.likely) return 'possible';
    return original;
  }

  function buildShadowV2Forecast({ basicForecast, signalInputs, threatAssessment, generatedAt, sourceLifecycle } = {}) {
    if (basicForecast?.available !== true) {
      return {
        schemaVersion: SHADOW_V2_VERSION,
        available: false,
        reason: basicForecast?.reason || 'v1-unavailable',
        semantics: { shadowOnly: true, officialHkoForecast: false, aiGenerated: false }
      };
    }

    const output = cloneSerializable(basicForecast);
    output.schemaVersion = SHADOW_V2_VERSION;
    output.baseForecastSchemaVersion = basicForecast.schemaVersion ?? null;
    output.generatedAt = generatedAt ?? basicForecast.generatedAt ?? null;

    const usableAgencyCount = Math.max(0, finite(signalInputs?.featureVector?.usableAgencyCount)
      ?? finite(signalInputs?.coverage?.usableAgencyCount)
      ?? 0);
    const agencyCoverage = clamp(usableAgencyCount / 4);
    const confidenceCoverageFactor = 0.55 + 0.45 * agencyCoverage;
    const closestTime = basicForecast?.impact?.closestApproach?.time ?? null;
    const minimumLeadHours = leadHours(output.generatedAt, closestTime);
    const hoursAfterMinimum = Number.isFinite(minimumLeadHours) ? Math.max(0, -minimumLeadHours) : 0;
    const directDepart = clamp(finite(threatAssessment?.analyzers?.directDepart?.confidence) ?? 0);
    const futureTimeline = (Array.isArray(threatAssessment?.timeline) ? threatAssessment.timeline : [])
      .filter(item => {
        const lead = finite(item?.leadHours) ?? leadHours(output.generatedAt, item?.validTime ?? item?.time);
        return Number.isFinite(lead) && lead > 1e-6;
      });
    const lifecyclePenalty = futureTimeline.length === 0 && hoursAfterMinimum > 0
      ? clamp(directDepart * (hoursAfterMinimum / (hoursAfterMinimum + 12)) * 0.40, 0, 0.40)
      : 0;
    const terminalCandidate = sourceLifecycle?.terminalStateCandidate === true
      && futureTimeline.length === 0
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
      code: 'source-coverage-confidence',
      label: '來源完整度信心修正',
      factor: confidenceCoverageFactor,
      usableAgencyCount
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

    for (const code of ['T1', 'T3', 'T8']) {
      const baselineSignal = basicForecast?.signals?.[code];
      const signal = output?.signals?.[code];
      if (!baselineSignal || !signal) continue;
      const baselineRisk = finite(baselineSignal.riskIndex);
      let riskFactor = (1 - lifecyclePenalty) * (1 - terminalLifecyclePenalty);
      let supportFactor = 1;
      let supportCoverage = 1;
      let strongestLeadHours = null;
      const strongest = baselineSignal.strongestCheckpoint || null;
      const checkpointTotal = Math.max(0, finite(strongest?.totalAgencyCount) ?? 0);
      if (strongest?.validTime) strongestLeadHours = leadHours(output.generatedAt, strongest.validTime);

      if (code !== 'T1'
          && Number.isFinite(strongestLeadHours)
          && strongestLeadHours > 72
          && usableAgencyCount > 0
          && checkpointTotal > 0
          && checkpointTotal < usableAgencyCount) {
        supportCoverage = clamp(checkpointTotal / usableAgencyCount);
        const horizonBlend = clamp((strongestLeadHours - 72) / 48);
        supportFactor = 1 - horizonBlend * (1 - supportCoverage) * 0.45;
        riskFactor *= supportFactor;
        adjustments.push({
          code: `${code.toLowerCase()}-long-horizon-support`,
          label: `${code} 遠期少數機構支援折減`,
          factor: supportFactor,
          strongestLeadHours,
          checkpointAgencyCount: checkpointTotal,
          usableAgencyCount
        });
      }

      signal.baselineRiskIndex = baselineRisk;
      signal.adjustmentFactor = riskFactor;
      if (Number.isFinite(baselineRisk)) signal.riskIndex = clamp(baselineRisk * riskFactor);
      signal.likelihood = degradedLikelihood(baselineSignal.likelihood, finite(signal.riskIndex), code);

      const baselineConfidence = finite(baselineSignal.confidenceIndex);
      const supportConfidenceFactor = code === 'T1' ? 1 : (0.70 + 0.30 * supportCoverage);
      signal.confidenceIndex = Number.isFinite(baselineConfidence)
        ? clamp(baselineConfidence * confidenceCoverageFactor * supportConfidenceFactor)
        : baselineSignal.confidenceIndex;

      if (signal.likelihood === 'unlikely') {
        signal.timingState = 'not-applicable';
        signal.estimatedWindow = null;
      } else if (signal.estimatedWindow?.start && signal.estimatedWindow?.end) {
        signal.timingState = 'estimated';
      } else if (futureTimeline.length > 0) {
        signal.timingState = 'left-censored-or-horizon-limited';
      } else if (hoursAfterMinimum > 0) {
        signal.timingState = 'post-minimum-no-future';
      } else {
        signal.timingState = 'unresolved';
      }

      signal.shadowDiagnostics = {
        baselineLikelihood: baselineSignal.likelihood,
        confidenceCoverageFactor,
        supportFactor,
        supportCoverage,
        strongestLeadHours,
        lifecyclePenalty,
        terminalLifecyclePenalty,
        terminalStateCandidate: terminalCandidate
      };
    }

    output.shadow = {
      version: SHADOW_V2_VERSION,
      mode: 'parallel-shadow',
      adjustments,
      diagnostics: {
        usableAgencyCount,
        confidenceCoverageFactor,
        hoursAfterMinimum,
        directDepart,
        futureTimelineCount: futureTimeline.length,
        lifecyclePenalty,
        terminalLifecyclePenalty,
        sourceLifecycle: cloneSerializable(sourceLifecycle ?? null)
      }
    };
    output.semantics = {
      ...(output.semantics || {}),
      shadowOnly: true,
      v1RemainsEvaluationBaseline: true,
      noTruthFeedback: true,
      sourceCoverageAffectsNumericConfidence: true,
      longHorizonStrongSignalSupportIsContinuouslyDiscounted: true,
      postMinimumDepartureResidualRiskCanDecay: true,
      staleTerminalLifecycleEvidenceCanDecayResidualRisk: true,
      missingPositiveWindowCarriesExplicitTimingState: true,
      noNewProbabilityOutput: true,
      officialHkoForecast: false,
      officialHkoDecisionInferred: false,
      aiGenerated: false,
      label: 'Storm Track warning signal risk estimate V2 shadow'
    };
    return output;
  }

  function analyzeGroup(group, options = {}) {
    const available = engines();
    if (!available) {
      return { available: false, reason: 'frontend-analysis-engine-unavailable', schemaVersion: VERSION };
    }
    try {
      const observedAt = options.observedAt || new Date().toISOString();
      const generatedAt = options.generatedAt || latestDataTime(group);
      const sourceLifecycle = buildSourceLifecycleContext(group, observedAt);
      const snapshot = available.snapshot.buildStormAnalysisSnapshot(group, { generatedAt });
      const impact = available.impact.buildHongKongImpact(snapshot, options.impactOptions || {});
      const signalInputs = available.signal.buildHkoSignalRiskInputs(snapshot, impact, group, options.signalOptions || {});
      const threatAssessment = available.threat.buildHkThreatAssessment({
        snapshot,
        impact,
        weightedImpact: null,
        signalInputs,
        generatedAt: snapshot.generatedAt
      });
      const basicForecast = available.forecast.buildBasicHkSignalForecast({
        impact,
        weightedImpact: null,
        signalInputs,
        threatAssessment,
        generatedAt: snapshot.generatedAt
      });
      const shadowForecastV2 = buildShadowV2Forecast({
        basicForecast,
        signalInputs,
        threatAssessment,
        generatedAt: snapshot.generatedAt,
        sourceLifecycle
      });
      return {
        schemaVersion: VERSION,
        available: basicForecast?.available === true,
        generatedAt: snapshot.generatedAt,
        snapshot,
        impact,
        signalInputs,
        threatAssessment,
        basicForecast,
        shadowForecastV2,
        reason: basicForecast?.available === true ? null : (basicForecast?.reason || threatAssessment?.reason || 'analysis-unavailable')
      };
    } catch (error) {
      return {
        schemaVersion: VERSION,
        available: false,
        reason: 'frontend-analysis-error',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
  }

  function likelihoodLabel(value) {
    return value === 'likely' ? '較高' : (value === 'possible' ? '可能' : (value === 'unlikely' ? '較低' : '未能判斷'));
  }

  function formatHkt(value, withDate = true) {
    const ms = timeMs(value);
    if (!Number.isFinite(ms)) return '--';
    const options = {
      timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hour12: false
    };
    if (withDate) {
      options.month = '2-digit';
      options.day = '2-digit';
    }
    return new Intl.DateTimeFormat('zh-HK', options).format(new Date(ms)).replace(',', '');
  }

  function formatWindow(window) {
    if (!window?.start || !window?.end) return null;
    return `${formatHkt(window.start)}–${formatHkt(window.end)}`;
  }

  function timingHint(signal) {
    if (signal?.likelihood === 'unlikely' || signal?.estimatedWindow) return null;
    if (signal?.timingState === 'left-censored-or-horizon-limited') return '窗：起點不可見/受預報長度限制';
    if (signal?.timingState === 'post-minimum-no-future') return '窗：最近點已過且無後續預報';
    if (signal?.timingState === 'unresolved') return '窗：暫未能定位';
    return null;
  }

  function signalText(code, signal, options = {}) {
    const label = likelihoodLabel(signal?.likelihood);
    const window = signal?.likelihood !== 'unlikely' ? formatWindow(signal?.estimatedWindow) : null;
    const hint = options.includeTimingHint ? timingHint(signal) : null;
    return `${code} ${label}${window ? ` · ${window}` : ''}${hint ? ` · ${hint}` : ''}`;
  }

  function compactEvolution(threatAssessment) {
    const fastest = threatAssessment?.summary?.fastestEvolution;
    if (!fastest || !Number.isFinite(finite(fastest.rapidEvolutionIndex)) || finite(fastest.rapidEvolutionIndex) < 0.2) return null;
    const details = [];
    if (Number.isFinite(finite(fastest.approachRateKmh)) && finite(fastest.approachRateKmh) > 3) {
      details.push(`接近 ${Math.round(finite(fastest.approachRateKmh))} km/h`);
    }
    if (Number.isFinite(finite(fastest.strengtheningRateMsPerHour)) && finite(fastest.strengtheningRateMsPerHour) > 0.05) {
      details.push(`增強 +${finite(fastest.strengtheningRateMsPerHour).toFixed(1)} m/s/h`);
    }
    if (!details.length) return null;
    return `${fastest.label || ''} ${details.join(' · ')}`.trim();
  }

  function renderGroupSummary(group, options = {}) {
    if (!isBetaEnabled()) return '';

    const result = analyzeGroup(group, options);
    rememberProspectiveObservation(group, result);
    if (!result.available) {
      return `<div class="hk-threat-summary" style="margin-top:9px;padding-top:8px;border-top:1px solid #292929;color:#777;font-size:.72rem;line-height:1.45">香港影響 Beta：暫未有足夠資料</div>`;
    }

    const forecast = result.basicForecast;
    const shadow = result.shadowForecastV2;
    const threat = result.threatAssessment;
    const official = result.signalInputs?.officialHkoWarningContext || null;
    const officialSignal = official?.provided === true && official?.currentSignal
      ? String(official.currentSignal).trim() : null;
    const officialIssued = officialSignal && official?.issuedAt ? formatHkt(official.issuedAt) : null;
    const impactLabel = likelihoodLabel(forecast?.impact?.likelihood);
    const t1 = signalText('T1', forecast?.signals?.T1);
    const t3 = signalText('T3', forecast?.signals?.T3);
    const t8 = signalText('T8', forecast?.signals?.T8);
    const v2t1 = signalText('T1', shadow?.signals?.T1, { includeTimingHint: true });
    const v2t3 = signalText('T3', shadow?.signals?.T3, { includeTimingHint: true });
    const v2t8 = signalText('T8', shadow?.signals?.T8, { includeTimingHint: true });
    const evolution = compactEvolution(threat);
    const notes = [];
    if ((finite(threat?.analyzers?.agencyDisagreement?.confidence) ?? 0) >= 0.6) notes.push('機構分歧較大');
    if (forecast?.impact?.forecastMinimumMayBeHorizonLimited) notes.push('部分機構預報在最近距離附近結束');
    const strongest = threat?.summary?.strongestTimelineThreat;
    if (strongest?.label && Number.isFinite(finite(strongest?.threatIndex))) {
      notes.push(`較高威脅點 ${strongest.label}（${formatHkt(strongest.validTime)}）`);
    }
    const shadowNotes = [...new Set((shadow?.shadow?.adjustments || []).map(item => item?.label).filter(Boolean))];

    return `<div class="hk-threat-summary" style="margin-top:9px;padding-top:8px;border-top:1px solid #353535;font-size:.73rem;line-height:1.5">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><span style="color:#8f8f8f">香港影響 Beta · V1 / V2</span><strong style="color:#fff;font-size:.82rem">${escapeHtml(impactLabel)}</strong></div>
      ${officialSignal ? `<div style="margin-top:5px;color:#fff"><strong>HKO官方目前：${escapeHtml(officialSignal)}</strong>${officialIssued ? ` · ${escapeHtml(officialIssued)}` : ''}</div>` : ''}
      <div style="margin-top:5px;color:#777;font-size:.67rem">V1 frozen</div>
      <div style="color:#ddd">${escapeHtml(t1)}</div>
      <div style="color:#ddd">${escapeHtml(t3)}</div>
      <div style="color:#ddd">${escapeHtml(t8)}</div>
      <div style="margin-top:5px;color:#9fdfff;font-size:.67rem">V2 shadow</div>
      <div style="color:#e6f7ff">${escapeHtml(v2t1)}</div>
      <div style="color:#e6f7ff">${escapeHtml(v2t3)}</div>
      <div style="color:#e6f7ff">${escapeHtml(v2t8)}</div>
      ${shadowNotes.length ? `<div style="margin-top:3px;color:#6f9aaa">V2：${escapeHtml(shadowNotes.join(' · '))}</div>` : ''}
      ${evolution ? `<div style="margin-top:5px;color:#aaa">最快演變：${escapeHtml(evolution)}</div>` : ''}
      ${notes.length ? `<div style="margin-top:3px;color:#777">${escapeHtml(notes.join(' · '))}</div>` : ''}
      <div style="margin-top:5px;color:#5f5f5f;font-size:.66rem">Storm Track 估算 · V2 為同步影子版本 · 非香港天文台官方風球預測</div>
    </div>`;
  }

  return Object.freeze({
    VERSION,
    SHADOW_V2_VERSION,
    PROSPECTIVE_SCHEMA_VERSION,
    TERMINAL_STALE_HOURS,
    readProspectiveObservations,
    isBetaEnabled,
    analyzeGroup,
    buildSourceLifecycleContext,
    buildShadowV2Forecast,
    renderGroupSummary,
    likelihoodLabel,
    formatWindow
  });
});