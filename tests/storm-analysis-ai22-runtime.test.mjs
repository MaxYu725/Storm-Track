import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

const trigger = read('.github/ai22-runtime-trigger.txt').trim();
assert.ok(['PENDING_AI22_RUNTIME', 'ACTIVATE_AI22_RUNTIME', 'COMPLETED_AI22_RUNTIME'].includes(trigger), `unexpected AI-22 runtime trigger ${trigger}`);

const workflow = read('.github/workflows/ai22-activate-runtime.yml');
for (const required of [
  'AI-22D Activate corpus lifecycle runtime',
  '$trigger\" == \"ACTIVATE_AI22_RUNTIME\"',
  'github.event_name',
  'refs/heads/feature/ai-analysis-engine',
  'SOURCE_DB_ID: eb0bf995-3ea7-4bf6-bbca-b425892c4d7e',
  'ANALYSIS_DB_ID: 99c692b2-c932-4774-bf8d-2d7f10f6c6f8',
  'npx wrangler d1 migrations apply storm-analysis --remote --experimental-provision=false',
  'npx wrangler deploy --experimental-provision=false',
  'corpusLifecycleVersion==\"corpus-lifecycle-capture/v1\"',
  '/api/corpus/capture/preview',
  'authorization: Bearer ${BACKFILL_TOKEN}',
  'appendedSnapshotCount==.snapshotCount',
  'existingSnapshotCount==0',
  'writesPerformed==false',
  'wp16_snapshots:0',
  'capture_windows:0',
  'truth_datasets:0',
  'verification_results:0',
  'training_runs:0',
  'promotion_events:0',
  'champion_profile_id',
  'COMPLETED_AI22_RUNTIME',
  'AI22_RUNTIME_CORPUS_WRITES_PERFORMED=false'
]) assert.ok(workflow.includes(required), `AI-22 runtime workflow must include ${required}`);

assert.match(workflow, /if: steps\.gate\.outputs\.requested == 'true'[\s\S]*?Apply only the pending lifecycle migration/);
assert.match(workflow, /if: steps\.gate\.outputs\.requested == 'true'[\s\S]*?Deploy independent storm-analysis Worker runtime/);
assert.match(workflow, /Exercise live lifecycle preview without writes[\s\S]*?\/api\/corpus\/capture\/preview/);
assert.doesNotMatch(workflow, /Exercise live lifecycle preview without writes[\s\S]*?-X POST \"\$\{WORKER_URL\}\/api\/corpus\/capture\"/);
assert.ok(workflow.includes(".github/ai22-lifecycle-trigger.txt)\" == \"PENDING_AI22\""), 'AI-22 phase lock must remain PENDING while only the runtime is activated');
assert.ok(workflow.includes(".github/ai20-truth-trigger.txt)\" == \"PENDING_AI20\""), 'AI-20 truth import must remain locked');
assert.ok(workflow.includes(".github/ai21-corpus-trigger.txt)\" == \"COMPLETED_AI21\""), 'AI-21 corpus prerequisite must remain completed');
assert.ok(workflow.includes('storm-track-db --remote --json --experimental-provision=false --command "SELECT'), 'production source access must use SELECT-only D1 commands');
assert.ok(!workflow.includes('wrangler deploy --name storm'), 'workflow must never deploy the production Storm Worker');
assert.ok(!workflow.includes('d1 migrations apply storm-track-db'), 'workflow must never migrate the production source D1');

console.log(`storm-analysis AI-22 runtime activation guards passed (${trigger})`);
