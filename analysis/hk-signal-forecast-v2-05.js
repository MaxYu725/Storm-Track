(function attachStormHkSignalForecastV205(root, factory) {
  const base = typeof module === 'object' && module.exports
    ? require('./hk-signal-forecast-v2.js')
    : root?.StormHkSignalForecastV2;
  const api = factory(base);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StormHkSignalForecastV2Candidate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormHkSignalForecastV205(base) {
  'use strict';

  const VERSION = 'hk-signal-shadow-v2/0.5';
  const BASE_VERSION = base?.VERSION ?? null;
  const T1_PERSISTENCE_FACTOR_FLOOR = 0.70;

  function finite(value) {
    if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
  }

  function cloneSerializable(value) {
    if (value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); }
    catch { return null; }
  }

  function persistenceMaturity(persistenceHours) {
    const hours = Math.max(0, finite(persistenceHours) ?? 0);
    const credibility = 1 - Math.exp(-hours / 12);
    const factor = T1_PERSISTENCE_FACTOR_FLOOR
      + (1 - T1_PERSISTENCE_FACTOR_FLOOR) * credibility;
    return { hours, credibility: clamp(credibility), factor: clamp(factor) };
  }

  function buildForecast(args = {}) {
    if (typeof base?.buildForecast !== 'function') {
      return {
        schemaVersion: VERSION,
        available: false,
        reason: 'v2-0.4-base-unavailable',
        semantics: { shadowOnly: true, developmentRevision: true, officialHkoForecast: false, aiGenerated: false }
      };
    }

    const output = base.buildForecast(args);
    if (output?.available !== true) {
      return {
        ...output,
        schemaVersion: VERSION,
        baseShadowSchemaVersion: output?.schemaVersion ?? BASE_VERSION
      };
    }

    const baselineT1 = args?.basicForecast?.signals?.T1 || null;
    const signal = output?.signals?.T1 || null;
    const diagnostics = signal?.shadowDiagnostics || null;
    const readiness = diagnostics?.decisionReadiness || null;
    const prePersistenceIndex = finite(readiness?.index);
    const maturity = persistenceMaturity(baselineT1?.persistenceHours);
    const likelyFloor = finite(readiness?.likelyFloor) ?? finite(base?.T1_LIKELY_READINESS_FLOOR) ?? 0.58;
    const adjustedIndex = Number.isFinite(prePersistenceIndex)
      ? clamp(prePersistenceIndex * maturity.factor)
      : null;

    output.schemaVersion = VERSION;
    output.baseShadowSchemaVersion = BASE_VERSION;
    if (output.shadow) {
      output.shadow.version = VERSION;
      output.shadow.mode = 'parallel-shadow-development';
    }

    if (signal && baselineT1?.likelihood === 'likely' && Number.isFinite(adjustedIndex)) {
      signal.baseDecisionReadinessIndexV04 = prePersistenceIndex;
      signal.decisionReadinessIndex = adjustedIndex;
      signal.persistenceMaturity = {
        persistenceHours: maturity.hours,
        credibility: maturity.credibility,
        factor: maturity.factor,
        factorFloor: T1_PERSISTENCE_FACTOR_FLOOR
      };

      signal.shadowDiagnostics = {
        ...(signal.shadowDiagnostics || {}),
        decisionReadiness: {
          ...(cloneSerializable(readiness) || {}),
          prePersistenceIndex,
          persistenceHours: maturity.hours,
          persistenceCredibility: maturity.credibility,
          persistenceFactor: maturity.factor,
          persistenceFactorFloor: T1_PERSISTENCE_FACTOR_FLOOR,
          index: adjustedIndex,
          likelyFloor
        }
      };

      if (signal.likelihood === 'likely' && adjustedIndex < likelyFloor) {
        signal.likelihood = 'possible';
        signal.timingState = signal.estimatedWindow?.start && signal.estimatedWindow?.end
          ? signal.timingState
          : signal.timingState;
        output.shadow?.adjustments?.push({
          code: 't1-likely-persistence-readiness',
          label: 'T1 likely 持續性成熟度折減',
          prePersistenceDecisionReadinessIndex: prePersistenceIndex,
          decisionReadinessIndex: adjustedIndex,
          likelyFloor,
          persistenceHours: maturity.hours,
          persistenceCredibility: maturity.credibility,
          persistenceFactor: maturity.factor
        });
      }
    }

    output.shadow = {
      ...(output.shadow || {}),
      version: VERSION,
      diagnostics: {
        ...(output.shadow?.diagnostics || {}),
        t1PersistenceMaturity: baselineT1?.likelihood === 'likely' ? {
          persistenceHours: maturity.hours,
          credibility: maturity.credibility,
          factor: maturity.factor,
          factorFloor: T1_PERSISTENCE_FACTOR_FLOOR,
          prePersistenceDecisionReadinessIndex: prePersistenceIndex,
          decisionReadinessIndex: adjustedIndex,
          likelyFloor
        } : null
      }
    };

    output.semantics = {
      ...(output.semantics || {}),
      developmentRevision: true,
      t1LikelyRequiresPersistenceMaturity: true,
      t1PossibleUnaffectedByPersistenceMaturity: true,
      persistenceMaturityChangesLikelihoodNotPhysicalRisk: true,
      label: 'Storm Track warning signal risk estimate V2 shadow 0.5'
    };
    return output;
  }

  return Object.freeze({
    ...(base || {}),
    VERSION,
    BASE_VERSION,
    T1_PERSISTENCE_FACTOR_FLOOR,
    persistenceMaturity,
    buildForecast
  });
});