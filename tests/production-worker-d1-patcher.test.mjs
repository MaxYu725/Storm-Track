import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const patcher = path.join(root, 'scripts', 'patch-production-worker-d1-write-amplification.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'storm-worker-d1-'));
const input = path.join(tmp, 'worker.js');
const output = path.join(tmp, 'worker.fixed.js');

const fixture = `
const VERSION = '3.3.0-alpha.2';
const EXPECTED_TABLES = ['storms'];
function nowIso() { return ''; }
function yearFromTime() { return 2026; }
function normalizeInternationalNumber(v) { return v ?? null; }
function preferredName(a, b) { return a || b || ''; }
function normalizeName(v) { return String(v || ''); }
function asArray(v) { return Array.isArray(v) ? v : []; }
async function requireDatabase(env) { return env.DB; }
async function listDatabaseTables() { return ['storms']; }

async function ensureStormRow(db, stormId, storm, seed = null) {
  await db.prepare('OLD STORM UPSERT').run();
}

async function deleteAdvisoryTree(db, advisoryId) {}

async function upsertStormAndAlias(env, storm, stormId) {
  return stormId;
}

async function reconcileStormIdentities(env, options = {}) {}

async function ingestStormAdvisory(env, storm) {
  const db = env.DB;
  const stormId = 's';
  const sourceHash = 'h';
  const raw = { written: false };
  const existing = await db.prepare('SELECT id, source_hash, ingest_status FROM advisories WHERE storm_id=? AND agency=? AND issued_at=? LIMIT 1')
    .bind(stormId, storm.agency, storm.issuedAt).first();
  if (existing?.source_hash === sourceHash && existing?.ingest_status === 'complete') {
    return { outcome: 'duplicate', points: 0, rawWritten: raw.written ? 1 : 0, stormId, advisoryId: existing.id };
  }
  return null;
}

async function collectAllAgencies(env, triggerType = 'manual') {
  const probe = await probeDatabase(env);
  if (!probe.databaseBound || !probe.tablesReady) {
    throw new Error(\`Database is not ready\${probe.missingTables?.length ? \`; missing: \${probe.missingTables.join(', ')}\` : ''}\`);
  }
  const db = env.DB;
  return db;
}
`;

fs.writeFileSync(input, fixture);
execFileSync(process.execPath, [patcher, input, output], { stdio: 'pipe' });
execFileSync(process.execPath, ['--check', output], { stdio: 'pipe' });

const patched = fs.readFileSync(output, 'utf8');
assert.match(patched, /const VERSION = '3\.3\.0-alpha\.3';/);
assert.match(patched, /async function persistedAdvisoryMatches\(db, advisoryId, storm\)/);
assert.match(patched, /SELECT id, source_hash, ingest_status, point_count FROM advisories/);
assert.match(patched, /const aliasUnchanged = Boolean\(existingAlias\)/);
assert.match(patched, /return \{ written: false \};/);
assert.match(patched, /const missingTables = EXPECTED_TABLES\.filter/);
assert.doesNotMatch(patched, /const probe = await probeDatabase\(env\);/);

console.log('production worker D1 patcher: ok');
