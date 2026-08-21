import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readText = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
const workflow = readText('.github/workflows/ai21-activate-wp17-corpus-import.yml');
const trigger = readText('.github/ai21-corpus-trigger.txt').trim();
const summary = JSON.parse(readText('data/ai21/forecast-corpus-summary.json'));
const verifier = readText('workers/storm-analysis/scripts/ai21-verify-canonical-plan.mjs');

assert.ok(['PENDING_AI21','ACTIVATE_AI21','COMPLETED_AI21'].includes(trigger), `unexpected AI-21 lifecycle: ${trigger}`);
assert.equal(summary.evidenceSha256, 'bf48ab58f885b42b33b0d5f0247416a649b389cfffaa4b4d794868076964716f');
assert.equal(summary.planSha256, '77b2bfdac1190cd5987f2407e9d83af5efa6fabd346ac6f9516fbb3f914e69d2');
assert.equal(summary.runId, 'ai21_forecast_corpus_bf48ab58f885b42b');
assert.equal(summary.stormCount, 1);
assert.equal(summary.snapshotCount, 4);
assert.equal(summary.storms[0].stormKey, 'WP-2026-17');
assert.equal(summary.storms[0].identity.status, 'unreviewed');
assert.equal(summary.storms[0].identity.internationalNumber, null);
assert.equal(summary.tableCounts.truth_datasets, 0);
assert.equal(summary.tableCounts.truth_points, 0);
assert.equal(summary.tableCounts.signal_outcomes, 0);

assert.ok(workflow.includes('ACTIVATE_AI21'));
assert.ok(workflow.includes('COMPLETED_AI21'));
assert.ok(workflow.includes('PENDING_AI20'));
assert.ok(workflow.includes('BACKFILL_TOKEN'));
assert.ok(workflow.includes('ai21-verify-canonical-plan.mjs'));
assert.ok(workflow.includes('AI21_PRODUCTION_EVIDENCE_STILL_MATCHES=true'));
assert.ok(workflow.includes('AI21_PREACTIVATION_AUDIT=true'));
assert.ok(workflow.includes('AI21_IDEMPOTENT_REPLAY=true'));
assert.ok(workflow.includes('AI21_POSTSTATE_VERIFIED=true'));
assert.ok(workflow.includes('AI-21B: record WP-2026-17 corpus import [skip ci]'));

const importCalls = workflow.match(/\/api\/backfill\/import/g) ?? [];
assert.equal(importCalls.length, 2, 'AI-21B must have exactly first-import + idempotent-replay calls');
assert.ok(workflow.includes('/api/backfill/plan'));
assert.ok(!workflow.includes('/api/admin/signal-training'));
assert.ok(!workflow.includes('/api/admin/signal-risk/promotion'));
assert.ok(!workflow.includes('/api/admin/signal-risk/rollback'));
assert.ok(!workflow.includes('wrangler secret put'));
assert.ok(!workflow.includes('wrangler secret bulk'));
assert.ok(!workflow.includes('d1 migrations apply'));
assert.ok(!workflow.includes('d1 create'));
assert.ok(!workflow.includes('workers.dev/api/backfill/import') || workflow.includes('storm-analysis.max-yu.workers.dev'));
assert.ok(!workflow.includes('storm.max-yu.workers.dev'), 'production Storm Worker hostname must not appear');

for (const token of ['INSERT INTO','UPDATE historical_storms','DELETE FROM','DROP TABLE','ALTER TABLE','CREATE TABLE']) {
  assert.ok(!workflow.includes(token), `direct D1 mutation SQL forbidden in AI-21B workflow: ${token}`);
}

assert.ok(workflow.includes('.backfill_runs==2'));
assert.ok(workflow.includes('.historical_storms==2'));
assert.ok(workflow.includes('.forecast_snapshots==8'));
assert.ok(workflow.includes('.wp17_snapshots==4'));
assert.ok(workflow.includes('.truth_datasets==0'));
assert.ok(workflow.includes('.truth_points==0'));
assert.ok(workflow.includes('.verification_results==0'));
assert.ok(workflow.includes('.training_runs==0'));
assert.ok(workflow.includes('.promotion_events==0'));
assert.ok(workflow.includes('.generation==0'));
assert.ok(workflow.includes('.champion_profile_id==null'));

assert.ok(verifier.includes("snapshot?.sources?.HKO?.state === 'missing'"));
assert.ok(verifier.includes("!Object.prototype.hasOwnProperty.call(snapshot.storm, 'internationalNumber')"));
assert.ok(verifier.includes("stormRow?.values?.backfill_mode === 'forecast-only'"));
assert.ok(verifier.includes("Number(stormRow?.values?.agency_skill_eligible) === 0"));
assert.ok(verifier.includes("Date.parse(point.time) > Date.parse(snapshot.generatedAt)"));

console.log(`storm-analysis AI-21B controlled import guards passed (${trigger})`);
