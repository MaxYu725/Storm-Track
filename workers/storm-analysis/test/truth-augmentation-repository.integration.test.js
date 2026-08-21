import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTruthAugmentationRepository } from '../src/truth-augmentation-repository.js';

const STORM = 'AI23-TRUTH-TEST-STORM';
const SNAPSHOT = 'ai23-truth-snapshot-1';
const TRUTH = 'ai23-truth-dataset-1';
const RUN = 'ai23-truth-run-1';
const IDENTITY_FP = 'a'.repeat(64);
const GENERATED_AT = '2026-10-10T00:00:00.000Z';

const snapshotValues = Object.freeze({
  snapshot_id: SNAPSHOT,
  storm_key: STORM,
  as_of: '2026-08-20T00:00:00.000Z',
  provenance_type: 'storm-track-d1',
  provenance_source: 'storm-track-db/AI23-TRUTH-TEST-STORM',
  provenance_source_url: null,
  archive_id: 'ai23-truth-archive-1',
  original_issued_at: '2026-08-19T23:00:00.000Z',
  archive_captured_at: '2026-08-20T00:05:00.000Z',
  payload_hash: 'payload-ai23-truth-1',
  eligible_for_walkforward: 1,
  rejection_reason: null,
  snapshot_json: JSON.stringify({ storm: { key: STORM }, sources: { JMA: { forecast: [{ time: '2026-08-21T00:00:00.000Z', lat: 20, lon: 130 }] } } }),
  impact_json: null,
  signal_inputs_json: null,
  source_availability_json: null,
  fingerprint: 'snapshot-ai23-truth-fingerprint-1'
});

function plan() {
  return {
    schemaVersion: 'historical-backfill-import/v1',
    runId: RUN,
    generatedAt: GENERATED_AT,
    source: `ai23-finalized-jma-truth/${STORM}/2699/test`,
    rows: [
      {
        table: 'backfill_runs', primaryKey: RUN, values: {
          run_id: RUN,
          import_version: 'historical-backfill-import/v1',
          source: `ai23-finalized-jma-truth/${STORM}/2699/test`,
          generated_at: GENERATED_AT,
          fingerprint: 'ai23-truth-run-fingerprint-1',
          status: 'planned'
        }
      },
      {
        table: 'historical_storms', primaryKey: STORM, values: {
          storm_key: STORM,
          name_tc: null,
          name_en: 'AI23 TRUTH TEST',
          season: 2026,
          basin: 'WNP',
          backfill_mode: 'full-walk-forward',
          agency_skill_eligible: 1,
          updated_at: GENERATED_AT
        }
      },
      {
        table: 'truth_datasets', primaryKey: TRUTH, values: {
          dataset_id: TRUTH,
          storm_key: STORM,
          source: 'JMA RSMC Tokyo Best Track',
          source_url: 'https://example.test/bst2026.txt',
          source_version: 'JMA-RSMC-bst2026-rev-20261009',
          retrieved_at: GENERATED_AT,
          fingerprint: 'ai23-truth-dataset-fingerprint-1'
        }
      },
      {
        table: 'truth_points', primaryKey: 'ai23-truth-point-1', values: {
          point_id: 'ai23-truth-point-1', dataset_id: TRUTH,
          valid_time: '2026-08-21T00:00:00.000Z', lat: 20, lon: 130,
          maximum_wind_json: JSON.stringify({ value: 45, unit: 'kt', averagingMinutes: 10 }),
          pressure_json: JSON.stringify({ value: 990, unit: 'hPa' }),
          intensity: 'TS', source_point_id: 'JMA-2699-26082100',
          fingerprint: 'ai23-truth-point-fingerprint-1'
        }
      },
      { table: 'forecast_snapshots', primaryKey: SNAPSHOT, values: { ...snapshotValues } }
    ]
  };
}

function request(overrides = {}) {
  return {
    stormKey: STORM,
    internationalNumber: '2699',
    identityBindingFingerprint: IDENTITY_FP,
    plan: plan(),
    ...overrides
  };
}

async function counts() {
  return env.ANALYSIS_DB.prepare(`SELECT
    (SELECT COUNT(*) FROM truth_datasets WHERE storm_key = ?1) AS datasets,
    (SELECT COUNT(*) FROM truth_points WHERE dataset_id = ?2) AS points,
    (SELECT COUNT(*) FROM forecast_snapshots WHERE snapshot_id = ?3) AS snapshots`)
    .bind(STORM, TRUTH, SNAPSHOT).first();
}

