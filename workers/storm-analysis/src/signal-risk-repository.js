const PROFILE_SCHEMA_VERSION = 'hko-signal-calibration-profile/v1';

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function rowToProfile(row) {
  if (!row) return null;
  const profile = parseJson(row.profile_json);
  if ((row.profile_version && row.profile_version !== PROFILE_SCHEMA_VERSION) || !profile || profile.schemaVersion !== PROFILE_SCHEMA_VERSION) {
    throw new Error(`signal calibration profile ${row.profile_id || 'unknown'} has incompatible profile_json`);
  }
  return {
    profileId: String(row.profile_id),
    storedProfileVersion: row.profile_version ?? profile.schemaVersion,
    role: row.role ?? 'champion',
    persisted: true,
    profile,
    metrics: parseJson(row.metrics_json),
    trainingWindowStart: row.training_window_start ?? null,
    trainingWindowEnd: row.training_window_end ?? null,
    stormCount: Number.isFinite(Number(row.storm_count)) ? Number(row.storm_count) : null,
    sampleCount: Number.isFinite(Number(row.sample_count)) ? Number(row.sample_count) : null,
    createdAt: row.created_at ?? null,
    activatedAt: row.activated_at ?? null,
    retiredAt: row.retired_at ?? null
  };
}

export function createSignalRiskRepository(db) {
  if (!db || typeof db.prepare !== 'function') throw new Error('ANALYSIS_DB D1 binding is required');
  return Object.freeze({
    async getChampion() {
      const row = await db.prepare(`SELECT profile_id, profile_version, role, training_window_start, training_window_end, storm_count, sample_count,
        profile_json, metrics_json, created_at, activated_at, retired_at
        FROM signal_calibration_profiles WHERE role = 'champion'
        ORDER BY COALESCE(activated_at, created_at) DESC, created_at DESC LIMIT 1`).first();
      return rowToProfile(row);
    },
    async getById(profileId) {
      const id = String(profileId || '').trim();
      if (!id) return null;
      const row = await db.prepare(`SELECT profile_id, profile_version, role, training_window_start, training_window_end, storm_count, sample_count,
        profile_json, metrics_json, created_at, activated_at, retired_at
        FROM signal_calibration_profiles WHERE profile_id = ?1 LIMIT 1`).bind(id).first();
      return rowToProfile(row);
    }
  });
}

export { PROFILE_SCHEMA_VERSION };
