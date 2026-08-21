import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const inventoryWorkflow = read('.github/workflows/ai19-readonly-source-inventory.yml');
const rankingWorkflow = read('.github/workflows/ai19-readonly-candidate-ranking.yml');
const extractionWorkflow = read('.github/workflows/ai19-readonly-forecast-extract.yml');
const planWorkflow = read('.github/workflows/ai19-generate-pilot-plan.yml');
const activationWorkflow = read('.github/workflows/ai19-activate-pilot-import.yml');
const pilotBuilder = read('workers/storm-analysis/scripts/ai19-build-pilot-plan.mjs');
const canonicalVerifier = read('workers/storm-analysis/scripts/ai19-verify-canonical-plan.mjs');
const doc = read('docs/AI19_CONTROLLED_HISTORICAL_BACKFILL_PILOT.md');
const trigger = read('.github/ai19-backfill-trigger.txt').trim();
const allowedTriggers = new Set(['PENDING_AI19', 'ACTIVATE_AI19', 'COMPLETED_AI19']);
const readOnlyWorkflows = [inventoryWorkflow, rankingWorkflow, extractionWorkflow];

assert.ok(allowedTriggers.has(trigger), `AI-19 trigger must be an explicit lifecycle state, got ${trigger}`);
assert.match(inventoryWorkflow, /AI-19 Read-only historical source inventory/);
assert.match(rankingWorkflow, /AI-19 Read-only pilot candidate ranking/);
assert.match(extractionWorkflow, /AI-19 Read-only forecast evidence extraction/);
assert.match(planWorkflow, /AI-19 Generate canonical forecast-only pilot plan/);
assert.match(activationWorkflow, /AI-19 Activate controlled forecast-only pilot import/);
assert.match(inventoryWorkflow, /wrangler d1 list/);
assert.match(inventoryWorkflow, /sqlite_master/);
assert.match(rankingWorkflow, /storm-track-db/);
assert.match(rankingWorkflow, /GROUP_CONCAT\(DISTINCT a\.agency\)/);
assert.match(extractionWorkflow, /WP-2026-15/);
assert.match(extractionWorkflow, /ROW_NUMBER\(\) OVER/);
assert.match(extractionWorkflow, /point_type='forecast'/);
assert.match(extractionWorkflow, /tp\.valid_at > c\.as_of/);
assert.match(extractionWorkflow, /tp\.valid_at > r\.as_of/);
assert.match(extractionWorkflow, /all\(\.\[\]; \.valid_at > \.as_of\)/);
for (const cutoff of ['2026-08-06T00:00:00.000Z','2026-08-08T00:00:00.000Z','2026-08-10T00:00:00.000Z','2026-08-12T02:00:28.000Z']) {
  assert.ok(extractionWorkflow.includes(cutoff), `AI-19 extraction must pin cutoff ${cutoff}`);
  assert.ok(planWorkflow.includes(cutoff), `AI-19 plan generation must pin cutoff ${cutoff}`);
  assert.ok(activationWorkflow.includes(cutoff), `AI-19 activation source recheck must pin cutoff ${cutoff}`);
}

