import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/ai17-provision-storm-analysis.yml'), 'utf8');
const doc = fs.readFileSync(path.join(root, 'docs/AI17_PROVISIONING_FIRST_DEPLOYMENT.md'), 'utf8');

assert.match(workflow, /feature\/ai-analysis-engine/);
assert.match(workflow, /d1 create storm-analysis --location apac/);
assert.match(workflow, /d1 migrations apply storm-analysis --remote/);
assert.match(workflow, /wrangler deploy --experimental-provision=false/);
assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/);
assert.match(workflow, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
assert.match(workflow, /BACKFILL_TOKEN: \$\{\{ secrets\.BACKFILL_TOKEN \}\}/);
assert.match(workflow, /ANALYSIS_ADMIN_TOKEN: \$\{\{ secrets\.ANALYSIS_ADMIN_TOKEN \}\}/);
assert.ok(!workflow.includes('storm.max-yu.workers.dev'), 'AI-17 workflow must never target the production Storm Worker hostname');
assert.ok(!workflow.includes('wrangler r2'), 'AI-17 workflow must not alter R2');
assert.ok(!workflow.includes('git push origin HEAD:main'), 'AI-17 workflow must not push main');
assert.match(doc, /unexpected same-name database causes a hard stop/i);
assert.match(doc, /does not generate unknown one-time application tokens/i);

console.log('storm-analysis AI-17 provisioning guard tests passed');
