-- AI-13 historical signal calibration training audit, independent ANALYSIS_DB only.
ALTER TABLE signal_outcomes ADD COLUMN official_hko INTEGER NOT NULL DEFAULT 0 CHECK (official_hko IN (0,1));

CREATE TABLE IF NOT EXISTS signal_calibration_training_runs (
  run_id TEXT PRIMARY KEY,
  trainer_version TEXT NOT NULL,
  challenger_profile_id TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL UNIQUE,
  dataset_fingerprint TEXT NOT NULL,
  champion_profile_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  storm_count INTEGER NOT NULL DEFAULT 0,
  case_count INTEGER NOT NULL DEFAULT 0,
  holdout_storm_count INTEGER NOT NULL DEFAULT 0,
  eligible_for_promotion INTEGER NOT NULL DEFAULT 0 CHECK (eligible_for_promotion IN (0,1)),
  gate_json TEXT,
  metrics_json TEXT,
  result_json TEXT,
  error_json TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_signal_training_runs_status ON signal_calibration_training_runs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_signal_training_runs_profile ON signal_calibration_training_runs(challenger_profile_id, created_at);
