import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const promptContract = require('../analysis/hk-situation-analysis-prompt.js');

const INFERENCE_SCHEMA_VERSION = 'hk-situation-analysis-shadow-inference/v0.1';
const PROVIDER = 'cloudflare-workers-ai-chat-completions';
const ENDPOINT_FAMILY = 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions';
const DEFAULT_MODEL = '@cf/openai/gpt-oss-120b';
const DEFAULT_MAX_TOKENS = 6000;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_SEED = 725;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function sha256(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(canonicalize(value));
  return createHash('sha256').update(text).digest('hex');
}

function hasSafeOfficialContextSemantics(semantics) {
  if (semantics?.noTruthCorpusRead === true) return true;
  return semantics?.noTruthCorpusRead === false
    && semantics?.noFutureTruthFeedback === true
    && semantics?.contemporaneousOfficialContextOnly === true
    && semantics?.noFutureOfficialContextJoin === true;
}

function parsePacket(value) {
  if (!value || typeof value !== 'object') throw new Error('Packet must be an object');
  if (value.schemaVersion !== 'hk-situation-analysis-shadow-packet/v0.1') {
    throw new Error(`Unsupported packet schema: ${value.schemaVersion ?? 'missing'}`);
  }
  if (!/^[0-9a-f]{64}$/.test(String(value.packetFingerprint || ''))) throw new Error('Packet fingerprint is missing or invalid');
  if (value?.semantics?.shadowOnly !== true
      || value?.semantics?.affectsForecast !== false
      || value?.semantics?.affectsEvaluator !== false
      || !hasSafeOfficialContextSemantics(value?.semantics)) {
    throw new Error('Packet does not satisfy shadow/no-future-outcome semantics');
  }
  if (value?.evidencePacket?.schemaVersion !== 'hk-situation-analysis-shadow-input/v0.1') throw new Error('Evidence packet schema mismatch');
  if (value?.evidencePacket?.semantics?.caseSpecificRulesForbidden !== true
      || value?.evidencePacket?.semantics?.noTruthFeedback !== true
      || value?.evidencePacket?.semantics?.evidenceReferencesUseCatalogIds !== true) {
    throw new Error('Evidence packet anti-overfitting/catalog semantics missing');
  }
  if (!promptContract.catalogIds(value.evidencePacket).length) throw new Error('Evidence catalog is missing or empty');
  return value;
}

function endpointForAccount(accountId) {
  const clean = String(accountId || '').trim();
  if (!clean) throw new Error('Cloudflare account ID is required');
  if (!/^[A-Za-z0-9_-]+$/.test(clean)) throw new Error('Cloudflare account ID contains unsupported characters');
  return `https://api.cloudflare.com/client/v4/accounts/${clean}/ai/v1/chat/completions`;
}

function createRequestBody(packet, {
  model = DEFAULT_MODEL,
  maxTokens = DEFAULT_MAX_TOKENS,
  temperature = DEFAULT_TEMPERATURE,
  seed = DEFAULT_SEED
} = {}) {
  parsePacket(packet);
  if (!model || typeof model !== 'string') throw new Error('Model must be a non-empty string');
  if (!Number.isInteger(maxTokens) || maxTokens < 256) throw new Error('maxTokens must be an integer >= 256');
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 5) throw new Error('temperature must be 0..5');
  if (!Number.isInteger(seed) || seed < 1) throw new Error('seed must be a positive integer');

  return {
    model,
    messages: [
      { role: 'system', content: promptContract.buildInstructions() },
      { role: 'user', content: JSON.stringify(packet.evidencePacket) }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: promptContract.outputSchemaForEvidence(packet.evidencePacket)
    },
    max_tokens: maxTokens,
    temperature,
    seed,
    stream: false
  };
}

function unwrapPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Cloudflare response is not an object');
  if (payload.success === false) {
    const first = Array.isArray(payload.errors) ? payload.errors[0] : null;
    throw new Error(`Cloudflare API error: ${first?.message || first?.code || 'unspecified'}`);
  }
  if (payload.result && typeof payload.result === 'object' && !Array.isArray(payload.choices)) return payload.result;
  return payload;
}

function extractStructuredOutput(payload, evidencePacket = null) {
  const response = unwrapPayload(payload);
  const choices = Array.isArray(response.choices) ? response.choices : [];
  const first = choices[0] || null;
  if (!first) throw new Error('Cloudflare Workers AI response contained no choices');
  if (first.finish_reason && !['stop', 'end_turn'].includes(first.finish_reason)) {
    throw new Error(`Cloudflare Workers AI response did not finish normally: ${first.finish_reason}`);
  }
  const content = first?.message?.content;
  let parsed;
  if (content && typeof content === 'object' && !Array.isArray(content)) parsed = content;
  else if (typeof content === 'string' && content.trim()) {
    try { parsed = JSON.parse(content); }
    catch (error) { throw new Error(`Cloudflare Workers AI structured output is not JSON: ${error.message}`); }
  } else throw new Error('Cloudflare Workers AI response contained no assistant content');

  const validation = evidencePacket
    ? promptContract.validateOutputAgainstEvidence(parsed, evidencePacket)
    : promptContract.validateOutput(parsed);
  if (!validation.valid) throw new Error(`Cloudflare Workers AI structured output failed local validation: ${validation.errors.join('; ')}`);
  return parsed;
}

