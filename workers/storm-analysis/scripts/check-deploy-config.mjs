import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const EXPECTED_MAIN = 'src/index.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowPlaceholder = process.argv.includes('--allow-placeholder');

function fail(message) {
  console.error(`deployment-config-error: ${message}`);
  process.exitCode = 1;
}

function parseJsonc(text) {
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
}

const configPath = path.join(root, 'wrangler.jsonc');
const config = parseJsonc(fs.readFileSync(configPath, 'utf8'));
const databases = Array.isArray(config.d1_databases) ? config.d1_databases : [];
const analysisBindings = databases.filter(item => item?.binding === 'ANALYSIS_DB');

if (config.name !== 'storm-analysis') fail('Worker name must remain storm-analysis');
if (config.main !== EXPECTED_MAIN) fail(`Worker entrypoint must remain ${EXPECTED_MAIN}`);
if (analysisBindings.length !== 1) fail('exactly one ANALYSIS_DB binding is required');
if (databases.length !== 1) fail('only the independent ANALYSIS_DB D1 binding is permitted');

const db = analysisBindings[0];
if (db?.database_name !== 'storm-analysis') fail('ANALYSIS_DB database_name must remain storm-analysis');
if (db?.migrations_dir !== 'schema') fail('ANALYSIS_DB migrations_dir must remain schema');
if (typeof db?.database_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(db.database_id)) fail('ANALYSIS_DB database_id must be a UUID');
if (!allowPlaceholder && db?.database_id === ZERO_UUID) fail('ANALYSIS_DB still uses the AI-16 zero-UUID deployment interlock');

const forbiddenProductionId = String(process.env.PRODUCTION_STORM_DB_ID || '').trim();
if (forbiddenProductionId && db?.database_id === forbiddenProductionId) {
  fail('ANALYSIS_DB matches PRODUCTION_STORM_DB_ID; refusing unsafe deployment target');
}

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  ok: true,
  worker: config.name,
  main: config.main,
  binding: db.binding,
  databaseName: db.database_name,
  placeholder: db.database_id === ZERO_UUID,
  migrationsDir: db.migrations_dir
}));
