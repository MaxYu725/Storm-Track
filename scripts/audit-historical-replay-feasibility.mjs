import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const audit = require('../analysis/historical-replay-feasibility.js');

const stormFile = process.argv[2];
const advisoryFile = process.argv[3];
if (!stormFile || !advisoryFile) {
  throw new Error('usage: node scripts/audit-historical-replay-feasibility.mjs <storms.json> <forecast-advisories.json>');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

const targets = [
  { id: '2026-hongxia', year: 2026, aliases: ['紅霞', '红霞'] },
  { id: '2025-ragasa', year: 2025, aliases: ['樺加沙', '桦加沙', 'RAGASA'] }
];

const result = audit.auditHistoricalReplay({
  stormRows: readJson(stormFile),
  advisoryRows: readJson(advisoryFile),
  targets,
  generatedAt: process.env.AUDIT_GENERATED_AT || new Date().toISOString()
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
