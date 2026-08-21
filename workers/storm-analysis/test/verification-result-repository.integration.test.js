import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createVerificationResultRepository, previewVerificationRows } from '../src/verification-result-repository.js';

const STORM = 'AI20-VERIFY-TEST-STORM';
const TRUTH = 'ai20-verify-truth';
const SNAPSHOT_1 = 'ai20-verify-snapshot-1';
const SNAPSHOT_2 = 'ai20-verify-snapshot-2';
const SNAPSHOT_3 = 'ai20-verify-snapshot-3';
const VERIFIED_AT = '2026-10-02T01:00:00.000Z';

function candidate({
  verificationId = 'ai20-verify-row-1',
  snapshotId = SNAPSHOT_1,
  fingerprint = 'a'.repeat(64),
  result = { ok: true, sample: 1 },
  calibration = { stormKey: STORM, sample: 1 }
} = {}) {
  return {
    table: 'verification_results',
    primaryKey: verificationId,
    values: {
      verification_id: verificationId,
      storm_key: STORM,
      snapshot_id: snapshotId,
      truth_dataset_id: TRUTH,
      verification_version: 'forecast-verification/v1',
      verified_at: VERIFIED_AT,
      result_json: JSON.stringify(result),
      calibration_record_json: JSON.stringify(calibration),
      fingerprint
    }
  };
}

async function countRows() {
  const row = await env.ANALYSIS_DB.prepare(
    "SELECT COUNT(*) AS count FROM verification_results WHERE storm_key = ?1"
  ).bind(STORM).first();
  return Number(row?.count ?? 0);
}

beforeAll(async () => {
  await env.ANALYSIS_DB.batch([
    env.ANALYSIS_DB.prepare(`INSERT OR IGNORE INTO historical_storms
      (storm_key, name_en, season, basin, backfill_mode, agency_skill_eligible, updated_at)
      VALUES (?1, 'TEST', 2026, 'WNP', 'full-walk-forward', 1, ?2)`)
      .bind(STORM, VERIFIED_AT),
    env.ANALYSIS_DB.prepare(`INSERT OR IGNORE INTO truth_datasets
      (dataset_id, storm_key, source, source_version, retrieved_at, fingerprint)
      VALUES (?1, ?2, 'synthetic-test', 'v1', ?3, ?4)`)
      .bind(TRUTH, STORM, VERIFIED_AT, 'truth-' + '1'.repeat(59)),
    ...[SNAPSHOT_1, SNAPSHOT_2, SNAPSHOT_3].map((snapshotId, index) => env.ANALYSIS_DB.prepare(`INSERT OR IGNORE INTO forecast_snapshots
      (snapshot_id, storm_key, as_of, provenance_type, payload_hash, eligible_for_walkforward,
       snapshot_json, fingerprint)
      VALUES (?1, ?2, ?3, 'test', ?4, 1, ?5, ?6)`)
      .bind(
        snapshotId,
        STORM,
        `2026-08-0${index + 1}T00:00:00.000Z`,
        `payload-${index + 1}`,
        JSON.stringify({ schemaVersion: 'test', snapshotId }),
        `snapshot-fingerprint-${index + 1}`
      ))
  ]);
  await env.ANALYSIS_DB.prepare('DELETE FROM verification_results WHERE storm_key = ?1').bind(STORM).run();
});

describe('AI-20 local verification-result persistence readiness', () => {
  it('previews a valid batch without writing', async () => {
    const preview = previewVerificationRows([candidate()]);
    expect(preview).toMatchObject({ ok: true, dryRun: true, writesPerformed: false, rowCount: 1 });
    expect(await countRows()).toBe(0);
  });

  it('persists once and makes an exact replay idempotent', async () => {
    const repository = createVerificationResultRepository(env.ANALYSIS_DB);
    const first = await repository.persist([candidate()]);
    expect(first).toMatchObject({
      ok: true,
      status: 'completed',
      writesPerformed: true,
      requestedRowCount: 1,
      insertedRowCount: 1,
      alreadyPresentRowCount: 0
    });
    expect(await countRows()).toBe(1);

    const replay = await repository.persist([candidate()]);
    expect(replay).toMatchObject({
      ok: true,
      status: 'already-persisted',
      writesPerformed: false,
      insertedRowCount: 0,
      alreadyPresentRowCount: 1
    });
    expect(await countRows()).toBe(1);
  });

  it('rejects verification-id conflicts without a write', async () => {
    const repository = createVerificationResultRepository(env.ANALYSIS_DB);
    await expect(repository.persist([candidate({ fingerprint: 'b'.repeat(64) })]))
      .rejects.toMatchObject({ status: 409, code: 'verification-id-conflict' });
    expect(await countRows()).toBe(1);
  });

  it('rejects fingerprint reuse by a different verification row', async () => {
    const repository = createVerificationResultRepository(env.ANALYSIS_DB);
    await expect(repository.persist([candidate({
      verificationId: 'ai20-verify-row-fingerprint-conflict',
      snapshotId: SNAPSHOT_2,
      fingerprint: 'a'.repeat(64)
    })])).rejects.toMatchObject({ status: 409, code: 'verification-fingerprint-conflict' });
    expect(await countRows()).toBe(1);
  });

  it('rejects a different result for the same snapshot/truth/version tuple', async () => {
    const repository = createVerificationResultRepository(env.ANALYSIS_DB);
    await expect(repository.persist([candidate({
      verificationId: 'ai20-verify-row-semantic-conflict',
      fingerprint: 'c'.repeat(64),
      result: { ok: true, sample: 999 }
    })])).rejects.toMatchObject({ status: 409, code: 'verification-semantic-conflict' });
    expect(await countRows()).toBe(1);
  });

  it('preflights the complete batch so a later conflict cannot partially persist an earlier novel row', async () => {
    const repository = createVerificationResultRepository(env.ANALYSIS_DB);
    const novel = candidate({
      verificationId: 'ai20-verify-row-novel-before-conflict',
      snapshotId: SNAPSHOT_3,
      fingerprint: 'd'.repeat(64)
    });
    const conflict = candidate({ fingerprint: 'e'.repeat(64) });
    await expect(repository.persist([novel, conflict]))
      .rejects.toMatchObject({ status: 409, code: 'verification-id-conflict' });
    const row = await env.ANALYSIS_DB.prepare(
      'SELECT verification_id FROM verification_results WHERE verification_id = ?1'
    ).bind(novel.values.verification_id).first();
    expect(row).toBeNull();
    expect(await countRows()).toBe(1);
  });
});
