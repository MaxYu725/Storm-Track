import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const history = require('../analysis/hko-warning-history.js');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableSort(value) {
  if (Array.isArray(value)) return value.map(stableSort);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableSort(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableSort(value));
}

const retrievedAt = new Date().toISOString();
const sourceUrl = new URL(history.SOURCE_URL);
sourceUrl.searchParams.set('s', String(Date.now()));

const response = await fetch(sourceUrl, {
  headers: {
    'user-agent': 'Storm-Track-HKO-Truth-Audit/1.0',
    accept: 'text/plain,*/*'
  },
  signal: AbortSignal.timeout(20000)
});
const raw = await response.text();
if (!response.ok) throw new Error(`HKO warning history HTTP ${response.status}`);
if (!raw.includes('\t')) throw new Error('HKO warning history response is not tabular');

const parsed = history.parseDataset(raw);
const currentYear = new Date(retrievedAt).getUTCFullYear();
const records = parsed.records.filter(record => {
  const years = [record.startAt, record.endAt]
    .map(value => new Date(value).getUTCFullYear())
    .filter(Number.isFinite);
  return years.some(year => year >= currentYear - 1);
});

const sourceSha256 = sha256(raw);
const material = {
  schemaVersion: 'hko-warning-history-audit-snapshot/v1',
  parserVersion: history.VERSION,
  retrievedAt,
  sourceCommit: process.env.SOURCE_COMMIT || null,
  authority: 'Hong Kong Observatory Warnings & Signals Database',
  source: {
    url: history.SOURCE_URL,
    sha256: sourceSha256,
    bytes: Buffer.byteLength(raw)
  },
  provisionalMarkerPresent: parsed.provisionalMarkerPresent,
  sourceRecordCount: parsed.recordCount,
  sourceProvisionalRecordCount: parsed.provisionalRecordCount,
  retainedFromYear: currentYear - 1,
  recordCount: records.length,
  provisionalRecordCount: records.filter(item => item.provisional).length,
  records
};
const fingerprint = sha256(stableJson(material));

process.stdout.write(`${JSON.stringify({ ...material, fingerprint }, null, 2)}\n`);
