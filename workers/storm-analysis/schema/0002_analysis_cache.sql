-- Deterministic analysis cache for the independent storm-analysis Worker only.
CREATE TABLE IF NOT EXISTS analysis_cache (
  cache_key TEXT PRIMARY KEY,
  advisory_fingerprint TEXT NOT NULL,
  options_fingerprint TEXT NOT NULL,
  model_fingerprint TEXT NOT NULL,
  model_version TEXT NOT NULL,
  orchestration_version TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_analysis_cache_advisory_model
  ON analysis_cache(advisory_fingerprint, model_version, created_at);
