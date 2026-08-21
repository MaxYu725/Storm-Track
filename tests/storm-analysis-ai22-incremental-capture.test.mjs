import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

const trigger = read('.github/ai22-wp16-incremental-trigger.txt').trim();
assert.ok(['PENDING_AI22_WP16_INCREMENTAL', 'ACTIVATE_AI22_WP16_INCREMENTAL', 'COMPLETED_AI22_WP16_INCREMENTAL'].includes(trigger), `unexpected AI-22F trigger ${trigger}`);
assert.equal(read('.github/ai22-runtime-trigger.txt').trim(), 'COMPLETED_AI22_RUNTIME');
assert.equal(read('.github/ai22-wp16-capture-trigger.txt').trim(), 'COMPLETED_AI22_WP16_CAPTURE');

const workflow = read('.github/workflows/ai22-capture-wp16-incremental.yml');
for (const required of [
  'AI-22F Capture WP-2026-16 incremental lifecycle append',
  'EXPECTED_NEW_CUTOFF: 2026-08-21T06:45:00.000Z',
  'EXPECTED_RUN_ID: ai22_capture_30492e45e4045121',
  'EXPECTED_EVIDENCE_SHA256: 30492e45e4045121849a4f77bc86c279fd1a2f45cd91612ae6c2555cd3fd61f2',
  'EXPECTED_PLAN_SHA256: a30b2c7aabd51983633423a1729040ac61c55eebed453e140febf7042d08939e',
  'EXPECTED_CAPTURE_FINGERPRINT: b6695485cc40e8b54dfd97f47f208793221c31dcc949f0c39616722c4dc88487',
  'map(.as_of)==["2026-08-05T12:45:00.000Z","2026-08-07T02:45:00.000Z","2026-08-09T07:00:00.000Z","2026-08-12T12:00:00.000Z"]',
  '.newCutoff.agencies==["CMA","CWA","JMA"]',
  '/api/corpus/capture/preview',
  '/api/corpus/capture',
  'existingSnapshotCount==4',
  'appendedSnapshotCount==1',
  'existingSnapshotCount==5',
  'appendedSnapshotCount==0',
  'writesPerformed==false',
  "for (const key of ['snapshot_id','fingerprint','payload_hash'])",
  'current_existing_memberships:4',
  'current_appended_memberships:1',
  'identity_bindings:2',
  'reviewed_identity_bindings:0',
  'identity_merges:0',
  'truth_datasets:0',
  'verification_results:0',
  'training_runs:0',
  'promotion_events:0',
  'generation:0',
  'COMPLETED_AI22_WP16_INCREMENTAL',
  'lifecycle closeout/transition proof'
]) assert.ok(workflow.includes(required), `AI-22F incremental workflow must include ${required}`);

assert.ok(workflow.includes('.github/ai22-lifecycle-trigger.txt)\" == \"PENDING_AI22\"'), 'overall AI-22 must remain open');
assert.ok(workflow.includes('.github/ai20-truth-trigger.txt)\" == \"PENDING_AI20\"'), 'truth import must remain locked');
assert.ok(workflow.includes('.github/ai22-wp16-capture-trigger.txt)\" == \"COMPLETED_AI22_WP16_CAPTURE\"'), 'first capture prerequisite must remain completed');
assert.ok(workflow.includes('$trigger\" == \"ACTIVATE_AI22_WP16_INCREMENTAL\"'), 'incremental capture requires explicit push activation');
assert.match(workflow, /- name: Perform bounded incremental lifecycle capture[\s\S]*?if: steps\.gate\.outputs\.requested == 'true'/);
assert.match(workflow, /Live preview must remain four existing and one append[\s\S]*?\/api\/corpus\/capture\/preview/);
assert.match(workflow, /Perform bounded incremental lifecycle capture[\s\S]*?\/api\/corpus\/capture\"/);
assert.match(workflow, /Replay exact incremental capture and require zero semantic writes[\s\S]*?\/api\/corpus\/capture\"/);
assert.ok(workflow.includes('storm-track-db --remote --json --experimental-provision=false --command "SELECT'), 'production source access must remain SELECT-only');
assert.ok(!workflow.includes('wrangler deploy'), 'AI-22F must not deploy any Worker');
assert.ok(!workflow.includes('d1 migrations apply'), 'AI-22F must not apply migrations');
assert.ok(!workflow.includes('/api/admin/signal-training/run'), 'AI-22F must not train');
assert.ok(!workflow.includes('/api/admin/signal-risk/promote'), 'AI-22F must not promote');
assert.ok(!workflow.includes('/api/admin/corpus/identity/bind'), 'AI-22F must not review/bind identity through admin API');
assert.ok(!workflow.includes('/api/admin/corpus/identity/merge'), 'AI-22F must not merge identities');

console.log(`storm-analysis AI-22 incremental capture safety guards passed (${trigger})`);
// CI probe only: mutation gate remains closed.
