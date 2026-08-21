const CACHE_SCHEMA_VERSION = 'analysis-cache/v2';

function stableClone(value) {
  if (Array.isArray(value)) return value.map(stableClone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableClone(value[key])]));
}

export function stableStringify(value) {
  return JSON.stringify(stableClone(value));
}

async function sha256Hex(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function fingerprintOptions(input) {
  const snapshotOptions = { ...(input?.snapshotOptions || {}) };
  delete snapshotOptions.generatedAt;
  return {
    compareLeadHours: input?.compareLeadHours ?? null,
    snapshotOptions,
    impactOptions: input?.impactOptions || {},
    signalOptions: input?.signalOptions || {},
    weightedTrackOptions: input?.weightedTrackOptions || {}
  };
}

export async function buildAnalysisCacheIdentity(input, model, orchestrationVersion, signalProfileRecord = null) {
  if (!input?.sourceGroup) throw new Error('sourceGroup is required');
  const advisoryFingerprint = await sha256Hex(stableStringify(input.sourceGroup));
  const optionsFingerprint = await sha256Hex(stableStringify(fingerprintOptions(input)));
  const modelFingerprint = await sha256Hex(stableStringify({ modelVersion: model.modelVersion, weights: model.weights }));
  const signalProfileFingerprint = await sha256Hex(stableStringify(signalProfileRecord ? {
    profileId: signalProfileRecord.profileId ?? null,
    profile: signalProfileRecord.profile ?? null
  } : null));
  const requestFingerprint = await sha256Hex(stableStringify({
    advisoryFingerprint,
    optionsFingerprint,
    modelFingerprint,
    signalProfileFingerprint,
    orchestrationVersion
  }));
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    cacheKey: `analysis_${requestFingerprint}`,
    advisoryFingerprint,
    optionsFingerprint,
    modelFingerprint,
    signalProfileFingerprint,
    signalProfileId: signalProfileRecord?.profileId ?? null,
    requestFingerprint,
    modelVersion: model.modelVersion,
    orchestrationVersion
  };
}

function parseJson(value) {
  if (typeof value === 'object' && value !== null) return value;
  try { return JSON.parse(value); } catch { return null; }
}

export function createAnalysisCacheRepository(db) {
  if (!db || typeof db.prepare !== 'function') throw new Error('ANALYSIS_DB D1 binding is required');
  return Object.freeze({
    async get(cacheKey) {
      const row = await db.prepare('SELECT cache_key, advisory_fingerprint, model_fingerprint, model_version, orchestration_version, result_json, created_at FROM analysis_cache WHERE cache_key = ?1 LIMIT 1')
        .bind(cacheKey).first();
      if (!row) return null;
      const result = parseJson(row.result_json);
      if (!result) return null;
      return {
        cacheKey: row.cache_key,
        advisoryFingerprint: row.advisory_fingerprint,
        modelFingerprint: row.model_fingerprint,
        modelVersion: row.model_version,
        orchestrationVersion: row.orchestration_version,
        createdAt: row.created_at,
        result
      };
    },
    async put(identity, result) {
      const resultJson = JSON.stringify(result);
      await db.prepare(`INSERT INTO analysis_cache (cache_key, advisory_fingerprint, options_fingerprint, model_fingerprint, model_version, orchestration_version, result_json)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(cache_key) DO NOTHING`)
        .bind(identity.cacheKey, identity.advisoryFingerprint, identity.optionsFingerprint, identity.modelFingerprint, identity.modelVersion, identity.orchestrationVersion, resultJson)
        .run();
      return { cacheKey: identity.cacheKey, stored: true };
    }
  });
}

export { CACHE_SCHEMA_VERSION };
