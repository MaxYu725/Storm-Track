const VERIFICATION_RESULT_REPOSITORY_VERSION = 'verification-result-repository/v1';
const EXPECTED_VERIFICATION_VERSION = 'forecast-verification/v1';
const MAX_BATCH_ROWS = 100;

function httpError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function requiredText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw httpError(400, 'invalid-verification-row', `${label} is required`);
  return text;
}

function parseJsonText(value, label) {
  const text = requiredText(value, label);
  try {
    JSON.parse(text);
  } catch (error) {
    throw httpError(400, 'invalid-verification-row', `${label} must contain valid JSON`, { cause: error.message });
  }
  return text;
}

function normalizeCandidate(candidate) {
  const row = candidate?.values ?? candidate;
  if (!row || typeof row !== 'object') throw httpError(400, 'invalid-verification-row', 'verification row object is required');
  if (candidate?.table != null && candidate.table !== 'verification_results') {
    throw httpError(400, 'invalid-verification-row', 'only verification_results rows are accepted');
  }
  const normalized = {
    verification_id: requiredText(row.verification_id, 'verification_id'),
    storm_key: requiredText(row.storm_key, 'storm_key'),
    snapshot_id: requiredText(row.snapshot_id, 'snapshot_id'),
    truth_dataset_id: requiredText(row.truth_dataset_id, 'truth_dataset_id'),
    verification_version: requiredText(row.verification_version, 'verification_version'),
    verified_at: requiredText(row.verified_at, 'verified_at'),
    result_json: parseJsonText(row.result_json, 'result_json'),
    calibration_record_json: row.calibration_record_json == null ? null : parseJsonText(row.calibration_record_json, 'calibration_record_json'),
    fingerprint: requiredText(row.fingerprint, 'fingerprint')
  };
  if (normalized.verification_version !== EXPECTED_VERIFICATION_VERSION) {
    throw httpError(400, 'unsupported-verification-version', `verification_version must be ${EXPECTED_VERIFICATION_VERSION}`);
  }
  if (!Number.isFinite(Date.parse(normalized.verified_at))) {
    throw httpError(400, 'invalid-verification-row', 'verified_at must be a valid timestamp');
  }
  if (!/^[0-9a-f]{64}$/i.test(normalized.fingerprint)) {
    throw httpError(400, 'invalid-verification-row', 'fingerprint must be a 64-character hexadecimal SHA-256');
  }
  return normalized;
}

function sameIdentityAndContent(existing, candidate) {
  return existing.verification_id === candidate.verification_id
    && existing.storm_key === candidate.storm_key
    && existing.snapshot_id === candidate.snapshot_id
    && existing.truth_dataset_id === candidate.truth_dataset_id
    && existing.verification_version === candidate.verification_version
    && existing.verified_at === candidate.verified_at
    && existing.result_json === candidate.result_json
    && (existing.calibration_record_json ?? null) === (candidate.calibration_record_json ?? null)
    && existing.fingerprint === candidate.fingerprint;
}

function semanticKey(row) {
  return `${row.snapshot_id}\u0000${row.truth_dataset_id}\u0000${row.verification_version}`;
}

export function validateVerificationRows(candidates) {
  if (!Array.isArray(candidates) || candidates.length < 1) {
    throw httpError(400, 'invalid-verification-batch', 'at least one verification row is required');
  }
  if (candidates.length > MAX_BATCH_ROWS) {
    throw httpError(400, 'verification-batch-too-large', `verification batch must contain at most ${MAX_BATCH_ROWS} rows`);
  }
  const rows = candidates.map(normalizeCandidate);
  const ids = new Set();
  const fingerprints = new Set();
  const semantics = new Set();
  for (const row of rows) {
    if (ids.has(row.verification_id)) throw httpError(409, 'duplicate-verification-id', `duplicate verification_id ${row.verification_id}`);
    if (fingerprints.has(row.fingerprint)) throw httpError(409, 'duplicate-verification-fingerprint', `duplicate fingerprint ${row.fingerprint}`);
    const key = semanticKey(row);
    if (semantics.has(key)) throw httpError(409, 'duplicate-verification-semantic-key', `duplicate snapshot/truth/version tuple for ${row.snapshot_id}`);
    ids.add(row.verification_id);
    fingerprints.add(row.fingerprint);
    semantics.add(key);
  }
  return rows;
}

