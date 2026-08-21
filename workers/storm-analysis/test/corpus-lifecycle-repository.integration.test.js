import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createCorpusLifecycleRepository, CORPUS_CAPTURE_VERSION } from '../src/corpus-lifecycle-repository.js';

const H = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const D = 'd'.repeat(64);

function snapshot(snapshotId, asOf, fingerprint, payloadHash = fingerprint) {
  return {
    table: 'forecast_snapshots', primaryKey: snapshotId, values: {
      snapshot_id: snapshotId,
      storm_key: 'WP-2026-16',
      as_of: asOf,
      provenance_type: 'storm-track-d1',
      provenance_source: 'storm-track-db/WP-2026-16',
      provenance_source_url: null,
      archive_id: snapshotId,
      original_issued_at: asOf,
      archive_captured_at: asOf,
      payload_hash: payloadHash,
      eligible_for_walkforward: 1,
      rejection_reason: null,
      snapshot_json: JSON.stringify({ storm: { key: 'WP-2026-16' }, sources: { JMA: { forecast: [{ time: '2026-08-22T00:00:00.000Z' }] } } }),
      impact_json: null,
      signal_inputs_json: null,
      source_availability_json: null,
      fingerprint
    }
  };
}

function plan(runId, runFingerprint, snapshots) {
  return {
    schemaVersion: 'historical-backfill-import/v1',
    runId,
    generatedAt: '2026-08-21T08:00:00.000Z',
    source: `integration/${runId}`,
    rows: [
      { table: 'backfill_runs', primaryKey: runId, values: { run_id: runId, import_version: 'historical-backfill-import/v1', source: `integration/${runId}`, generated_at: '2026-08-21T08:00:00.000Z', fingerprint: runFingerprint, status: 'planned' } },
      { table: 'historical_storms', primaryKey: 'WP-2026-16', values: { storm_key: 'WP-2026-16', name_tc: '測試', name_en: 'TEST', season: 2026, basin: 'WNP', backfill_mode: 'forecast-only', agency_skill_eligible: 0, updated_at: '2026-08-21T08:00:00.000Z' } },
      ...snapshots
    ]
  };
}

function captureRequest(runId, runFingerprint, snapshots, evidenceSha = H, captureFingerprint = B) {
  return {
    schemaVersion: CORPUS_CAPTURE_VERSION,
    generatedAt: '2026-08-21T08:00:00.000Z',
    evidenceSha256: evidenceSha,
    captureFingerprint,
    plan: plan(runId, runFingerprint, snapshots),
    captures: [{ windowId: 'wp16-operational', stormKey: 'WP-2026-16', initialState: 'active' }],
    identityProposals: []
  };
}

async function scalar(sql, ...params) {
  const row = await env.ANALYSIS_DB.prepare(sql).bind(...params).first();
  return Number(Object.values(row || {})[0] ?? 0);
}

