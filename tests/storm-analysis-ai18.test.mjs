import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/ai18-activate-admin-secrets.yml'), 'utf8');
const doc = fs.readFileSync(path.join(root, 'docs/AI18_SECURE_ADMIN_ACTIVATION.md'), 'utf8');
const trigger = fs.readFileSync(path.join(root, '.github/ai18-activation-trigger.txt'), 'utf8').trim();

assert.equal(trigger, 'PENDING_AI18', 'AI-18 readiness checkpoint must remain locked by default');
assert.match(workflow, /ACTIVATE_AI18/);
assert.match(workflow, /BACKFILL_TOKEN: \$\{\{ secrets\.BACKFILL_TOKEN \}\}/);
assert.match(workflow, /ANALYSIS_ADMIN_TOKEN: \$\{\{ secrets\.ANALYSIS_ADMIN_TOKEN \}\}/);
assert.match(workflow, /\^\[0-9a-fA-F\]\{64\}\$/);
assert.match(workflow, /wrangler secret bulk/);
assert.ok(!workflow.includes('wrangler secret put'), 'AI-18 must activate the pair atomically rather than sequential secret put commands');
assert.ok(!workflow.includes('d1 create'), 'AI-18 must not create a D1 database');
assert.ok(!workflow.includes('d1 migrations apply'), 'AI-18 must not change the migration chain');
assert.ok(!workflow.includes('wrangler deploy'), 'AI-18 must not deploy new Worker code');
assert.ok(!workflow.includes('storm.max-yu.workers.dev'), 'AI-18 must not target the production Storm Worker');
assert.ok(!workflow.includes('wrangler r2'), 'AI-18 must not alter R2');
assert.ok(!workflow.includes('git push origin HEAD:main'), 'AI-18 must not push main');
assert.match(workflow, /missing-body/);
assert.match(workflow, /ANALYSIS_ADMIN_TOKEN must not authorize backfill import/);
assert.match(workflow, /BACKFILL_TOKEN must not authorize analysis-admin endpoints/);
assert.match(workflow, /COMPLETED_AI18/);
assert.match(workflow, /\[skip ci\]/);
assert.match(doc, /openssl rand -hex 32/);
assert.match(doc, /do not paste either application secret into ChatGPT/i);
assert.match(doc, /Database no-write gate/);
assert.match(doc, /actual historical data collection.*future checkpoints/is);

console.log('storm-analysis AI-18 secure admin activation guard tests passed');
