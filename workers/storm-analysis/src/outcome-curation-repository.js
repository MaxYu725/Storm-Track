const CURATION_VERSION = 'signal-outcome-curation/v1';

function httpError(status, code, message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}
function nonEmpty(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw httpError(400, 'invalid-curation-request', `${name} is required`);
  return text;
}
function validEvidenceUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
function signalRank(value) {
  const text = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!text) return null;
  if (text.includes('10')) return 10;
  if (text.includes('9')) return 9;
  if (text.includes('8')) return 8;
  if (text.includes('3')) return 3;
  if (text.includes('1')) return 1;
  return null;
}

export function validateOutcomeCuration(input, outcome) {
  const curationId = nonEmpty(input?.curationId, 'curationId');
  const outcomeId = nonEmpty(input?.outcomeId, 'outcomeId');
  const expectedFingerprint = nonEmpty(input?.expectedFingerprint, 'expectedFingerprint');
  const reason = nonEmpty(input?.reason, 'reason');
  if (typeof input?.officialHko !== 'boolean') throw httpError(400, 'invalid-curation-request', 'officialHko must be boolean');
  const evidenceUrl = input?.evidenceUrl == null ? null : String(input.evidenceUrl).trim();
  if (input.officialHko && !validEvidenceUrl(evidenceUrl)) {
    throw httpError(400, 'official-hko-evidence-required', 'official HKO curation requires an http(s) evidenceUrl');
  }
  if (!outcome) throw httpError(404, 'signal-outcome-not-found', `signal outcome ${outcomeId} was not found`);
  if (String(outcome.outcome_id) !== outcomeId) throw httpError(409, 'signal-outcome-id-mismatch', 'loaded outcome does not match outcomeId');
  if (String(outcome.fingerprint || '') !== expectedFingerprint) {
    throw httpError(409, 'signal-outcome-changed', 'signal outcome changed after it was reviewed', {
      expectedFingerprint,
      actualFingerprint: outcome.fingerprint ?? null
    });
  }
  if (input.officialHko) {
    if (String(outcome.signal_system_era || '').toLowerCase() !== 'modern') {
      throw httpError(409, 'non-modern-signal-era', 'only modern-era outcomes may be confirmed for AI-11 calibration');
    }
    if (signalRank(outcome.highest_signal) == null) {
      throw httpError(409, 'invalid-highest-signal', 'outcome does not contain a supported HKO signal value');
    }
  }
  return {
    curationId,
    outcomeId,
    expectedFingerprint,
    officialHko: input.officialHko,
    evidenceUrl,
    reason,
    actorLabel: input?.actorLabel == null ? null : String(input.actorLabel).trim() || null
  };
}

export function createOutcomeCurationRepository(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') {
    throw new Error('ANALYSIS_DB D1 binding is required');
  }
  async function getOutcome(outcomeId) {
    return db.prepare(`SELECT outcome_id, storm_key, source, source_url, signal_system_era,
      highest_signal, official_hko, fingerprint FROM signal_outcomes WHERE outcome_id = ?1 LIMIT 1`)
      .bind(String(outcomeId)).first();
  }
  return Object.freeze({
    getOutcome,
    async curate(input) {
      const outcomeId = nonEmpty(input?.outcomeId, 'outcomeId');
      const curationId = nonEmpty(input?.curationId, 'curationId');
      const existingCuration = await db.prepare(`SELECT curation_id, outcome_id, expected_fingerprint, official_hko,
        evidence_url, reason, actor_label, created_at FROM signal_outcome_curations WHERE curation_id = ?1 LIMIT 1`)
        .bind(curationId).first();
      if (existingCuration) {
        const same = String(existingCuration.outcome_id) === outcomeId
          && String(existingCuration.expected_fingerprint) === String(input?.expectedFingerprint || '')
          && Number(existingCuration.official_hko) === (input?.officialHko ? 1 : 0)
          && String(existingCuration.evidence_url || '') === String(input?.evidenceUrl || '')
          && String(existingCuration.reason || '') === String(input?.reason || '')
          && String(existingCuration.actor_label || '') === String(input?.actorLabel || '');
        if (!same) throw httpError(409, 'curation-id-conflict', 'curationId already exists with different content');
        return {
          status: 'already-curated',
          curationId,
          outcomeId,
          officialHko: Number(existingCuration.official_hko) === 1,
          writesPerformed: false,
          createdAt: existingCuration.created_at ?? null
        };
      }

      const outcome = await getOutcome(outcomeId);
      const validated = validateOutcomeCuration(input, outcome);
      const statements = [
        db.prepare(`INSERT INTO signal_outcome_curations
          (curation_id, outcome_id, storm_key, expected_fingerprint, official_hko, evidence_url, reason, actor_label, auth_method)
          SELECT ?1, outcome_id, storm_key, fingerprint, ?2, ?3, ?4, ?5, 'analysis-admin-token'
          FROM signal_outcomes WHERE outcome_id = ?6 AND fingerprint = ?7`)
          .bind(
            validated.curationId,
            validated.officialHko ? 1 : 0,
            validated.evidenceUrl,
            validated.reason,
            validated.actorLabel,
            validated.outcomeId,
            validated.expectedFingerprint
          ),
        db.prepare('UPDATE signal_outcomes SET official_hko = ?1 WHERE outcome_id = ?2 AND fingerprint = ?3')
          .bind(validated.officialHko ? 1 : 0, validated.outcomeId, validated.expectedFingerprint)
      ];
      await db.batch(statements);
      const audit = await db.prepare(`SELECT curation_id, outcome_id, official_hko, evidence_url, reason, actor_label, created_at
        FROM signal_outcome_curations WHERE curation_id = ?1 LIMIT 1`).bind(validated.curationId).first();
      if (!audit) {
        throw httpError(409, 'signal-outcome-changed', 'signal outcome changed before curation could be committed');
      }
      const updated = await getOutcome(validated.outcomeId);
      if (!updated || Number(updated.official_hko) !== (validated.officialHko ? 1 : 0)) {
        throw httpError(500, 'curation-write-inconsistent', 'curation audit was written but outcome state does not match');
      }
      return {
        status: 'completed',
        schemaVersion: CURATION_VERSION,
        curationId: validated.curationId,
        outcomeId: validated.outcomeId,
        stormKey: updated.storm_key ?? null,
        officialHko: validated.officialHko,
        evidenceUrl: validated.evidenceUrl,
        reason: validated.reason,
        writesPerformed: true,
        promotionPerformed: false
      };
    }
  });
}

export { CURATION_VERSION, signalRank };
