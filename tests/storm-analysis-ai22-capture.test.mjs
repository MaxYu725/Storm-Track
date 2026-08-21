import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

const trigger = read('.github/ai22-wp16-capture-trigger.txt').trim();
assert.ok(['PENDING_AI22_WP16_CAPTURE', 'ACTIVATE_AI22_WP16_CAPTURE', 'COMPLETED_AI22_WP16_CAPTURE'].includes(trigger), `unexpected AI-22E trigger ${trigger}`);

const runtimeTrigger = read('.github/ai22-runtime-trigger.txt').trim();
assert.equal(runtimeTrigger, 'COMPLETED_AI22_RUNTIME', 'AI-22E requires the lifecycle runtime to be completed first');

const workflow = read('.github/workflows/ai22-capture-wp16.yml');
for (const required of [
  'AI-22E Capture WP-2026-16 bounded lifecycle corpus',
  'EXPECTED_RUN_ID: ai22_capture_8ccc1ac5038e5119',
  'EXPECTED_EVIDENCE_SHA256: 8ccc1ac5038e51199b76b1f013f5ee2fcc7c73a7f5c4ee2a8fb722cb871af191',
  'EXPECTED_PLAN_SHA256: 0d0d2f759329ac2ecfa2ca8d9e7619313ecdfe7bc87acc79a655393700a11a6d',
  'EXPECTED_CAPTURE_FINGERPRINT: 01185f49897da6723fe14c0953aa1a9da78194f71cd14325cad3459185687e78',
  'storm-track-db --remote --json --experimental-provision=false --command "SELECT',
  '/api/corpus/capture/preview',
  '/api/corpus/capture',
  'appendedSnapshotCount==4',
  'existingSnapshotCount==0',
  'status==\"already-imported\"',
  'appendedSnapshotCount==0',
  'existingSnapshotCount==4',
  'writesPerformed==false',
  'identityValue==\"18\"',
  'reviewStatus==\"unreviewed\"',
  'reviewed_identity_bindings:0',
  'identity_merges:0',
  'truth_datasets:0',
  'verification_results:0',
  'training_runs:0',
  'promotion_events:0',
  'generation:0',
  'COMPLETED_AI22_WP16_CAPTURE',
  'incremental append proof still pending'
]) assert.ok(workflow.includes(required), `AI-22E workflow must include ${required}`);

assert.ok(workflow.includes(".github/ai22-lifecycle-trigger.txt)\" == \"PENDING_AI22\""), 'overall AI-22 must remain open after first capture');
assert.ok(workflow.includes(".github/ai20-truth-trigger.txt)\" == \"PENDING_AI20\""), 'AI-20 truth import must remain locked');
assert.ok(workflow.includes(".github/ai22-runtime-trigger.txt)\" == \"COMPLETED_AI22_RUNTIME\""), 'runtime activation must be completed before capture');
assert.ok(workflow.includes('$trigger\" == \"ACTIVATE_AI22_WP16_CAPTURE\"'), 'capture requires explicit push activation');
assert.match(workflow, /if: steps\.gate\.outputs\.requested == 'true'[\s\S]*?Perform first bounded WP-2026-16 lifecycle capture/);
assert.match(workflow, /Live pre-capture preview must be four appends and zero writes[\s\S]*?\/api\/corpus\/capture\/preview/);
assert.match(workflow, /Perform first bounded WP-2026-16 lifecycle capture[\s\S]*?\/api\/corpus\/capture\"/);
assert.match(workflow, /Replay exact capture and require zero semantic writes[\s\S]*?\/api\/corpus\/capture\"/);
assert.ok(!workflow.includes('wrangler deploy'), 'AI-22E must not deploy any Worker');
assert.ok(!workflow.includes('d1 migrations apply'), 'AI-22E must not apply any migration');
assert.ok(!workflow.includes('d1 execute storm-track-db --remote --command "INSERT'), 'AI-22E must not write production D1');
assert.ok(!workflow.includes('/api/admin/signal-training/run'), 'AI-22E must not train');
assert.ok(!workflow.includes('/api/admin/signal-risk/promote'), 'AI-22E must not promote');

console.log(`storm-analysis AI-22 first capture safety guards passed (${trigger})`);
