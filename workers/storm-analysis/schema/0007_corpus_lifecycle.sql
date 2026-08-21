-- AI-22: append-only forecast corpus lifecycle and reviewed identity mapping.
-- Applies only to the independent storm-analysis D1 database.

CREATE TABLE IF NOT EXISTS corpus_capture_windows (
  window_id TEXT PRIMARY KEY,
  storm_key TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('active','quiescent','frozen')),
  opened_at TEXT NOT NULL,
  quiescent_at TEXT,
  frozen_at TEXT,
  last_capture_run_id TEXT,
  last_capture_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (storm_key) REFERENCES historical_storms(storm_key)
);
CREATE INDEX IF NOT EXISTS idx_corpus_capture_windows_storm
  ON corpus_capture_windows(storm_key, lifecycle_state, updated_at);

CREATE TABLE IF NOT EXISTS corpus_capture_runs (
  capture_run_id TEXT PRIMARY KEY,
  source_run_id TEXT NOT NULL UNIQUE,
  generated_at TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('completed','already-imported')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_run_id) REFERENCES backfill_runs(run_id)
);

CREATE TABLE IF NOT EXISTS corpus_capture_run_storms (
  capture_run_id TEXT NOT NULL,
  window_id TEXT NOT NULL,
  storm_key TEXT NOT NULL,
  snapshots_planned INTEGER NOT NULL DEFAULT 0,
  snapshots_appended INTEGER NOT NULL DEFAULT 0,
  snapshots_existing INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (capture_run_id, storm_key),
  FOREIGN KEY (capture_run_id) REFERENCES corpus_capture_runs(capture_run_id),
  FOREIGN KEY (window_id) REFERENCES corpus_capture_windows(window_id),
  FOREIGN KEY (storm_key) REFERENCES historical_storms(storm_key)
);

CREATE TABLE IF NOT EXISTS corpus_snapshot_memberships (
  capture_run_id TEXT NOT NULL,
  window_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('appended','existing')),
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (capture_run_id, snapshot_id),
  FOREIGN KEY (capture_run_id) REFERENCES corpus_capture_runs(capture_run_id),
  FOREIGN KEY (window_id) REFERENCES corpus_capture_windows(window_id),
  FOREIGN KEY (snapshot_id) REFERENCES forecast_snapshots(snapshot_id)
);
CREATE INDEX IF NOT EXISTS idx_corpus_snapshot_memberships_snapshot
  ON corpus_snapshot_memberships(snapshot_id, capture_run_id);

CREATE TABLE IF NOT EXISTS corpus_lifecycle_events (
  event_id TEXT PRIMARY KEY,
  window_id TEXT NOT NULL,
  from_state TEXT CHECK (from_state IS NULL OR from_state IN ('active','quiescent','frozen')),
  to_state TEXT NOT NULL CHECK (to_state IN ('active','quiescent','frozen')),
  reason TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (window_id) REFERENCES corpus_capture_windows(window_id)
);
CREATE INDEX IF NOT EXISTS idx_corpus_lifecycle_events_window
  ON corpus_lifecycle_events(window_id, occurred_at);

CREATE TABLE IF NOT EXISTS storm_identity_bindings (
  binding_id TEXT PRIMARY KEY,
  storm_key TEXT NOT NULL,
  identity_type TEXT NOT NULL,
  identity_value TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK (review_status IN ('unreviewed','reviewed','rejected')),
  source TEXT,
  evidence_sha256 TEXT,
  proposed_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewer TEXT,
  fingerprint TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (storm_key) REFERENCES historical_storms(storm_key)
);
CREATE INDEX IF NOT EXISTS idx_storm_identity_bindings_storm
  ON storm_identity_bindings(storm_key, review_status, identity_type);
CREATE INDEX IF NOT EXISTS idx_storm_identity_bindings_lookup
  ON storm_identity_bindings(identity_type, identity_value, review_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_storm_identity_reviewed_unique
  ON storm_identity_bindings(identity_type, identity_value)
  WHERE review_status = 'reviewed';

CREATE TABLE IF NOT EXISTS storm_identity_merges (
  merge_id TEXT PRIMARY KEY,
  from_storm_key TEXT NOT NULL,
  to_storm_key TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK (review_status IN ('unreviewed','reviewed','rejected')),
  reason TEXT,
  source TEXT,
  evidence_sha256 TEXT,
  proposed_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewer TEXT,
  fingerprint TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (from_storm_key <> to_storm_key),
  FOREIGN KEY (from_storm_key) REFERENCES historical_storms(storm_key),
  FOREIGN KEY (to_storm_key) REFERENCES historical_storms(storm_key)
);
CREATE INDEX IF NOT EXISTS idx_storm_identity_merges_from
  ON storm_identity_merges(from_storm_key, review_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_storm_identity_reviewed_merge_from
  ON storm_identity_merges(from_storm_key)
  WHERE review_status = 'reviewed';
