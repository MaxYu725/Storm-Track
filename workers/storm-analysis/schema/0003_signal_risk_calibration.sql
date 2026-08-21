-- Versioned HKO signal-risk calibration profiles for the independent storm-analysis Worker only.
CREATE TABLE IF NOT EXISTS signal_calibration_profiles (
  profile_id TEXT PRIMARY KEY,
  profile_version TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('champion','challenger','retired')),
  training_window_start TEXT,
  training_window_end TEXT,
  storm_count INTEGER NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  profile_json TEXT NOT NULL,
  metrics_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at TEXT,
  retired_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_signal_calibration_profiles_role
  ON signal_calibration_profiles(role, activated_at, created_at);
