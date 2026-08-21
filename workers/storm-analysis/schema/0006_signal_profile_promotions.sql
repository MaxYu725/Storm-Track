-- AI-15 manual signal calibration Champion promotion / rollback state and audit.
-- Independent ANALYSIS_DB only.
CREATE TABLE IF NOT EXISTS signal_calibration_state (
  state_id INTEGER PRIMARY KEY CHECK (state_id = 1),
  champion_profile_id TEXT,
  generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (champion_profile_id) REFERENCES signal_calibration_profiles(profile_id)
);

INSERT OR IGNORE INTO signal_calibration_state (state_id, champion_profile_id, generation)
SELECT 1,
  CASE WHEN COUNT(*) = 1 THEN MAX(profile_id) ELSE NULL END,
  0
FROM signal_calibration_profiles
WHERE role = 'champion';

CREATE TABLE IF NOT EXISTS signal_profile_promotion_events (
  event_id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('promote','rollback')),
  subject_profile_id TEXT NOT NULL,
  champion_before_profile_id TEXT,
  champion_after_profile_id TEXT,
  source_training_run_id TEXT,
  rollback_of_event_id TEXT,
  rolled_back_by_event_id TEXT,
  state_generation_before INTEGER NOT NULL CHECK (state_generation_before >= 0),
  state_generation_after INTEGER NOT NULL CHECK (state_generation_after = state_generation_before + 1),
  subject_profile_fingerprint TEXT NOT NULL,
  champion_before_fingerprint TEXT,
  champion_after_fingerprint TEXT,
  gate_json TEXT,
  transition_guard INTEGER NOT NULL CHECK (transition_guard = 1),
  reason TEXT NOT NULL,
  actor_label TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (subject_profile_id) REFERENCES signal_calibration_profiles(profile_id),
  FOREIGN KEY (champion_before_profile_id) REFERENCES signal_calibration_profiles(profile_id),
  FOREIGN KEY (champion_after_profile_id) REFERENCES signal_calibration_profiles(profile_id),
  FOREIGN KEY (source_training_run_id) REFERENCES signal_calibration_training_runs(run_id),
  FOREIGN KEY (rollback_of_event_id) REFERENCES signal_profile_promotion_events(event_id),
  FOREIGN KEY (rolled_back_by_event_id) REFERENCES signal_profile_promotion_events(event_id)
);

CREATE INDEX IF NOT EXISTS idx_signal_profile_promotion_events_created
  ON signal_profile_promotion_events(created_at, event_id);
CREATE INDEX IF NOT EXISTS idx_signal_profile_promotion_events_subject
  ON signal_profile_promotion_events(subject_profile_id, created_at);
CREATE INDEX IF NOT EXISTS idx_signal_profile_promotion_events_rollback
  ON signal_profile_promotion_events(rollback_of_event_id, rolled_back_by_event_id);
