-- Storm Track independent analysis database. Do not apply to the existing production Storm Worker DB.
CREATE TABLE IF NOT EXISTS backfill_runs (
  run_id TEXT PRIMARY KEY,
  import_version TEXT NOT NULL,
  source TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS historical_storms (
  storm_key TEXT PRIMARY KEY,
  name_tc TEXT,
  name_en TEXT,
  season INTEGER,
  basin TEXT NOT NULL DEFAULT 'WNP',
  backfill_mode TEXT NOT NULL,
  agency_skill_eligible INTEGER NOT NULL DEFAULT 0 CHECK (agency_skill_eligible IN (0,1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS truth_datasets (
  dataset_id TEXT PRIMARY KEY,
  storm_key TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT,
  source_version TEXT,
  retrieved_at TEXT,
  fingerprint TEXT NOT NULL UNIQUE,
  FOREIGN KEY (storm_key) REFERENCES historical_storms(storm_key)
);
CREATE INDEX IF NOT EXISTS idx_truth_datasets_storm ON truth_datasets(storm_key);

CREATE TABLE IF NOT EXISTS truth_points (
  point_id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  valid_time TEXT NOT NULL,
  lat REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon REAL NOT NULL CHECK (lon BETWEEN -180 AND 180),
  maximum_wind_json TEXT,
  pressure_json TEXT,
  intensity TEXT,
  source_point_id TEXT,
  fingerprint TEXT NOT NULL,
  FOREIGN KEY (dataset_id) REFERENCES truth_datasets(dataset_id),
  UNIQUE(dataset_id, valid_time, lat, lon)
);
CREATE INDEX IF NOT EXISTS idx_truth_points_dataset_time ON truth_points(dataset_id, valid_time);

CREATE TABLE IF NOT EXISTS forecast_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  storm_key TEXT NOT NULL,
  as_of TEXT NOT NULL,
  provenance_type TEXT NOT NULL,
  provenance_source TEXT,
  provenance_source_url TEXT,
  archive_id TEXT,
  original_issued_at TEXT,
  archive_captured_at TEXT,
  payload_hash TEXT NOT NULL,
  eligible_for_walkforward INTEGER NOT NULL DEFAULT 0 CHECK (eligible_for_walkforward IN (0,1)),
  rejection_reason TEXT,
  snapshot_json TEXT NOT NULL,
  impact_json TEXT,
  signal_inputs_json TEXT,
  source_availability_json TEXT,
  fingerprint TEXT NOT NULL UNIQUE,
  FOREIGN KEY (storm_key) REFERENCES historical_storms(storm_key)
);
CREATE INDEX IF NOT EXISTS idx_forecast_snapshots_storm_asof ON forecast_snapshots(storm_key, as_of);
CREATE INDEX IF NOT EXISTS idx_forecast_snapshots_eligible ON forecast_snapshots(eligible_for_walkforward, as_of);

CREATE TABLE IF NOT EXISTS signal_outcomes (
  outcome_id TEXT PRIMARY KEY,
  storm_key TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT,
  signal_system_era TEXT,
  highest_signal TEXT,
  issued_at TEXT,
  ended_at TEXT,
  details_json TEXT,
  fingerprint TEXT NOT NULL UNIQUE,
  FOREIGN KEY (storm_key) REFERENCES historical_storms(storm_key)
);
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_storm ON signal_outcomes(storm_key);

CREATE TABLE IF NOT EXISTS verification_results (
  verification_id TEXT PRIMARY KEY,
  storm_key TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  truth_dataset_id TEXT NOT NULL,
  verification_version TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  result_json TEXT NOT NULL,
  calibration_record_json TEXT,
  fingerprint TEXT NOT NULL UNIQUE,
  FOREIGN KEY (storm_key) REFERENCES historical_storms(storm_key),
  FOREIGN KEY (snapshot_id) REFERENCES forecast_snapshots(snapshot_id),
  FOREIGN KEY (truth_dataset_id) REFERENCES truth_datasets(dataset_id)
);
CREATE INDEX IF NOT EXISTS idx_verification_storm ON verification_results(storm_key, verified_at);

CREATE TABLE IF NOT EXISTS agency_skill_profiles (
  profile_id TEXT PRIMARY KEY,
  profile_version TEXT NOT NULL,
  training_window_start TEXT,
  training_window_end TEXT,
  storm_count INTEGER NOT NULL DEFAULT 0,
  profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fingerprint TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS adaptive_weight_candidates (
  candidate_id TEXT PRIMARY KEY,
  candidate_version TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  champion_version TEXT,
  candidate_json TEXT NOT NULL,
  holdout_metrics_json TEXT,
  eligible_for_promotion INTEGER NOT NULL DEFAULT 0 CHECK (eligible_for_promotion IN (0,1)),
  promotion_performed INTEGER NOT NULL DEFAULT 0 CHECK (promotion_performed IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fingerprint TEXT NOT NULL UNIQUE,
  FOREIGN KEY (profile_id) REFERENCES agency_skill_profiles(profile_id)
);

CREATE TABLE IF NOT EXISTS model_versions (
  model_version TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('champion','challenger','retired')),
  weights_json TEXT NOT NULL,
  metrics_json TEXT,
  promotion_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at TEXT,
  retired_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_model_versions_role ON model_versions(role, created_at);
