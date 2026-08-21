const TRAINING_REPOSITORY_VERSION = 'signal-training-repository/v1';
function httpError(status, code, message) { const error = new Error(message); error.status = status; error.code = code; return error; }
function json(value) { return JSON.stringify(value ?? null); }

export function createSignalTrainingRepository(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') throw new Error('ANALYSIS_DB D1 binding is required');
  async function findExisting(runId, fingerprint) {
    const byId = await db.prepare('SELECT run_id, input_fingerprint, status, challenger_profile_id, result_json FROM signal_calibration_training_runs WHERE run_id = ?1 LIMIT 1').bind(runId).first();
    if (byId) return { kind: 'run-id', row: byId };
    const byFingerprint = await db.prepare('SELECT run_id, input_fingerprint, status, challenger_profile_id, result_json FROM signal_calibration_training_runs WHERE input_fingerprint = ?1 LIMIT 1').bind(fingerprint).first();
    return byFingerprint ? { kind: 'fingerprint', row: byFingerprint } : null;
  }
  return Object.freeze({
    async beginRun(meta) {
      const runId = String(meta?.runId || '').trim();
      const fingerprint = String(meta?.inputFingerprint || '').trim();
      const profileId = String(meta?.challengerProfileId || '').trim();
      if (!runId || !fingerprint || !profileId) throw httpError(400, 'invalid-training-run', 'runId, inputFingerprint and challengerProfileId are required');
      const existing = await findExisting(runId, fingerprint);
      if (existing) {
        if (existing.kind === 'run-id' && existing.row.input_fingerprint !== fingerprint) throw httpError(409, 'training-run-id-conflict', 'runId already exists with a different fingerprint');
        if (existing.kind === 'fingerprint' && existing.row.run_id !== runId && existing.row.status !== 'completed') throw httpError(409, 'training-fingerprint-conflict', 'fingerprint belongs to another unfinished run');
        if (existing.row.status === 'completed') return { status: 'already-completed', runId: existing.row.run_id, result: existing.row.result_json ? JSON.parse(existing.row.result_json) : null };
      }
      await db.prepare(`INSERT INTO signal_calibration_training_runs
        (run_id, trainer_version, challenger_profile_id, input_fingerprint, dataset_fingerprint, champion_profile_id, status, started_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'running', CURRENT_TIMESTAMP)
        ON CONFLICT(run_id) DO UPDATE SET status='running', started_at=CURRENT_TIMESTAMP, error_json=NULL`)
        .bind(runId, meta.trainerVersion, profileId, fingerprint, meta.datasetFingerprint, meta.championProfileId ?? null).run();
      return { status: 'running', runId };
    },
    async completeRun(runId, trainerResult) {
      const row = trainerResult?.challenger?.profileRow;
      if (!row || row.role !== 'challenger') throw httpError(400, 'invalid-challenger-row', 'trainer result must contain a challenger profile row');
      const existingProfile = await db.prepare('SELECT profile_id, role, profile_json, metrics_json FROM signal_calibration_profiles WHERE profile_id = ?1 LIMIT 1').bind(row.profile_id).first();
      if (existingProfile && (existingProfile.role !== 'challenger' || existingProfile.profile_json !== row.profile_json || existingProfile.metrics_json !== row.metrics_json)) throw httpError(409, 'challenger-profile-conflict', 'profile_id already exists with different role or content');
      const gate = trainerResult.challenger.gate ?? null;
      const statements = [];
      if (!existingProfile) {
        statements.push(db.prepare(`INSERT INTO signal_calibration_profiles
          (profile_id, profile_version, role, training_window_start, training_window_end, storm_count, sample_count, profile_json, metrics_json)
          VALUES (?1, ?2, 'challenger', ?3, ?4, ?5, ?6, ?7, ?8)`)
          .bind(row.profile_id, row.profile_version, row.training_window_start, row.training_window_end, row.storm_count, row.sample_count, row.profile_json, row.metrics_json));
      }
      statements.push(db.prepare(`UPDATE signal_calibration_training_runs SET
        status='completed', storm_count=?1, case_count=?2, holdout_storm_count=?3,
        eligible_for_promotion=?4, gate_json=?5, metrics_json=?6, result_json=?7,
        completed_at=CURRENT_TIMESTAMP WHERE run_id=?8`)
        .bind(
          trainerResult.replay?.eligibleStorms ?? 0,
          trainerResult.replay?.challengerPredictionCount ?? trainerResult.replay?.usableChallengerPredictionCount ?? 0,
          trainerResult.replay?.holdoutStormCount ?? 0,
          trainerResult.challenger?.eligibleForPromotion ? 1 : 0,
          json(gate),
          json({ challenger: trainerResult.challenger?.walkForwardEvaluation, champion: trainerResult.challenger?.championEvaluation }),
          json(trainerResult),
          runId
        ));
      await db.batch(statements);
      return { status: 'completed', runId, challengerProfileId: row.profile_id, eligibleForPromotion: Boolean(trainerResult.challenger?.eligibleForPromotion), promotionPerformed: false };
    },
    async failRun(runId, error) {
      await db.prepare(`UPDATE signal_calibration_training_runs SET status='failed', error_json=?1, completed_at=CURRENT_TIMESTAMP WHERE run_id=?2`)
        .bind(json({ message: error instanceof Error ? error.message : String(error) }), runId).run();
    },
    async getRun(runId) {
      return db.prepare('SELECT * FROM signal_calibration_training_runs WHERE run_id = ?1 LIMIT 1').bind(runId).first();
    }
  });
}

export { TRAINING_REPOSITORY_VERSION };
