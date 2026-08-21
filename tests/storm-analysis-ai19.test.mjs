import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const workflow = read('.github/workflows/ai19-readonly-source-inventory.yml');
const doc = read('docs/AI19_CONTROLLED_HISTORICAL_BACKFILL_PILOT.md');
const trigger = read('.github/ai19-backfill-trigger.txt').trim();

assert.equal(trigger, 'PENDING_AI19', 'AI-19 must remain import-locked during source inventory');
assert.match(workflow, /AI-19 Read-only historical source inventory/);
assert.match(workflow, /feature\/ai-analysis-engine/);
assert.match(workflow, /wrangler d1 list/);
assert.match(workflow, /sqlite_master/);
assert.match(workflow, /storm-analysis/);
assert.match(workflow, /storms/);
assert.match(workflow, /advisories/);
assert.match(workflow, /track_points/);
assert.match(workflow, /DIAG_MUTATIONS_PERFORMED=false/);

// Phase A is strictly read-only. Keep mutation-capable operations out of this workflow.
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
]) assert.ok(!workflow.includes(forbidden), `AI-19 inventory must not contain ${forbidden}`);

// All SQL executed remotely by inventory must remain SELECT/PRAGMA read-only.
assert.doesNotMatch(workflow, /--command\s+["'][^"']*\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|VACUUM)\b/i);
assert.doesNotMatch(workflow, /--command\s+["'][^"']*PRAGMA\s+[^;=]+=/i);

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

console.log('storm-analysis AI-19 source-inventory guard tests passed');

// Diagnostic PR marker only; branch is closed without merge after read-only inventory.
