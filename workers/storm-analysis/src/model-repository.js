const AGENCIES = Object.freeze(['HKO', 'CMA', 'JMA', 'CWA']);
const DEFAULT_BUCKETS = Object.freeze([
  ['0-12h', 0, 12],
  ['12-24h', 12, 24],
  ['24-48h', 24, 48],
  ['48-72h', 48, 72],
  ['72-120h', 72, 120],
  ['120h+', 120, null]
]);
const WEIGHTS_SCHEMA_VERSION = 'storm-analysis-model-weights/v1';
const BUILTIN_MODEL_VERSION = 'builtin-equal-v1';

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeWeights(input) {
  const source = input && typeof input === 'object' ? input : {};
  const values = AGENCIES.map(agency => Math.max(0, finite(source[agency]) ?? 0));
  const sum = values.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return Object.fromEntries(AGENCIES.map(agency => [agency, 1 / AGENCIES.length]));
  return Object.fromEntries(AGENCIES.map((agency, index) => [agency, values[index] / sum]));
}

function normalizeModelWeights(value) {
  const payload = value && typeof value === 'object' ? value : {};
  const defaults = normalizeWeights(payload.defaultWeights ?? payload.championWeights ?? payload.weights ?? payload);
  const buckets = {};
  for (const [bucketId] of DEFAULT_BUCKETS) {
    const candidate = payload?.buckets?.[bucketId]?.weights ?? payload?.buckets?.[bucketId] ?? null;
    buckets[bucketId] = candidate ? normalizeWeights(candidate) : defaults;
  }
  return {
    schemaVersion: WEIGHTS_SCHEMA_VERSION,
    defaultWeights: defaults,
    buckets
  };
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function rowToModel(row, persisted = true) {
  if (!row) return null;
  const rawWeights = parseJson(row.weights_json);
  if (!rawWeights) throw new Error(`model ${row.model_version || 'unknown'} has invalid weights_json`);
  return {
    modelVersion: String(row.model_version),
    role: row.role ?? 'champion',
    persisted,
    weights: normalizeModelWeights(rawWeights),
    metrics: parseJson(row.metrics_json),
    promotionReason: row.promotion_reason ?? null,
    createdAt: row.created_at ?? null,
    activatedAt: row.activated_at ?? null,
    retiredAt: row.retired_at ?? null
  };
}

function builtinChampion() {
  return {
    modelVersion: BUILTIN_MODEL_VERSION,
    role: 'champion',
    persisted: false,
    weights: normalizeModelWeights({ HKO: 0.25, CMA: 0.25, JMA: 0.25, CWA: 0.25 }),
    metrics: null,
    promotionReason: 'No persisted champion model is available',
    createdAt: null,
    activatedAt: null,
    retiredAt: null
  };
}

export function bucketForLeadHours(value) {
  const hours = finite(value);
  if (hours == null || hours < 0) return null;
  const match = DEFAULT_BUCKETS.find(([, min, max]) => hours >= min && (max == null || hours < max));
  return match?.[0] ?? null;
}

export function selectWeightsForLead(model, leadHours) {
  const normalized = model?.weights ?? builtinChampion().weights;
  const bucketId = bucketForLeadHours(leadHours);
  return {
    bucketId,
    weights: bucketId ? normalized.buckets[bucketId] : normalized.defaultWeights,
    fallbackToDefault: !bucketId
  };
}

export function createModelRepository(db) {
  if (!db || typeof db.prepare !== 'function') throw new Error('ANALYSIS_DB D1 binding is required');
  return Object.freeze({
    async getChampion() {
      const row = await db.prepare(`SELECT model_version, role, weights_json, metrics_json, promotion_reason, created_at, activated_at, retired_at
        FROM model_versions WHERE role = 'champion'
        ORDER BY COALESCE(activated_at, created_at) DESC, created_at DESC LIMIT 1`).first();
      return row ? rowToModel(row) : builtinChampion();
    },
    async getByVersion(modelVersion) {
      const version = String(modelVersion || '').trim();
      if (!version) return null;
      if (version === BUILTIN_MODEL_VERSION) return builtinChampion();
      const row = await db.prepare(`SELECT model_version, role, weights_json, metrics_json, promotion_reason, created_at, activated_at, retired_at
        FROM model_versions WHERE model_version = ?1 LIMIT 1`).bind(version).first();
      return rowToModel(row);
    }
  });
}

export { AGENCIES, DEFAULT_BUCKETS, WEIGHTS_SCHEMA_VERSION, BUILTIN_MODEL_VERSION, normalizeWeights, normalizeModelWeights, builtinChampion };
