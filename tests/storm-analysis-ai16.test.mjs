import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
const analysisDb = config.d1_databases[0];
assert.equal(analysisDb.binding, 'ANALYSIS_DB');
assert.equal(analysisDb.database_name, 'storm-analysis');
assert.equal(analysisDb.migrations_dir, 'schema');
assert.match(analysisDb.database_id, UUID_RE, 'ANALYSIS_DB database_id must be a UUID');
assert.notEqual(analysisDb.database_id, ZERO_UUID, 'post-AI-17 config must use the provisioned independent ANALYSIS_DB, not the AI-16 placeholder');

const ai17Result = read('docs/AI17_DEPLOYMENT_RESULT.md');
assert.ok(ai17Result.includes(analysisDb.database_id), 'AI-17 deployment evidence must record the same ANALYSIS_DB UUID as Wrangler config');

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
const actualAllowed = spawnSync(process.execPath, [guardPath, '--allow-placeholder'], { cwd: workerRoot, encoding: 'utf8' });
assert.equal(actualAllowed.status, 0, actualAllowed.stderr || actualAllowed.stdout);
assert.match(actualAllowed.stdout, /"placeholder":false/);
const actualDeployTarget = spawnSync(process.execPath, [guardPath], { cwd: workerRoot, encoding: 'utf8' });
assert.equal(actualDeployTarget.status, 0, actualDeployTarget.stderr || actualDeployTarget.stdout);
assert.match(actualDeployTarget.stdout, /"placeholder":false/);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'storm-analysis-ai16-'));
try {
  fs.mkdirSync(path.join(tempRoot, 'scripts'), { recursive: true });
  fs.copyFileSync(guardPath, path.join(tempRoot, 'scripts/check-deploy-config.mjs'));
  fs.writeFileSync(path.join(tempRoot, 'wrangler.jsonc'), JSON.stringify({
    name: 'storm-analysis',
    main: 'src/index.js',
    d1_databases: [{
      binding: 'ANALYSIS_DB',
      database_name: 'storm-analysis',
      database_id: ZERO_UUID,
      migrations_dir: 'schema'
    }]
  }, null, 2));
  const placeholderAllowed = spawnSync(process.execPath, [path.join(tempRoot, 'scripts/check-deploy-config.mjs'), '--allow-placeholder'], { cwd: tempRoot, encoding: 'utf8' });
  assert.equal(placeholderAllowed.status, 0, placeholderAllowed.stderr || placeholderAllowed.stdout);
  assert.match(placeholderAllowed.stdout, /"placeholder":true/);

  const placeholderBlocked = spawnSync(process.execPath, [path.join(tempRoot, 'scripts/check-deploy-config.mjs')], { cwd: tempRoot, encoding: 'utf8' });
  assert.notEqual(placeholderBlocked.status, 0, 'real deployment target check must reject the zero UUID placeholder');
  assert.match(placeholderBlocked.stderr, /zero-UUID deployment interlock/);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

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
