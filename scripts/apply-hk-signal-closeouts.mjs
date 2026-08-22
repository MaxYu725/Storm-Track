import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const closeout = require('../analysis/hk-signal-closeout.js');

const rawEvaluationFile = path.resolve(process.argv[2] || '');
const prospectiveDir = path.resolve(process.argv[3] || '');
const truthDir = path.resolve(process.argv[4] || '');
if (!process.argv[2] || !process.argv[3] || !process.argv[4]) {
  throw new Error('usage: node scripts/apply-hk-signal-closeouts.mjs <raw-evaluation.json> <prospective-corpus-dir> <hko-truth-dir>');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readNdjson(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function listJsonFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(full);
    }
  }
  return files.sort();
}

function stableSort(value) {
  if (Array.isArray(value)) return value.map(stableSort);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableSort(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableSort(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const raw = readJson(rawEvaluationFile);
const caseRegistry = readJson(path.join(prospectiveDir, 'case-registry.json'));
const caseIndex = readNdjson(path.join(prospectiveDir, 'case-index.ndjson'));
const truthEvents = readNdjson(path.join(truthDir, 'truth-events.ndjson'));
const records = listJsonFiles(path.join(prospectiveDir, 'observations')).map(readJson);
const asOf = process.env.CLOSEOUT_AS_OF || new Date().toISOString();

const derived = closeout.deriveCloseouts({
  caseRegistry,
  caseIndex,
  records,
  truthEvents,
  evaluations: raw.evaluations || [],
  asOf
});

const material = structuredClone(raw);
delete material.generatedAt;
delete material.sourceCommit;
delete material.evaluationFingerprint;
material.closeoutPolicyVersion = closeout.POLICY_VERSION;
material.closeoutPolicy = closeout.POLICY;
material.closeoutSummary = {
  closeoutCount: derived.closeouts.length,
  blockedCount: derived.blocked.length,
  classifications: derived.closeouts.reduce((counts, item) => {
    counts[item.forecastOutcome] = (counts[item.forecastOutcome] || 0) + 1;
    return counts;
  }, {})
};
material.closeouts = derived.closeouts;
material.closeoutBlocked = derived.blocked;

const evaluationFingerprint = sha256(stableJson(material));
const output = {
  ...material,
  closeoutCheckedAt: asOf,
  generatedAt: new Date().toISOString(),
  sourceCommit: raw.sourceCommit || process.env.SOURCE_COMMIT || null,
  evaluationFingerprint
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