beforeAll(async () => {
  await env.ANALYSIS_DB.batch([
    env.ANALYSIS_DB.prepare('DELETE FROM verification_results WHERE storm_key = ?1').bind(STORM),
    env.ANALYSIS_DB.prepare('DELETE FROM truth_points WHERE dataset_id = ?1').bind(TRUTH),
    env.ANALYSIS_DB.prepare('DELETE FROM truth_datasets WHERE dataset_id = ?1').bind(TRUTH),
    env.ANALYSIS_DB.prepare('DELETE FROM backfill_runs WHERE run_id = ?1').bind(RUN),
    env.ANALYSIS_DB.prepare('DELETE FROM storm_identity_bindings WHERE storm_key = ?1').bind(STORM),
    env.ANALYSIS_DB.prepare('DELETE FROM forecast_snapshots WHERE snapshot_id = ?1').bind(SNAPSHOT),
    env.ANALYSIS_DB.prepare('DELETE FROM historical_storms WHERE storm_key = ?1').bind(STORM)
  ]);
  await env.ANALYSIS_DB.batch([
    env.ANALYSIS_DB.prepare(`INSERT INTO historical_storms
      (storm_key, name_tc, name_en, season, basin, backfill_mode, agency_skill_eligible, updated_at)
      VALUES (?1, NULL, 'AI23 TRUTH TEST', 2026, 'WNP', 'forecast-only', 0, ?2)`)
      .bind(STORM, '2026-09-30T00:00:00.000Z'),
    env.ANALYSIS_DB.prepare(`INSERT INTO forecast_snapshots
      (snapshot_id, storm_key, as_of, provenance_type, provenance_source, provenance_source_url,
       archive_id, original_issued_at, archive_captured_at, payload_hash, eligible_for_walkforward,
       rejection_reason, snapshot_json, impact_json, signal_inputs_json, source_availability_json, fingerprint)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`)
      .bind(...Object.values(snapshotValues)),
    env.ANALYSIS_DB.prepare(`INSERT INTO storm_identity_bindings
      (binding_id, storm_key, identity_type, identity_value, review_status, source,
       evidence_sha256, proposed_at, reviewed_at, reviewer, fingerprint)
      VALUES ('ai23-truth-binding-2699', ?1, 'jma-rsmc-number', '2699', 'reviewed',
       'integration-test', ?2, '2026-10-09T00:00:00.000Z', '2026-10-09T01:00:00.000Z',
       'integration-reviewer', ?3)`)
      .bind(STORM, 'b'.repeat(64), IDENTITY_FP)
  ]);
});

describe('AI-23 conflict-safe truth augmentation repository', () => {
  it('previews exact persisted snapshots and novel finalized truth without writing', async () => {
    const repository = createTruthAugmentationRepository(env.ANALYSIS_DB);
    const preview = await repository.preview(request());
    expect(preview).toMatchObject({
      ok: true,
      dryRun: true,
      writesPerformed: false,
      stormKey: STORM,
      internationalNumber: '2699',
      exactSnapshotCount: 1,
      truthDatasetDisposition: 'appended',
      truthPointsExisting: 0,
      truthPointsAppended: 1
    });
    expect(await counts()).toMatchObject({ datasets: 0, points: 0, snapshots: 1 });
  });

  it('imports once, preserves immutable snapshot bytes and makes exact replay zero-write', async () => {
    const repository = createTruthAugmentationRepository(env.ANALYSIS_DB);
    const before = await env.ANALYSIS_DB.prepare('SELECT * FROM forecast_snapshots WHERE snapshot_id = ?1').bind(SNAPSHOT).first();
    const first = await repository.import(request());
    expect(first).toMatchObject({
      ok: true,
      status: 'completed',
      writesPerformed: true,
      exactSnapshotCount: 1,
      truthDatasetDisposition: 'existing',
      truthPointsAppended: 0
    });
    expect(await counts()).toMatchObject({ datasets: 1, points: 1, snapshots: 1 });
    const after = await env.ANALYSIS_DB.prepare('SELECT * FROM forecast_snapshots WHERE snapshot_id = ?1').bind(SNAPSHOT).first();
    expect(after).toEqual(before);

    const replay = await repository.import(request());
    expect(replay).toMatchObject({ ok: true, status: 'already-imported', writesPerformed: false });
    expect(await counts()).toMatchObject({ datasets: 1, points: 1, snapshots: 1 });
  });

  it('rejects immutable forecast snapshot drift before any truth write', async () => {
    const repository = createTruthAugmentationRepository(env.ANALYSIS_DB);
    const conflicted = request();
    conflicted.plan.rows.find(row => row.table === 'forecast_snapshots').values.payload_hash = 'changed-payload';
    await expect(repository.preview(conflicted)).rejects.toMatchObject({ status: 409, code: 'forecast-snapshot-conflict' });
  });

  it('rejects conflicting persisted truth instead of silently INSERT OR IGNORE', async () => {
    const repository = createTruthAugmentationRepository(env.ANALYSIS_DB);
    const conflicted = request();
    conflicted.plan.rows.find(row => row.table === 'truth_datasets').values.source_version = 'changed-version';
    await expect(repository.preview(conflicted)).rejects.toMatchObject({ status: 409, code: 'truth-dataset-conflict' });
  });

  it('requires the exact reviewed JMA identity binding', async () => {
    const repository = createTruthAugmentationRepository(env.ANALYSIS_DB);
    await expect(repository.preview(request({ identityBindingFingerprint: 'f'.repeat(64) })))
      .rejects.toMatchObject({ status: 409, code: 'reviewed-jma-identity-required' });
  });
});
