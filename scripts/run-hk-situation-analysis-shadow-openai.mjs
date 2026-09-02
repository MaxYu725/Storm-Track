import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const promptContract = require('../analysis/hk-situation-analysis-prompt.js');

const INFERENCE_SCHEMA_VERSION = 'hk-situation-analysis-shadow-inference/v0.1';
const PROVIDER = 'openai-responses';
const ENDPOINT = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-5.6-terra';
const DEFAULT_REASONING_EFFORT = 'medium';
const ALLOWED_REASONING_EFFORTS = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max']);

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
  if (!/^[0-9a-f]{64}$/.test(String(value.packetFingerprint || ''))) {
    throw new Error('Packet fingerprint is missing or invalid');
  }
  if (value?.semantics?.shadowOnly !== true
      || value?.semantics?.affectsForecast !== false
      || value?.semantics?.affectsEvaluator !== false
      || !hasSafeOfficialContextSemantics(value?.semantics)) {
    throw new Error('Packet does not satisfy shadow/no-future-outcome semantics');
  }
  if (value?.evidencePacket?.schemaVersion !== 'hk-situation-analysis-shadow-input/v0.1') {
    throw new Error('Evidence packet schema mismatch');
  }
  if (value?.evidencePacket?.semantics?.caseSpecificRulesForbidden !== true
      || value?.evidencePacket?.semantics?.noTruthFeedback !== true) {
    throw new Error('Evidence packet anti-overfitting semantics missing');
  }
  return value;
}

function createRequestBody(packet, {
  model = DEFAULT_MODEL,
  reasoningEffort = DEFAULT_REASONING_EFFORT,
  maxOutputTokens = 5000
} = {}) {
  parsePacket(packet);
  if (!model || typeof model !== 'string') throw new Error('Model must be a non-empty string');
  if (!ALLOWED_REASONING_EFFORTS.has(reasoningEffort)) throw new Error(`Unsupported reasoning effort: ${reasoningEffort}`);

  return {
    model,
    store: false,
    reasoning: { effort: reasoningEffort },
    max_output_tokens: maxOutputTokens,
    metadata: {
      packet_fingerprint: packet.packetFingerprint,
      prompt_version: promptContract.VERSION
    },
    input: [
      { role: 'system', content: promptContract.buildInstructions() },
      { role: 'user', content: JSON.stringify(packet.evidencePacket) }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'hk_situation_analysis_shadow',
        strict: true,
        schema: promptContract.OUTPUT_JSON_SCHEMA
      }
    }
  };
}

function extractStructuredOutput(response, evidencePacket = null) {
  if (!response || typeof response !== 'object') throw new Error('OpenAI response is not an object');
  if (response.status && response.status !== 'completed') {
    const reason = response?.incomplete_details?.reason || response.status;
    throw new Error(`OpenAI response not completed: ${reason}`);
  }

  const output = Array.isArray(response.output) ? response.output : [];
  let text = null;
  for (const item of output) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content?.type === 'refusal') throw new Error(`OpenAI refusal: ${content.refusal || 'unspecified'}`);
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        text = content.text;
        break;
      }
    }
    if (text != null) break;
  }
  if (text == null && typeof response.output_text === 'string') text = response.output_text;
  if (!text) throw new Error('OpenAI response contained no output_text');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`OpenAI structured output is not JSON: ${error.message}`);
  }
  const validation = evidencePacket
    ? promptContract.validateOutputAgainstEvidence(parsed, evidencePacket)
    : promptContract.validateOutput(parsed);
  if (!validation.valid) throw new Error(`OpenAI structured output failed local validation: ${validation.errors.join('; ')}`);
  return parsed;
}

async function runInference(packet, {
  apiKey,
  model = DEFAULT_MODEL,
  reasoningEffort = DEFAULT_REASONING_EFFORT,
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  timeoutMs = 120000
} = {}) {
  parsePacket(packet);
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for inference');
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation unavailable');

  const requestBody = createRequestBody(packet, { model, reasoningEffort });
  const requestFingerprint = sha256(requestBody);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'user-agent': 'storm-track-ai-situation-shadow/0.2'
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  let payload;
  const responseText = await response.text();
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new Error(`OpenAI HTTP ${response.status}: non-JSON response`);
  }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
    throw new Error(`OpenAI request failed: ${message}`);
  }

  const output = extractStructuredOutput(payload, packet.evidencePacket);
  const returnedModel = payload.model ?? null;
  return {
    schemaVersion: INFERENCE_SCHEMA_VERSION,
    createdAt: now(),
    input: {
      packetFingerprint: packet.packetFingerprint,
      packetSchemaVersion: packet.schemaVersion,
      evidencePacketSchemaVersion: packet.evidencePacket.schemaVersion,
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
      endpoint: ENDPOINT,
      requestedModel: model,
      returnedModel,
      responseId: payload.id ?? null,
      requestId: response.headers?.get?.('x-request-id') ?? null,
      status: payload.status ?? 'completed',
      reasoningEffort,
      store: false,
      toolsEnabled: false,
      usage: payload.usage ?? null
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
      exactEvidenceReferencesRequired: true
    }
  };
}

async function main(argv = process.argv.slice(2)) {
  const [packetPath, modelArg, reasoningArg] = argv;
  if (!packetPath) {
    throw new Error('Usage: node scripts/run-hk-situation-analysis-shadow-openai.mjs <packet.json> [model] [reasoning-effort]');
  }
  const packet = parsePacket(JSON.parse(readFileSync(resolve(packetPath), 'utf8')));
  const result = await runInference(packet, {
    apiKey: process.env.OPENAI_API_KEY,
    model: modelArg || process.env.HK_SITUATION_AI_MODEL || DEFAULT_MODEL,
    reasoningEffort: reasoningArg || process.env.HK_SITUATION_AI_REASONING_EFFORT || DEFAULT_REASONING_EFFORT
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
const modulePath = resolve(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) {
  main().catch(error => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

export {
  ALLOWED_REASONING_EFFORTS,
  DEFAULT_MODEL,
  DEFAULT_REASONING_EFFORT,
  ENDPOINT,
  INFERENCE_SCHEMA_VERSION,
  PROVIDER,
  createRequestBody,
  extractStructuredOutput,
  hasSafeOfficialContextSemantics,
  parsePacket,
  runInference,
  sha256
};
