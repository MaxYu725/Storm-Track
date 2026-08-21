import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const inventoryWorkflow = read('.github/workflows/ai19-readonly-source-inventory.yml');
const rankingWorkflow = read('.github/workflows/ai19-readonly-candidate-ranking.yml');
const doc = read('docs/AI19_CONTROLLED_HISTORICAL_BACKFILL_PILOT.md');
const trigger = read('.github/ai19-backfill-trigger.txt').trim();
const readOnlyWorkflows = [inventoryWorkflow, rankingWorkflow];

assert.equal(trigger, 'PENDING_AI19', 'AI-19 must remain import-locked during source inventory');
assert.match(inventoryWorkflow, /AI-19 Read-only historical source inventory/);
assert.match(rankingWorkflow, /AI-19 Read-only pilot candidate ranking/);
assert.match(inventoryWorkflow, /wrangler d1 list/);
assert.match(inventoryWorkflow, /sqlite_master/);
assert.match(rankingWorkflow, /storm-track-db/);
assert.match(rankingWorkflow, /GROUP_CONCAT\(DISTINCT a\.agency\)/);
assert.match(rankingWorkflow, /track_points/);
assert.match(rankingWorkflow, /DIAG_MUTATIONS_PERFORMED=false/);

for (const workflow of readOnlyWorkflows) {
  assert.match(workflow, /feature\/ai-analysis-engine/);
  assert.match(workflow, /PENDING_AI19/);
  for (const forbidden of [
    'wrangler d1 create',
    'wrangler d1 delete',
    'wrangler d1 migrations apply',
    'wrangler deploy',
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

for (const required of [
  'storms <= 1',
  'truth points <= 32',
  'forecast snapshots <= 4',
  'total import-plan rows <= 50',
  'PENDING_AI19',
  'truth',
  'storm-track-d1',
  'JMA RSMC best track',
  'POST /api/backfill/plan',
  'POST /api/backfill/import',
  'signal_calibration_state.generation = 0',
  'AI-19 does not train or promote anything'
]) assert.ok(doc.includes(required), `AI-19 runbook must include ${required}`);

console.log('storm-analysis AI-19 read-only guard tests passed');
