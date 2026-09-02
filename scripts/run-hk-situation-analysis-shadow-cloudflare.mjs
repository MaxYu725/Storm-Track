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
const MAX_REPAIR_ATTEMPTS = 1;

class StructuredOutputValidationError extends Error {
  constructor(message, validationErrors, candidateOutput) {
    super(message);
    this.name = 'StructuredOutputValidationError';
    this.validationErrors = Array.isArray(validationErrors) ? [...validationErrors] : [];
    this.candidateOutput = candidateOutput ?? null;
  }
}

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

function requestSettings({
  model = DEFAULT_MODEL,
  maxTokens = DEFAULT_MAX_TOKENS,
  temperature = DEFAULT_TEMPERATURE,
  seed = DEFAULT_SEED
} = {}) {
  if (!model || typeof model !== 'string') throw new Error('Model must be a non-empty string');
  if (!Number.isInteger(maxTokens) || maxTokens < 256) throw new Error('maxTokens must be an integer >= 256');
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 5) throw new Error('temperature must be 0..5');
  if (!Number.isInteger(seed) || seed < 1) throw new Error('seed must be a positive integer');
  return { model, maxTokens, temperature, seed };
}

function requestEnvelope(packet, messages, options = {}) {
  const { model, maxTokens, temperature, seed } = requestSettings(options);
  return {
    model,
    messages,
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

function createRequestBody(packet, options = {}) {
  parsePacket(packet);
  return requestEnvelope(packet, [
    { role: 'system', content: promptContract.buildInstructions() },
    { role: 'user', content: JSON.stringify(packet.evidencePacket) }
  ], options);
}

function createRepairRequestBody(packet, candidateOutput, validationErrors, options = {}) {
  parsePacket(packet);
  if (!candidateOutput || typeof candidateOutput !== 'object') throw new Error('Repair candidate output is required');
  if (!Array.isArray(validationErrors) || !validationErrors.length) throw new Error('Repair validation errors are required');
  const repairInstruction = [
    'The previous structured candidate failed repository-local semantic validation.',
    'Repair and return the COMPLETE replacement structured output.',
    'Use ONLY the exact same evidence packet already supplied above. Do not add meteorological evidence, later truth, external knowledge, tools, web data, or case-specific rules.',
    'The validation messages below are structural/semantic diagnostics only; they are not meteorological evidence.',
    'Correct every listed violation while preserving all valid evidence citations as catalog IDs.',
    `VALIDATION_ERRORS=${JSON.stringify(validationErrors)}`
  ].join('\n');
  return requestEnvelope(packet, [
    { role: 'system', content: promptContract.buildInstructions() },
    { role: 'user', content: JSON.stringify(packet.evidencePacket) },
    { role: 'assistant', content: JSON.stringify(candidateOutput) },
    { role: 'user', content: repairInstruction }
  ], options);
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
  if (!validation.valid) {
    throw new StructuredOutputValidationError(
      `Cloudflare Workers AI structured output failed local validation: ${validation.errors.join('; ')}`,
      validation.errors,
      parsed
    );
  }
  return parsed;
}

async function requestCloudflare(endpoint, apiToken, requestBody, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json',
        'user-agent': 'storm-track-ai-situation-shadow/0.5'
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
  return { response, payload, providerPayload: unwrapPayload(payload) };
}

function attemptMetadata(kind, requestFingerprint, call) {
  return {
    kind,
    requestFingerprint,
    responseId: call.providerPayload?.id ?? null,
    returnedModel: call.providerPayload?.model ?? null,
    requestId: call.response?.headers?.get?.('x-request-id') ?? call.response?.headers?.get?.('cf-ray') ?? null,
    usage: call.providerPayload?.usage ?? null
  };
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
  const settings = { model, maxTokens, temperature, seed };
  const initialBody = createRequestBody(packet, settings);
  const initialFingerprint = sha256(initialBody);
  const initialCall = await requestCloudflare(endpoint, apiToken, initialBody, fetchImpl, timeoutMs);
  const attempts = [attemptMetadata('initial', initialFingerprint, initialCall)];

  let finalCall = initialCall;
  let finalFingerprint = initialFingerprint;
  let output;
  let repairAttempted = false;
  let repairValidationErrors = [];

  try {
    output = extractStructuredOutput(initialCall.payload, packet.evidencePacket);
  } catch (error) {
    if (!(error instanceof StructuredOutputValidationError) || MAX_REPAIR_ATTEMPTS < 1) throw error;
    repairAttempted = true;
    repairValidationErrors = [...error.validationErrors];
    const repairBody = createRepairRequestBody(packet, error.candidateOutput, error.validationErrors, settings);
    const repairFingerprint = sha256(repairBody);
    const repairCall = await requestCloudflare(endpoint, apiToken, repairBody, fetchImpl, timeoutMs);
    attempts.push(attemptMetadata('repair', repairFingerprint, repairCall));
    output = extractStructuredOutput(repairCall.payload, packet.evidencePacket);
    finalCall = repairCall;
    finalFingerprint = repairFingerprint;
  }

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
      requestFingerprint: finalFingerprint,
      initialRequestFingerprint: initialFingerprint,
      repairRequestFingerprint: repairAttempted ? finalFingerprint : null
    },
    provider: {
      name: PROVIDER,
      endpoint: ENDPOINT_FAMILY,
      requestedModel: model,
      returnedModel: finalCall.providerPayload?.model ?? null,
      responseId: finalCall.providerPayload?.id ?? null,
      requestId: finalCall.response?.headers?.get?.('x-request-id') ?? finalCall.response?.headers?.get?.('cf-ray') ?? null,
      status: 'completed',
      reasoningControl: 'provider-default',
      temperature,
      seed,
      maxTokens,
      store: false,
      toolsEnabled: false,
      usage: finalCall.providerPayload?.usage ?? null,
      attemptCount: attempts.length,
      repairAttempted,
      attempts
    },
    repair: {
      attempted: repairAttempted,
      maxRepairAttempts: MAX_REPAIR_ATTEMPTS,
      initialValidationErrors: repairValidationErrors
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
      evidenceCatalogIdsRequired: true,
      repairUsesExactSameEvidencePacket: true,
      repairReceivesValidationDiagnosticsOnly: true,
      maxRepairAttempts: MAX_REPAIR_ATTEMPTS,
      invalidRepairFailsClosed: true
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
  MAX_REPAIR_ATTEMPTS,
  PROVIDER,
  StructuredOutputValidationError,
  createRepairRequestBody,
  createRequestBody,
  endpointForAccount,
  extractStructuredOutput,
  hasSafeOfficialContextSemantics,
  parsePacket,
  requestCloudflare,
  runInference,
  sha256,
  unwrapPayload
};
