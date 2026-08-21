import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCanonicalTruth, buildReadinessStatus, detectPositionTableFinality, parseBestTrackText } from '../workers/storm-analysis/scripts/ai20-jma-besttrack.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const trigger = read('.github/ai20-truth-trigger.txt').trim();
assert.ok(new Set(['PENDING_AI20','TRUTH_READY_AI20','COMPLETED_AI20']).has(trigger));

const bt2604 = `66666 2604  002 0004 2604 0 6 SINLAKU 20260723\n26040712 002 2 084 1548 1004 000\n26040718 002 3 085 1545 1002 035 00000 0000 10240 0120\n`;
const bt2615 = `66666 2615  002 0015 2615 0 6 CHAN-HOM 20261001\n26080500 002 3 180 1280 998 035 00000 0000 80180 0090\n26080506 002 4 185 1270 985 050 00000 0000 80210 0120\n`;
const preliminary = '<li>台風第15号（台風2615号）※（上陸）</li>';
const finalized = '<li>台風第15号（台風2615号）（上陸）</li>';

const parsed = parseBestTrackText(bt2604);
assert.equal(parsed[0].internationalNumber, '2604');
assert.equal(parsed[0].points.length, 2);
assert.equal(parsed[0].points[1].maximumWind.value, 35);
assert.equal(detectPositionTableFinality(preliminary, '2615'), 'preliminary');
assert.equal(detectPositionTableFinality(finalized, '2615'), 'finalized');

const blocked = buildReadinessStatus({ bestTrackText: bt2604, positionTableHtml: preliminary, internationalNumber: '2615' });
assert.equal(blocked.readyForTruthImport, false);
assert.equal(blocked.reason, 'jma-post-analysis-not-finalized');
assert.throws(() => buildCanonicalTruth({ bestTrackText: bt2604, positionTableHtml: preliminary, internationalNumber: '2615', retrievedAt: '2026-08-21T06:00:00Z' }), e => e?.code === 'jma-truth-not-finalized');

const ready = buildReadinessStatus({ bestTrackText: bt2604 + bt2615, positionTableHtml: finalized, internationalNumber: '2615' });
assert.equal(ready.readyForTruthImport, true);
const truth = buildCanonicalTruth({ bestTrackText: bt2604 + bt2615, positionTableHtml: finalized, internationalNumber: '2615', stormKey: 'WP-2026-15', retrievedAt: '2026-10-02T00:00:00Z' });
assert.equal(truth.source, 'JMA RSMC Tokyo Best Track');
assert.equal(truth.sourceVersion, 'JMA-RSMC-bst2026-rev-20261001');
assert.equal(truth.track.length, 2);
assert.equal(truth.semantics.preliminaryDataUsed, false);
assert.equal(truth.semantics.forecastDataUsedAsTruth, false);

const workflow = read('.github/workflows/ai20-readonly-jma-truth-readiness.yml');
const doc = read('docs/AI20_HISTORICAL_TRUTH_FINALIZATION.md');
for (const marker of ['bst2026.txt','table2026.html','AI20_TRUTH_WRITE_PERFORMED=false','AI20_VERIFICATION_PERFORMED=false','AI20_TRAINING_PERFORMED=false','AI20_PROMOTION_PERFORMED=false']) assert.ok(workflow.includes(marker));
for (const forbidden of ['/api/backfill/import','/api/admin/signal-training/run','/api/admin/signal-risk/promote','wrangler deploy','wrangler secret bulk']) assert.ok(!workflow.includes(forbidden));
assert.doesNotMatch(workflow, /--command\s+["'][^"']*\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/i);
for (const marker of ['2615','JMA RSMC Tokyo Best Track','※','PENDING_AI20','truth_datasets = 0','truth_points = 0','verification_results = 0','generation = 0','no training','no promotion','forecast data must never be used as truth']) assert.ok(doc.includes(marker));

console.log(`storm-analysis AI-20 readiness tests passed (${trigger})`);
