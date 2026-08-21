-- AI-14 explicit signal outcome curation audit for the independent ANALYSIS_DB only.
CREATE TABLE IF NOT EXISTS signal_outcome_curations (
  curation_id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL,
  storm_key TEXT NOT NULL,
  expected_fingerprint TEXT NOT NULL,
  official_hko INTEGER NOT NULL CHECK (official_hko IN (0,1)),
  evidence_url TEXT,
  reason TEXT NOT NULL,
  actor_label TEXT,
  auth_method TEXT NOT NULL DEFAULT 'analysis-admin-token',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (outcome_id) REFERENCES signal_outcomes(outcome_id),
  FOREIGN KEY (storm_key) REFERENCES historical_storms(storm_key)
);
CREATE INDEX IF NOT EXISTS idx_signal_outcome_curations_outcome
  ON signal_outcome_curations(outcome_id, created_at);
CREATE INDEX IF NOT EXISTS idx_signal_outcome_curations_storm
  ON signal_outcome_curations(storm_key, created_at);
