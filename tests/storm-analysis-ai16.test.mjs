import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_MIGRATIONS = [
  '0001_learning.sql',
  '0002_analysis_cache.sql',
  '0003_signal_risk_calibration.sql',
  '0004_signal_training_runs.sql',
  '0005_signal_outcome_curations.sql',
  '0006_signal_profile_promotions.sql'
];
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerRoot = path.join(repoRoot, 'workers/storm-analysis');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function parseJsonc(text) {
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
}

const migrationDir = path.join(workerRoot, 'schema');
const migrationNames = fs.readdirSync(migrationDir).filter(name => name.endsWith('.sql')).sort();
assert.deepEqual(migrationNames, EXPECTED_MIGRATIONS, 'migration chain must remain exactly 0001 through 0006');

const migrationSql = Object.fromEntries(EXPECTED_MIGRATIONS.map(name => [name, fs.readFileSync(path.join(migrationDir, name), 'utf8')]));
assert.match(migrationSql['0001_learning.sql'], /CREATE TABLE IF NOT EXISTS signal_outcomes/);
assert.match(migrationSql['0003_signal_risk_calibration.sql'], /CREATE TABLE IF NOT EXISTS signal_calibration_profiles/);
assert.match(migrationSql['0004_signal_training_runs.sql'], /ALTER TABLE signal_outcomes ADD COLUMN official_hko/);
assert.match(migrationSql['0004_signal_training_runs.sql'], /CREATE TABLE IF NOT EXISTS signal_calibration_training_runs/);
assert.match(migrationSql['0005_signal_outcome_curations.sql'], /CREATE TABLE IF NOT EXISTS signal_outcome_curations/);
assert.match(migrationSql['0006_signal_profile_promotions.sql'], /CREATE TABLE IF NOT EXISTS signal_calibration_state/);
assert.match(migrationSql['0006_signal_profile_promotions.sql'], /CREATE TABLE IF NOT EXISTS signal_profile_promotion_events/);
assert.match(migrationSql['0006_signal_profile_promotions.sql'], /REFERENCES signal_calibration_training_runs\(run_id\)/);

const config = parseJsonc(read('workers/storm-analysis/wrangler.jsonc'));
assert.equal(config.$schema, './node_modules/wrangler/config-schema.json');
assert.equal(config.name, 'storm-analysis');
assert.equal(config.main, 'src/index.js');
assert.equal(config.compatibility_date, '2026-08-20');
assert.ok(!Array.isArray(config.compatibility_flags) || !config.compatibility_flags.includes('nodejs_compat'), 'nodejs_compat is redundant on 2026-08-20');
assert.equal(config.d1_databases?.length, 1);
assert.deepEqual(config.d1_databases[0], {
  binding: 'ANALYSIS_DB',
  database_name: 'storm-analysis',
  database_id: ZERO_UUID,
  migrations_dir: 'schema'
});

const pkg = JSON.parse(read('workers/storm-analysis/package.json'));
assert.equal(pkg.devDependencies?.wrangler, '4.124.0');
assert.equal(pkg.devDependencies?.vitest, '4.1.11');
assert.equal(pkg.devDependencies?.['@cloudflare/vitest-pool-workers'], '0.22.0');
assert.match(pkg.scripts?.test || '', /storm-analysis-ai16\.test\.mjs/);
assert.equal(pkg.scripts?.['test:integration'], 'vitest run --config vitest.config.js');
assert.match(pkg.scripts?.['deploy:dry-run'] || '', /--dry-run/);
assert.match(pkg.scripts?.['deploy:dry-run'] || '', /--experimental-provision=false/);

const ignore = read('workers/storm-analysis/.gitignore');
for (const entry of ['node_modules/', '.wrangler/', '.dev.vars', '.secrets.*']) assert.ok(ignore.includes(entry), `${entry} must be ignored`);

const guardPath = path.join(workerRoot, 'scripts/check-deploy-config.mjs');
const allowed = spawnSync(process.execPath, [guardPath, '--allow-placeholder'], { cwd: workerRoot, encoding: 'utf8' });
assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);
assert.match(allowed.stdout, /"placeholder":true/);

const blocked = spawnSync(process.execPath, [guardPath], { cwd: workerRoot, encoding: 'utf8' });
assert.notEqual(blocked.status, 0, 'real deployment target check must reject the zero UUID placeholder');
assert.match(blocked.stderr, /zero-UUID deployment interlock/);

const runbook = read('docs/AI16_DEPLOYMENT_READINESS.md');
for (const required of [
  '0001_learning.sql',
  '0006_signal_profile_promotions.sql',
  'ANALYSIS_DB',
  'BACKFILL_TOKEN',
  'ANALYSIS_ADMIN_TOKEN',
  'Smoke-test checklist',
  'Rollback runbook',
  '--experimental-provision=false',
  'production Storm Worker'
]) assert.ok(runbook.includes(required), `AI-16 runbook must include ${required}`);

console.log('storm-analysis AI-16 deployment readiness tests passed');
