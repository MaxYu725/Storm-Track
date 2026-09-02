import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const audit = require('../analysis/hk-situation-analysis-prospective-audit.js');
const prompt = require('../analysis/hk-situation-analysis-prompt.js');

function loadJson(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

function main(argv = process.argv.slice(2)) {
  const [inferencePath, packetPath] = argv;
  if (!inferencePath || !packetPath) {
    throw new Error('Usage: node scripts/audit-hk-situation-analysis-shadow-inference.mjs <inference.json> <packet.json>');
  }
  const result = audit.auditInference(loadJson(inferencePath), loadJson(packetPath), {
    validator: prompt.validateOutputAgainstEvidence
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === 'fail') process.exitCode = 2;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
const modulePath = resolve(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) {
  try { main(); }
  catch (error) { console.error(error?.stack || error); process.exitCode = 1; }
}

export { loadJson, main };