describe('AI-22 corpus lifecycle repository', () => {
  it('appends incrementally, reuses exact snapshots, rejects conflicts and freezes terminally', async () => {
    const repo = createCorpusLifecycleRepository(env.ANALYSIS_DB);
    const s1 = snapshot('ai22_wp16_00', '2026-08-21T00:00:00.000Z', 'fp-1', 'payload-1');
    const s2 = snapshot('ai22_wp16_06', '2026-08-21T06:00:00.000Z', 'fp-2', 'payload-2');
    const first = await repo.capture(captureRequest('ai22_run_1', 'run-fp-1', [s1, s2]));
    expect(first.appendedSnapshotCount).toBe(2);
    expect(first.existingSnapshotCount).toBe(0);
    expect(await scalar('SELECT COUNT(*) AS n FROM forecast_snapshots WHERE storm_key = ?1', 'WP-2026-16')).toBe(2);

    const s3 = snapshot('ai22_wp16_12', '2026-08-21T12:00:00.000Z', 'fp-3', 'payload-3');
    const secondRequest = captureRequest('ai22_run_2', 'run-fp-2', [s1, s3], C, D);
    secondRequest.generatedAt = '2026-08-21T13:00:00.000Z';
    secondRequest.plan.generatedAt = secondRequest.generatedAt;
    secondRequest.plan.rows[0].values.generated_at = secondRequest.generatedAt;
    secondRequest.plan.rows[1].values.updated_at = secondRequest.generatedAt;
    const second = await repo.capture(secondRequest);
    expect(second.appendedSnapshotCount).toBe(1);
    expect(second.existingSnapshotCount).toBe(1);
    expect(await scalar('SELECT COUNT(*) AS n FROM forecast_snapshots WHERE storm_key = ?1', 'WP-2026-16')).toBe(3);

    const replay = await repo.capture(secondRequest);
    expect(replay.status).toBe('already-imported');
    expect(replay.appendedSnapshotCount).toBe(0);
    expect(replay.existingSnapshotCount).toBe(2);
    expect(replay.writesPerformed).toBe(false);
    expect(await scalar('SELECT COUNT(*) AS n FROM forecast_snapshots WHERE storm_key = ?1', 'WP-2026-16')).toBe(3);

    await repo.transitionWindow({ windowId: 'wp16-operational', toState: 'quiescent', occurredAt: '2026-08-21T14:00:00.000Z', reason: 'no-new-advisories' });
    const s4 = snapshot('ai22_wp16_18', '2026-08-21T18:00:00.000Z', 'fp-4', 'payload-4');
    const thirdRequest = captureRequest('ai22_run_3', 'run-fp-3', [s4], 'e'.repeat(64), 'f'.repeat(64));
    thirdRequest.generatedAt = '2026-08-21T19:00:00.000Z';
    thirdRequest.plan.generatedAt = thirdRequest.generatedAt;
    thirdRequest.plan.rows[0].values.generated_at = thirdRequest.generatedAt;
    thirdRequest.plan.rows[1].values.updated_at = thirdRequest.generatedAt;
    const third = await repo.capture(thirdRequest);
    expect(third.appendedSnapshotCount).toBe(1);
    const active = await env.ANALYSIS_DB.prepare('SELECT lifecycle_state FROM corpus_capture_windows WHERE window_id = ?1').bind('wp16-operational').first();
    expect(active.lifecycle_state).toBe('active');

    await repo.transitionWindow({ windowId: 'wp16-operational', toState: 'frozen', occurredAt: '2026-08-21T20:00:00.000Z', reason: 'capture-window-closed' });
    const s5 = snapshot('ai22_wp16_24', '2026-08-22T00:00:00.000Z', 'fp-5', 'payload-5');
    await expect(repo.capture(captureRequest('ai22_run_4', 'run-fp-4', [s5], '1'.repeat(64), '2'.repeat(64))))
      .rejects.toMatchObject({ code: 'capture-window-frozen' });

    const conflictingId = snapshot('ai22_wp16_00', '2026-08-21T00:00:00.000Z', 'changed', 'changed');
    await expect(repo.previewCapture(captureRequest('ai22_run_5', 'run-fp-5', [conflictingId], '3'.repeat(64), '4'.repeat(64))))
      .rejects.toMatchObject({ code: 'snapshot-id-conflict' });

    const conflictingCutoff = snapshot('different-id', '2026-08-21T00:00:00.000Z', 'changed-2', 'changed-2');
    await expect(repo.previewCapture(captureRequest('ai22_run_6', 'run-fp-6', [conflictingCutoff], '5'.repeat(64), '6'.repeat(64))))
      .rejects.toMatchObject({ code: 'snapshot-cutoff-conflict' });
  });

  it('keeps external identity review separate and resolves reviewed storm-key merges without rewriting snapshots', async () => {
    const repo = createCorpusLifecycleRepository(env.ANALYSIS_DB);
    await env.ANALYSIS_DB.prepare(`INSERT OR IGNORE INTO historical_storms
      (storm_key, name_en, season, basin, backfill_mode, agency_skill_eligible, updated_at)
      VALUES ('WP-2026-TEMP-AI22', 'TEMP', 2026, 'WNP', 'forecast-only', 0, '2026-08-21T08:00:00.000Z')`).run();

    const reviewed = await repo.recordIdentityBinding({
      bindingId: 'binding-reviewed-2618', stormKey: 'WP-2026-16', identityType: 'jma-rsmc-number', identityValue: '2618',
      reviewStatus: 'reviewed', source: 'operator-reviewed-jma-final', evidenceSha256: H,
      proposedAt: '2026-08-21T08:00:00.000Z', reviewedAt: '2026-08-21T21:00:00.000Z', reviewer: 'integration-test', fingerprint: 'identity-reviewed-fp'
    });
    expect(reviewed.canonical).toBe(true);

    await expect(repo.recordIdentityBinding({
      bindingId: 'binding-conflict-2618', stormKey: 'WP-2026-TEMP-AI22', identityType: 'jma-rsmc-number', identityValue: '2618',
      reviewStatus: 'reviewed', source: 'conflict', evidenceSha256: H,
      proposedAt: '2026-08-21T08:00:00.000Z', reviewedAt: '2026-08-21T21:05:00.000Z', reviewer: 'integration-test', fingerprint: 'identity-conflict-fp'
    })).rejects.toMatchObject({ code: 'reviewed-identity-conflict' });

    const merge = await repo.recordStormMerge({
      mergeId: 'merge-temp-to-wp16', fromStormKey: 'WP-2026-TEMP-AI22', toStormKey: 'WP-2026-16', reviewStatus: 'reviewed',
      reason: 'reviewed identity resolution', source: 'operator-review', evidenceSha256: H,
      proposedAt: '2026-08-21T08:00:00.000Z', reviewedAt: '2026-08-21T21:10:00.000Z', reviewer: 'integration-test', fingerprint: 'merge-reviewed-fp'
    });
    expect(merge.reviewStatus).toBe('reviewed');
    const resolved = await repo.resolveStormKey('WP-2026-TEMP-AI22');
    expect(resolved.canonicalStormKey).toBe('WP-2026-16');

    await expect(repo.recordStormMerge({
      mergeId: 'merge-cycle', fromStormKey: 'WP-2026-16', toStormKey: 'WP-2026-TEMP-AI22', reviewStatus: 'reviewed',
      reason: 'must fail', source: 'integration', evidenceSha256: H,
      proposedAt: '2026-08-21T08:00:00.000Z', reviewedAt: '2026-08-21T21:15:00.000Z', reviewer: 'integration-test', fingerprint: 'merge-cycle-fp'
    })).rejects.toMatchObject({ code: 'reviewed-merge-cycle' });

    expect(await scalar('SELECT COUNT(*) AS n FROM verification_results')).toBe(0);
    expect(await scalar('SELECT COUNT(*) AS n FROM agency_skill_profiles')).toBe(0);
    expect(await scalar('SELECT COUNT(*) AS n FROM adaptive_weight_candidates')).toBe(0);
  });
});
