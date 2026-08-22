import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const identity = require('../analysis/storm-case-identity.js');
const root = path.resolve(process.argv[2] || '.');
const observationsRoot = path.join(root, 'observations');

function listJsonFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...listJsonFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.json')) result.push(fullPath);
  }
  return result.sort();
}

const records = listJsonFiles(observationsRoot).map(file => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to parse prospective record ${file}: ${error.message}`);
  }
});

const reconciled = identity.reconcileProspectiveRecords(records);
const registry = {
  schemaVersion: reconciled.schemaVersion,
  reconciledThrough: reconciled.reconciledThrough,
  caseCount: reconciled.caseCount,
  cases: reconciled.cases
};

fs.writeFileSync(path.join(root, 'case-registry.json'), `${JSON.stringify(registry, null, 2)}\n`);
fs.writeFileSync(
  path.join(root, 'case-index.ndjson'),
  reconciled.index.length ? `${reconciled.index.map(item => JSON.stringify(item)).join('\n')}\n` : ''
);

process.stdout.write(`${JSON.stringify({
  schemaVersion: reconciled.schemaVersion,
  reconciledThrough: reconciled.reconciledThrough,
  recordCount: records.length,
  caseCount: reconciled.caseCount,
  indexCount: reconciled.index.length,
  cases: reconciled.cases.map(item => ({
    caseId: item.caseId,
    groupKeys: item.groupKeys,
    displayNames: item.displayNames,
    sourceTokens: item.sourceTokens
  }))
}, null, 2)}\n`);
