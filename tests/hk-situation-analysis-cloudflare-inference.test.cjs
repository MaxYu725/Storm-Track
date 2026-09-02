const assert = require('node:assert/strict');
const prompt = require('../analysis/hk-situation-analysis-prompt.js');

function validOutput() {
  const signal = {
    nextQuestion: 'reassessment',
    assessment: 'mixed',
    interpretation: 'Evidence is mixed and requires reassessment.',
    evidenceRefs: ['$.evidence.deterministicForecasts.v1.signals.T3']
  };
  return {
    schemaVersion: 'hk-situation-analysis-shadow-output/v0.1',
    currentPhase: 'departing',
    currentPhaseConfidence: 0.72,
    futurePhases: [{
      phase: 're-approaching',
      earliestTime: '2026-09-04T00:00:00.000Z',
      latestTime: null,
      interpretation: 'A later re-approach is visible in deterministic lifecycle evidence.',
      evidenceRefs: ['$.evidence.lifecycleAnalyzers.reApproach']
    }],
    currentThreatInterpretation: 'The current phase is departing while a later phase remains relevant.',
    nextDecisionWindow: {
      question: 'reassessment',
      earliestTime: null,
      latestTime: null,
      interpretation: 'Timing is not sufficiently constrained by the packet.',
      evidenceRefs: ['$.evidence.deterministicForecasts.v2Shadow.signals.T3']
    },
    signalInterpretation: { T1: { ...signal }, T3: { ...signal }, T8: { ...signal } },
    supportingEvidence: [{
      ref: '$.evidence.lifecycleAnalyzers.directDepart',
      finding: 'Departure evidence supports the current phase.'
    }],
    contradictingEvidence: [{
      ref: '$.evidence.lifecycleAnalyzers.reApproach',
      finding: 'A later re-approach prevents a simple end-of-lifecycle interpretation.'
    }],
    modelSemanticConcerns: [{
      code: 'phase-mixed-closest',
      description: 'A full-horizon closest approach may describe a later phase.',
      evidenceRefs: ['$.evidence.geometry.representativeMinimum']
    }],
    uncertainties: [{
      description: 'Local wind coverage does not determine a territory-wide warning outcome.',
      evidenceRefs: ['$.evidence.localWind.summary']
    }]
  };
}

function validPacket() {
  return {
    schemaVersion: 'hk-situation-analysis-shadow-packet/v0.1',
    packetFingerprint: 'a'.repeat(64),
    caseId: 'STC-2026-JMA-TC9999',
    groupKey: 'TEST',
    sourceObservationObservedAt: '2026-09-02T03:46:44.156Z',
    provenance: {},
    evidencePacket: {
      schemaVersion: 'hk-situation-analysis-shadow-input/v0.1',
      generatedAt: '2026-09-02T03:45:00.000Z',
      mode: 'ai-situation-analysis-shadow-input',
      case: { caseId: 'STC-2026-JMA-TC9999', displayName: 'Test', provenanceOnly: true },
      evidence: {
        deterministicForecasts: { v1: { signals: {} }, v2Shadow: { signals: {} } },
        geometry: { representativeMinimum: null },
        lifecycleAnalyzers: { directDepart: { confidence: 0.7 }, reApproach: { confidence: 0.5 } },
        localWind: { provided: false, affectsForecast: false }
      },
      aiTask: {},
      semantics: {
        shadowOnly: true,
        affectsForecast: false,
        affectsEvaluator: false,
        noForecastMutation: true,
        noTruthFeedback: true,
        caseSpecificRulesForbidden: true
      }
    },
    semantics: {
      shadowOnly: true,
      affectsForecast: false,
      affectsEvaluator: false,
      noTruthCorpusRead: true,
      noFutureLocalWindJoin: true,
      caseSpecificRulesForbidden: true
    }
  };
}