for (const workflow of readOnlyWorkflows) {
  assert.match(workflow, /feature\/ai-analysis-engine/);
  assert.match(workflow, /PENDING_AI19/);
  assert.match(workflow, /DIAG_MUTATIONS_PERFORMED=false/);
  for (const forbidden of [
    'wrangler d1 create',
    'wrangler d1 delete',
    'wrangler d1 migrations apply',
    'wrangler secret put',
    'wrangler secret bulk',
    '/api/backfill/import',
    '/api/admin/signal-training/run',
    '/api/admin/signal-outcomes/curate',
    '/api/admin/signal-risk/promote',
    '/api/admin/signal-risk/rollback'
  ]) assert.ok(!workflow.includes(forbidden), `AI-19 read-only workflow must not contain ${forbidden}`);

  assert.doesNotMatch(workflow, /--command\s+["'][^"']*\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|VACUUM)\b/i);
  assert.doesNotMatch(workflow, /--command\s+["'][^"']*PRAGMA\s+[^;=]+=/i);
}

for (const forbidden of [
  '/api/backfill/import',
  'wrangler d1 create',
  'wrangler d1 delete',
  'wrangler d1 migrations apply',
  'wrangler deploy',
  'wrangler secret put',
  'wrangler secret bulk',
  '/api/admin/signal-training/run',
  '/api/admin/signal-outcomes/curate',
  '/api/admin/signal-risk/promote',
  '/api/admin/signal-risk/rollback'
]) assert.ok(!planWorkflow.includes(forbidden), `AI-19 plan generation must not contain ${forbidden}`);
assert.match(planWorkflow, /\/api\/backfill\/plan/);
assert.match(planWorkflow, /writesPerformed == false/);
assert.match(planWorkflow, /AI19_ANALYSIS_DB_PRISTINE=true/);
assert.match(planWorkflow, /AI19_PLAN_RECORDED=true/);
assert.match(planWorkflow, /git push origin HEAD:feature\/ai-analysis-engine/);
assert.doesNotMatch(planWorkflow, /--command\s+["'][^"']*\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|VACUUM)\b/i);

const importCalls = activationWorkflow.match(/\/api\/backfill\/import/g) || [];
assert.equal(importCalls.length, 2, 'AI-19 activation must call the backfill import endpoint exactly twice: import + idempotent replay');
assert.match(activationWorkflow, /BACKFILL_TOKEN: \$\{\{ secrets\.BACKFILL_TOKEN \}\}/);
assert.match(activationWorkflow, /ACTIVATE_AI19/);
assert.match(activationWorkflow, /COMPLETED_AI19/);
assert.match(activationWorkflow, /chan-hom-import-plan\.json/);
assert.match(activationWorkflow, /21b774c59c7773cd7ccdf03e6002deeed4035cd7ca452dc72a00115e449f591d/);
assert.match(activationWorkflow, /98a3a2d6c20e5a4704604ef7c58df49a7703b93f9399e2e74962bcd76d74573a/);
assert.match(activationWorkflow, /already-imported/);
assert.match(activationWorkflow, /writesPerformed == false/);
assert.match(activationWorkflow, /agency_skill_eligible/);
assert.match(activationWorkflow, /truth_datasets/);
assert.match(activationWorkflow, /truth_points/);
assert.match(activationWorkflow, /signal_outcomes/);
assert.match(activationWorkflow, /training_runs/);
assert.match(activationWorkflow, /generation/);
assert.match(activationWorkflow, /champion_profile_id/);
assert.match(activationWorkflow, /productionStormWorkerModified == false/);
assert.ok(!activationWorkflow.includes('storm.max-yu.workers.dev'), 'AI-19 must not target the production Storm Worker');
for (const forbidden of [
  'wrangler d1 create',
  'wrangler d1 delete',
  'wrangler d1 migrations apply',
  'wrangler deploy',
  'wrangler secret put',
  'wrangler secret bulk',
  'wrangler r2',
  '/api/admin/signal-training/run',
  '/api/admin/signal-outcomes/curate',
  '/api/admin/signal-risk/promote',
  '/api/admin/signal-risk/rollback'
]) assert.ok(!activationWorkflow.includes(forbidden), `AI-19 activation must not contain ${forbidden}`);
assert.doesNotMatch(activationWorkflow, /--command\s+["'][^"']*\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|VACUUM)\b/i);
assert.doesNotMatch(activationWorkflow, /--command\s+["'][^"']*PRAGMA\s+[^;=]+=/i);

assert.match(pilotBuilder, /evidenceSha256/);
assert.match(pilotBuilder, /ai19-forecast-only-pilot\/storm-track-db\/\$\{evidenceSha256\}/);
assert.match(pilotBuilder, /points\.every\(item => item\.valid_at > item\.as_of\)/);
assert.match(pilotBuilder, /plan\.rows\.length === 6/);
assert.match(pilotBuilder, /agency_skill_eligible === 0/);
assert.match(canonicalVerifier, /evidence self-hash mismatch/);
assert.match(canonicalVerifier, /summary plan hash mismatch/);
assert.match(canonicalVerifier, /forecast-only plan must not contain truth\/outcome rows/);
assert.match(canonicalVerifier, /contains non-future forecast point/);

for (const required of [
  'storms <= 1',
  'truth points <= 32',
  'forecast snapshots <= 4',
  'total import-plan rows <= 50',
  'PENDING_AI19',
  'WP-2026-15',
  'storm-track-d1',
  'forecast-only',
  'historical_storms.agency_skill_eligible = 0',
  'truth_points = 0',
  'POST /api/backfill/plan',
  'POST /api/backfill/import',
  'signal_calibration_state.generation = 0',
  'AI-19 does not train or promote anything'
]) assert.ok(doc.includes(required), `AI-19 runbook must include ${required}`);
assert.match(doc, /JMA.*RSMC Best Track Data/is);
assert.match(doc, /preliminary.*truth/is);

if (trigger === 'COMPLETED_AI19') {
  assert.ok(fs.existsSync(path.join(root, 'docs/AI19_PILOT_IMPORT_RESULT.md')), 'COMPLETED_AI19 requires pilot import result evidence');
}

console.log(`storm-analysis AI-19 activation safety guards passed (${trigger})`);