async function runInference(packet, {
  accountId,
  apiToken,
  model = DEFAULT_MODEL,
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  timeoutMs = 120000,
  maxTokens = DEFAULT_MAX_TOKENS,
  temperature = DEFAULT_TEMPERATURE,
  seed = DEFAULT_SEED
} = {}) {
  parsePacket(packet);
  if (!accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID/CF_ACCOUNT_ID is required for inference');
  if (!apiToken) throw new Error('CLOUDFLARE_API_TOKEN/CF_API_TOKEN is required for inference');
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation unavailable');

  const endpoint = endpointForAccount(accountId);
  const requestBody = createRequestBody(packet, { model, maxTokens, temperature, seed });
  const requestFingerprint = sha256(requestBody);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json',
        'user-agent': 'storm-track-ai-situation-shadow/0.3'
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
  } finally { clearTimeout(timer); }

  const responseText = await response.text();
  let payload;
  try { payload = responseText ? JSON.parse(responseText) : {}; }
  catch { throw new Error(`Cloudflare HTTP ${response.status}: non-JSON response`); }
  if (!response.ok) {
    const first = Array.isArray(payload?.errors) ? payload.errors[0] : null;
    const message = first?.message || payload?.error?.message || payload?.message || `HTTP ${response.status}`;
    throw new Error(`Cloudflare Workers AI request failed: ${message}`);
  }

  const providerPayload = unwrapPayload(payload);
  const output = extractStructuredOutput(payload, packet.evidencePacket);
  return {
    schemaVersion: INFERENCE_SCHEMA_VERSION,
    createdAt: now(),
    input: {
      packetFingerprint: packet.packetFingerprint,
      packetSchemaVersion: packet.schemaVersion,
      evidencePacketSchemaVersion: packet.evidencePacket.schemaVersion,
      evidenceCatalogSchemaVersion: packet.evidencePacket.evidenceCatalog.schemaVersion,
      caseId: packet.caseId ?? null,
      groupKey: packet.groupKey ?? null,
      sourceObservationObservedAt: packet.sourceObservationObservedAt ?? null
    },
    prompt: {
      version: promptContract.VERSION,
      outputSchemaVersion: promptContract.OUTPUT_SCHEMA_VERSION,
      requestFingerprint
    },
    provider: {
      name: PROVIDER,
      endpoint: ENDPOINT_FAMILY,
      requestedModel: model,
      returnedModel: providerPayload.model ?? null,
      responseId: providerPayload.id ?? null,
      requestId: response.headers?.get?.('x-request-id') ?? response.headers?.get?.('cf-ray') ?? null,
      status: 'completed',
      reasoningControl: 'provider-default',
      temperature,
      seed,
      maxTokens,
      store: false,
      toolsEnabled: false,
      usage: providerPayload.usage ?? null
    },
    output,
    semantics: {
      shadowOnly: true,
      affectsForecast: false,
      affectsEvaluator: false,
      providerOutputCannotMutateInput: true,
      noTruthFeedback: true,
      noExternalTools: true,
      noWebSearch: true,
      inputPacketIsSoleMeteorologicalEvidence: true,
      caseSpecificRulesForbidden: true,
      structuredOutputRequired: true,
      localValidationRequired: true,
      evidenceReferenceMode: 'catalog-id-only',
      evidenceCatalogIdsRequired: true
    }
  };
}

async function main(argv = process.argv.slice(2)) {
  const [packetPath, modelArg] = argv;
  if (!packetPath) throw new Error('Usage: node scripts/run-hk-situation-analysis-shadow-cloudflare.mjs <packet.json> [model]');
  const packet = parsePacket(JSON.parse(readFileSync(resolve(packetPath), 'utf8')));
  const result = await runInference(packet, {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN,
    model: modelArg || process.env.HK_SITUATION_AI_MODEL || DEFAULT_MODEL
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
const modulePath = resolve(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) {
  main().catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
}

export {
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL,
  DEFAULT_SEED,
  DEFAULT_TEMPERATURE,
  ENDPOINT_FAMILY,
  INFERENCE_SCHEMA_VERSION,
  PROVIDER,
  createRequestBody,
  endpointForAccount,
  extractStructuredOutput,
  hasSafeOfficialContextSemantics,
  parsePacket,
  runInference,
  sha256,
  unwrapPayload
};
