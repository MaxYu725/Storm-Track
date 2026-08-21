import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const EXPECTED_MIGRATIONS = [
  '0001_learning.sql',
  '0002_analysis_cache.sql',
  '0003_signal_risk_calibration.sql',
  '0004_signal_training_runs.sql',
  '0005_signal_outcome_curations.sql',
  '0006_signal_profile_promotions.sql'
];

async function rows(sql, ...params) {
  const statement = env.ANALYSIS_DB.prepare(sql);
  const result = await (params.length ? statement.bind(...params) : statement).all();
  return result.results || [];
}

describe('AI-16 local Workers + D1 integration', () => {
  it('applies the complete migration chain in order', async () => {
    const migrations = await rows('SELECT name FROM d1_migrations ORDER BY id');
    expect(migrations.map(row => row.name)).toEqual(EXPECTED_MIGRATIONS);

    const tables = await rows("SELECT name FROM sqlite_master WHERE type = 'table'");
    const names = new Set(tables.map(row => row.name));
    for (const name of [
      'model_versions',
      'analysis_cache',
      'signal_calibration_profiles',
      'signal_calibration_training_runs',
      'signal_outcome_curations',
      'signal_calibration_state',
      'signal_profile_promotion_events'
    ]) expect(names.has(name)).toBe(true);

    const signalOutcomeColumns = await rows('PRAGMA table_info(signal_outcomes)');
    expect(signalOutcomeColumns.some(row => row.name === 'official_hko')).toBe(true);

    const state = await env.ANALYSIS_DB.prepare(
      'SELECT state_id, champion_profile_id, generation FROM signal_calibration_state WHERE state_id = 1'
    ).first();
    expect(state).toMatchObject({ state_id: 1, champion_profile_id: null, generation: 0 });
  });

  it('boots the Worker with only the independent local ANALYSIS_DB binding', async () => {
    const response = await exports.default.fetch('https://storm-analysis.test/health');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      service: 'storm-analysis',
      analysisDbBound: true,
      importEnabled: false,
      analysisAdminEnabled: false,
      workersAiEnabled: false,
      promotionApiEnabled: true,
      automaticPromotionEnabled: false,
      productionStormWorkerModified: false
    });
  });

  it('reads the migrated D1 through a real Worker route', async () => {
    const response = await exports.default.fetch('https://storm-analysis.test/api/models/champion');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.readOnly).toBe(true);
    expect(body.model).toMatchObject({ modelVersion: 'builtin-equal-v1', role: 'champion', persisted: false });
  });

  it('keeps write-capable admin routes disabled when local secrets are absent', async () => {
    const response = await exports.default.fetch('https://storm-analysis.test/api/admin/signal-risk/promotion/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trainingRunId: 'none', challengerProfileId: 'none' })
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, error: 'analysis-admin-disabled' });
  });
});
