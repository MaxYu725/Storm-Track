(function attachStormHkThreatUi(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StormHkThreatUi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormHkThreatUi(root) {
  'use strict';

  const VERSION = 'frontend-hk-threat-ui/v1';
  const PROSPECTIVE_SCHEMA_VERSION = 'hk-beta-prospective-observation/v1';
  const prospectiveObservations = new Map();

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function timeMs(value) {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
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
      basicForecast: root?.StormBasicHkSignalForecast?.VERSION ?? null
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
      basicForecast: cloneSerializable(result?.basicForecast ?? null)
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

  function analyzeGroup(group, options = {}) {
    const available = engines();
    if (!available) {
      return { available: false, reason: 'frontend-analysis-engine-unavailable', schemaVersion: VERSION };
    }
    try {
      const generatedAt = options.generatedAt || latestDataTime(group);
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
      return {
        schemaVersion: VERSION,
        available: basicForecast?.available === true,
        generatedAt: snapshot.generatedAt,
        snapshot,
        impact,
        signalInputs,
        threatAssessment,
        basicForecast,
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

  function signalText(code, signal) {
    const label = likelihoodLabel(signal?.likelihood);
    const window = signal?.likelihood !== 'unlikely' ? formatWindow(signal?.estimatedWindow) : null;
    return `${code} ${label}${window ? ` · ${window}` : ''}`;
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
    const threat = result.threatAssessment;
    const official = result.signalInputs?.officialHkoWarningContext || null;
    const officialSignal = official?.provided === true && official?.currentSignal
      ? String(official.currentSignal).trim() : null;
    const officialIssued = officialSignal && official?.issuedAt ? formatHkt(official.issuedAt) : null;
    const impactLabel = likelihoodLabel(forecast?.impact?.likelihood);
    const t1 = signalText('T1', forecast?.signals?.T1);
    const t3 = signalText('T3', forecast?.signals?.T3);
    const t8 = signalText('T8', forecast?.signals?.T8);
    const evolution = compactEvolution(threat);
    const notes = [];
    if ((finite(threat?.analyzers?.agencyDisagreement?.confidence) ?? 0) >= 0.6) notes.push('機構分歧較大');
    if (forecast?.impact?.forecastMinimumMayBeHorizonLimited) notes.push('最低距離接近預報尾端');
    const strongest = threat?.summary?.strongestTimelineThreat;
    if (strongest?.label && Number.isFinite(finite(strongest?.threatIndex))) {
      notes.push(`較高威脅點 ${strongest.label}（${formatHkt(strongest.validTime)}）`);
    }

    return `<div class="hk-threat-summary" style="margin-top:9px;padding-top:8px;border-top:1px solid #353535;font-size:.73rem;line-height:1.5">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><span style="color:#8f8f8f">香港影響 Beta</span><strong style="color:#fff;font-size:.82rem">${escapeHtml(impactLabel)}</strong></div>
      ${officialSignal ? `<div style="margin-top:5px;color:#fff"><strong>HKO官方目前：${escapeHtml(officialSignal)}</strong>${officialIssued ? ` · ${escapeHtml(officialIssued)}` : ''}</div>` : ''}
      <div style="margin-top:4px;color:#ddd">${escapeHtml(t1)}</div>
      <div style="color:#ddd">${escapeHtml(t3)}</div>
      <div style="color:#ddd">${escapeHtml(t8)}</div>
      ${evolution ? `<div style="margin-top:5px;color:#aaa">最快演變：${escapeHtml(evolution)}</div>` : ''}
      ${notes.length ? `<div style="margin-top:3px;color:#777">${escapeHtml(notes.join(' · '))}</div>` : ''}
      <div style="margin-top:5px;color:#5f5f5f;font-size:.66rem">Storm Track 估算 · 非香港天文台官方風球預測</div>
    </div>`;
  }

  return Object.freeze({
    VERSION,
    PROSPECTIVE_SCHEMA_VERSION,
    readProspectiveObservations,
    isBetaEnabled,
    analyzeGroup,
    renderGroupSummary,
    likelihoodLabel,
    formatWindow
  });
});
