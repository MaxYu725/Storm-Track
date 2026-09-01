import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const localWind = require('../analysis/hko-local-wind-shadow.js');

const SOURCE_URL = 'https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_10min_wind.csv';
const DOCUMENTATION_URL = 'https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/HKO_open_data_10min_wind_Documentation.pdf';
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

async function fetchCsv() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(SOURCE_URL, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        accept: 'text/csv,text/plain;q=0.9,*/*;q=0.1',
        'user-agent': 'Storm-Track-HKO-Local-Wind-Shadow/1.0'
      }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HKO local wind HTTP ${response.status}`);
    return text;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('HKO local wind request timeout');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const csv = await fetchCsv();
const retrievedAt = new Date().toISOString();
const stations = localWind.parseCsv(csv);
if (!stations.length) throw new Error('HKO local wind CSV contained no usable station rows');

const summary = localWind.summarize(stations);
const sourceSha256 = sha256(csv);
const dataTimestampMs = Date.parse(summary.dataTimestamp || '');
const retrievedAtMs = Date.parse(retrievedAt);
const sourceAgeMinutes = Number.isFinite(dataTimestampMs) && Number.isFinite(retrievedAtMs)
  ? Math.max(0, (retrievedAtMs - dataTimestampMs) / 60000)
  : null;

const fingerprintMaterial = {
  sourceSha256,
  dataTimestamp: summary.dataTimestamp,
  stations
};
const captureFingerprint = sha256(stableJson(fingerprintMaterial));

const output = {
  schemaVersion: 'hko-local-wind-shadow-observation/v1',
  shadowVersion: localWind.VERSION,
  retrievedAt,
  sourceCommit: process.env.SOURCE_COMMIT || null,
  authority: 'Hong Kong Observatory Open Data',
  provisional: true,
  affectsForecast: false,
  captureFingerprint,
  source: {
    url: SOURCE_URL,
    documentationUrl: DOCUMENTATION_URL,
    sha256: sourceSha256,
    bytes: Buffer.byteLength(csv),
    updateCadenceMinutes: 10
  },
  sourceAgeMinutes,
  stations,
  summary
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