(async () => {
  const runner = await import('../scripts/run-hk-situation-analysis-shadow-cloudflare.mjs');
  const packet = validPacket();

  assert.equal(runner.DEFAULT_MODEL, '@cf/openai/gpt-oss-120b');
  assert.equal(runner.PROVIDER, 'cloudflare-workers-ai-chat-completions');
  assert.equal(
    runner.endpointForAccount('account_123'),
    'https://api.cloudflare.com/client/v4/accounts/account_123/ai/v1/chat/completions'
  );
  assert.throws(() => runner.endpointForAccount(''), /account ID is required/);

  const request = runner.createRequestBody(packet, { model: '@cf/openai/gpt-oss-120b' });
  assert.equal(request.model, '@cf/openai/gpt-oss-120b');
  assert.equal(request.messages[0].role, 'system');
  assert.equal(request.messages[1].role, 'user');
  assert.deepEqual(JSON.parse(request.messages[1].content), packet.evidencePacket);
  assert.equal(request.response_format.type, 'json_schema');
  assert.deepEqual(request.response_format.json_schema, prompt.OUTPUT_JSON_SCHEMA);
  assert.equal(request.stream, false);
  assert.equal(Object.prototype.hasOwnProperty.call(request, 'tools'), false);
  assert.equal(request.temperature, 0.2);
  assert.equal(request.seed, 725);

  const structured = validOutput();
  const providerPayload = {
    id: 'chatcmpl_cf_test',
    model: '@cf/openai/gpt-oss-120b',
    choices: [{
      index: 0,
      finish_reason: 'stop',
      message: { role: 'assistant', content: JSON.stringify(structured) }
    }],
    usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 }
  };

  let capturedRequest = null;
  const mockFetch = async (url, options) => {
    capturedRequest = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      headers: { get: key => key.toLowerCase() === 'cf-ray' ? 'ray-test' : null },
      text: async () => JSON.stringify(providerPayload)
    };
  };

  const result = await runner.runInference(packet, {
    accountId: 'account_123',
    apiToken: 'test-token-not-real',
    model: '@cf/openai/gpt-oss-120b',
    fetchImpl: mockFetch,
    now: () => '2026-09-02T04:00:00.000Z'
  });

  assert.equal(
    capturedRequest.url,
    'https://api.cloudflare.com/client/v4/accounts/account_123/ai/v1/chat/completions'
  );
  assert.equal(capturedRequest.options.headers.authorization, 'Bearer test-token-not-real');
  assert.equal(capturedRequest.body.model, '@cf/openai/gpt-oss-120b');
  assert.equal(result.schemaVersion, 'hk-situation-analysis-shadow-inference/v0.1');
  assert.equal(result.input.packetFingerprint, packet.packetFingerprint);
  assert.equal(result.prompt.version, prompt.VERSION);
  assert.match(result.prompt.requestFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(result.provider.name, 'cloudflare-workers-ai-chat-completions');
  assert.equal(result.provider.endpoint, runner.ENDPOINT_FAMILY);
  assert.equal(result.provider.requestedModel, '@cf/openai/gpt-oss-120b');
  assert.equal(result.provider.returnedModel, '@cf/openai/gpt-oss-120b');
  assert.equal(result.provider.responseId, 'chatcmpl_cf_test');
  assert.equal(result.provider.requestId, 'ray-test');
  assert.equal(result.provider.reasoningControl, 'provider-default');
  assert.equal(result.provider.store, false);
  assert.equal(result.provider.toolsEnabled, false);
  assert.deepEqual(result.output, structured);
  assert.equal(result.semantics.affectsForecast, false);
  assert.equal(result.semantics.affectsEvaluator, false);
  assert.equal(result.semantics.noExternalTools, true);
  assert.equal(result.semantics.inputPacketIsSoleMeteorologicalEvidence, true);
  assert.equal(result.semantics.localValidationRequired, true);

  const wrapped = { success: true, result: providerPayload, errors: [], messages: [] };
  assert.deepEqual(runner.extractStructuredOutput(wrapped), structured);

  assert.throws(
    () => runner.extractStructuredOutput({
      choices: [{ finish_reason: 'length', message: { content: JSON.stringify(structured) } }]
    }),
    /did not finish normally/
  );
  assert.throws(
    () => runner.extractStructuredOutput({
      choices: [{ finish_reason: 'stop', message: { content: '{not-json}' } }]
    }),
    /not JSON/
  );

  await assert.rejects(
    runner.runInference(packet, { accountId: null, apiToken: 'x', fetchImpl: mockFetch }),
    /ACCOUNT_ID/
  );
  await assert.rejects(
    runner.runInference(packet, { accountId: 'account_123', apiToken: null, fetchImpl: mockFetch }),
    /API_TOKEN/
  );

  console.log('hk-situation-analysis-cloudflare-inference tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
