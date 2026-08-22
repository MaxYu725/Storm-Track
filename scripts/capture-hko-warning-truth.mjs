import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const truth = require('../analysis/hko-warning-truth.js');

const BASE_URL = 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php';
const ENDPOINTS = Object.freeze({
  warnsum: `${BASE_URL}?dataType=warnsum&lang=tc`,
  warningInfo: `${BASE_URL}?dataType=warningInfo&lang=tc`,
  swt: `${BASE_URL}?dataType=swt&lang=tc`
});
const TIMEOUT_MS = 25000;

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

async function fetchJson(name, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'Storm-Track-HKO-Truth-Recorder/1.0'
      }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${name} HTTP ${response.status}`);
    let payload;
    try { payload = text ? JSON.parse(text) : {}; }
    catch (error) { throw new Error(`${name} invalid JSON: ${error.message}`); }
    return { name, url, payload, sha256: sha256(text), bytes: Buffer.byteLength(text) };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`${name} request timeout`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const [warnsum, warningInfo, swt] = await Promise.all([
  fetchJson('warnsum', ENDPOINTS.warnsum),
  fetchJson('warningInfo', ENDPOINTS.warningInfo),
  fetchJson('swt', ENDPOINTS.swt)
]);
const retrievedAt = new Date().toISOString();
const sourceHashes = Object.fromEntries([warnsum, warningInfo, swt].map(item => [item.name, item.sha256]));
const snapshot = truth.normalizeSnapshot({
  warnsum: warnsum.payload,
  warningInfo: warningInfo.payload,
  swt: swt.payload,
  retrievedAt,
  sourceHashes,
  sourceCommit: process.env.SOURCE_COMMIT || null
});

const truthFingerprint = sha256(stableJson(truth.truthStateMaterial(snapshot.truth)));
const contextFingerprint = sha256(stableJson(snapshot.context));
const captureFingerprint = sha256(stableJson(truth.fingerprintMaterial(snapshot)));

const output = {
  ...snapshot,
  truthFingerprint,
  contextFingerprint,
  captureFingerprint,
  sources: [warnsum, warningInfo, swt].map(item => ({
    name: item.name,
    url: item.url,
    sha256: item.sha256,
    bytes: item.bytes
  })),
  sourcePayloads: {
    warnsum: warnsum.payload,
    warningInfo: warningInfo.payload,
    swt: swt.payload
  }
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