export function previewVerificationRows(candidates) {
  const rows = validateVerificationRows(candidates);
  return {
    ok: true,
    dryRun: true,
    writesPerformed: false,
    repositoryVersion: VERIFICATION_RESULT_REPOSITORY_VERSION,
    verificationVersion: EXPECTED_VERIFICATION_VERSION,
    rowCount: rows.length,
    verificationIds: rows.map(row => row.verification_id),
    semantics: {
      exactReplayIdempotent: true,
      verificationIdConflictRejected: true,
      fingerprintConflictRejected: true,
      snapshotTruthVersionConflictRejected: true,
      transactionBatchOnPersist: true
    }
  };
}

export function createVerificationResultRepository(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') {
    throw new Error('ANALYSIS_DB D1 binding is required');
  }

  async function findConflicts(row) {
    const result = await db.prepare(`SELECT verification_id, storm_key, snapshot_id, truth_dataset_id,
      verification_version, verified_at, result_json, calibration_record_json, fingerprint
      FROM verification_results
      WHERE verification_id = ?1 OR fingerprint = ?2
        OR (snapshot_id = ?3 AND truth_dataset_id = ?4 AND verification_version = ?5)`)
      .bind(row.verification_id, row.fingerprint, row.snapshot_id, row.truth_dataset_id, row.verification_version)
      .all();
    return Array.isArray(result?.results) ? result.results : [];
  }

  return Object.freeze({
    preview(candidates) {
      return previewVerificationRows(candidates);
    },

    async persist(candidates) {
      const rows = validateVerificationRows(candidates);
      const novel = [];
      const alreadyPresent = [];

      // Complete all conflict checks before constructing a write batch. This
      // makes conflict detection fail-closed and prevents a partial write when
      // one row in the requested batch disagrees with persisted evidence.
      for (const row of rows) {
        const matches = await findConflicts(row);
        if (!matches.length) {
          novel.push(row);
          continue;
        }
        if (matches.length === 1 && sameIdentityAndContent(matches[0], row)) {
          alreadyPresent.push(row.verification_id);
          continue;
        }
        const idConflict = matches.find(existing => existing.verification_id === row.verification_id && !sameIdentityAndContent(existing, row));
        if (idConflict) throw httpError(409, 'verification-id-conflict', `verification_id ${row.verification_id} already exists with different content`);
        const fingerprintConflict = matches.find(existing => existing.fingerprint === row.fingerprint && !sameIdentityAndContent(existing, row));
        if (fingerprintConflict) throw httpError(409, 'verification-fingerprint-conflict', `fingerprint ${row.fingerprint} already belongs to a different verification row`);
        throw httpError(409, 'verification-semantic-conflict', `snapshot/truth/version tuple for ${row.snapshot_id} already has different verification evidence`);
      }

      if (novel.length) {
        const statements = novel.map(row => db.prepare(`INSERT INTO verification_results
          (verification_id, storm_key, snapshot_id, truth_dataset_id, verification_version,
           verified_at, result_json, calibration_record_json, fingerprint)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
          .bind(
            row.verification_id,
            row.storm_key,
            row.snapshot_id,
            row.truth_dataset_id,
            row.verification_version,
            row.verified_at,
            row.result_json,
            row.calibration_record_json,
            row.fingerprint
          ));
        await db.batch(statements);
      }

      return {
        ok: true,
        status: novel.length ? 'completed' : 'already-persisted',
        writesPerformed: novel.length > 0,
        repositoryVersion: VERIFICATION_RESULT_REPOSITORY_VERSION,
        requestedRowCount: rows.length,
        insertedRowCount: novel.length,
        alreadyPresentRowCount: alreadyPresent.length,
        verificationIds: rows.map(row => row.verification_id)
      };
    }
  });
}

export {
  EXPECTED_VERIFICATION_VERSION,
  MAX_BATCH_ROWS,
  VERIFICATION_RESULT_REPOSITORY_VERSION
};
