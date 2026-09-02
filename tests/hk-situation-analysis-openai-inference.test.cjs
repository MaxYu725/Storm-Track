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
      interpretation: 'A later re-approach is visible in the deterministic lifecycle evidence.',
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
  const t3 = { likelihood: 'possible', riskIndex: 0.5 };
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
        deterministicForecasts: {
          v1: { signals: { T1: {}, T3: t3, T8: {} } },
          v2Shadow: { signals: { T1: {}, T3: { ...t3 }, T8: {} } }
        },
        geometry: { representativeMinimum: null },
        lifecycleAnalyzers: { directDepart: { confidence: 0.7 }, reApproach: { confidence: 0.5 } },
        localWind: { provided: true, affectsForecast: false, summary: { meanStrongStationCount: 0 } }
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
  const runner = await import('../scripts/run-hk-situation-analysis-shadow-openai.mjs');

  assert.equal(prompt.VERSION, 'hk-situation-analysis-prompt/v0.2');
  assert.equal(prompt.OUTPUT_SCHEMA_VERSION, 'hk-situation-analysis-shadow-output/v0.1');
  assert.equal(prompt.OUTPUT_JSON_SCHEMA.additionalProperties, false);
  assert.equal(prompt.OUTPUT_JSON_SCHEMA.properties.signalInterpretation.additionalProperties, false);
  assert.match(prompt.buildInstructions(), /closed-book/);
  assert.match(prompt.buildInstructions(), /must never select a special rule/);
  assert.match(prompt.buildInstructions(), /single exposed-station/);
  assert.match(prompt.buildInstructions(), /remote for a system/);
  assert.match(prompt.buildInstructions(), /Cyclone representative or maximum wind is storm intensity/);

  const packet = validPacket();
  const validation = prompt.validateOutputAgainstEvidence(validOutput(), packet.evidencePacket);
  assert.deepEqual(validation, { valid: true, errors: [] });
  const invalid = validOutput();
  invalid.supportingEvidence[0].ref = '$.truth.T3';
  assert.equal(prompt.validateOutput(invalid).valid, false);
  const invalidExact = validOutput();
  invalidExact.supportingEvidence[0].ref = '$.evidence.threatTimeline[?(@.label=="+1h")]';
  assert.equal(prompt.validateOutputAgainstEvidence(invalidExact, packet.evidencePacket).valid, false);

  const request = runner.createRequestBody(packet, { model: 'gpt-5.6-terra', reasoningEffort: 'medium' });
  assert.equal(request.model, 'gpt-5.6-terra');
  assert.equal(request.store, false);
  assert.deepEqual(request.reasoning, { effort: 'medium' });
  assert.equal(Object.prototype.hasOwnProperty.call(request, 'tools'), false);
  assert.equal(request.text.format.type, 'json_schema');
  assert.equal(request.text.format.strict, true);
  assert.equal(request.text.format.name, 'hk_situation_analysis_shadow');
  assert.equal(request.metadata.packet_fingerprint, packet.packetFingerprint);
  assert.equal(request.metadata.prompt_version, prompt.VERSION);
  assert.equal(request.input[0].role, 'system');
  assert.equal(request.input[1].role, 'user');
  assert.deepEqual(JSON.parse(request.input[1].content), packet.evidencePacket);

  const structured = validOutput();
  const providerPayload = {
    id: 'resp_test',
    status: 'completed',
    model: 'gpt-5.6-terra-2026-08-01',
    output: [{
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: JSON.stringify(structured) }]
    }],
    usage: { input_tokens: 1000, output_tokens: 500, total_tokens: 1500 }
  };

  let capturedRequest = null;
  const mockFetch = async (url, options) => {
    capturedRequest = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      headers: { get: key => key.toLowerCase() === 'x-request-id' ? 'req_test' : null },
      text: async () => JSON.stringify(providerPayload)
    };
  };

  const result = await runner.runInference(packet, {
    apiKey: 'test-key-not-real',
    model: 'gpt-5.6-terra',
    reasoningEffort: 'medium',
    fetchImpl: mockFetch,
    now: () => '2026-09-02T04:00:00.000Z'
  });

  assert.equal(capturedRequest.url, 'https://api.openai.com/v1/responses');
  assert.equal(capturedRequest.body.store, false);
  assert.equal(capturedRequest.body.model, 'gpt-5.6-terra');
  assert.equal(capturedRequest.options.headers.authorization, 'Bearer test-key-not-real');
  assert.equal(result.schemaVersion, 'hk-situation-analysis-shadow-inference/v0.1');
  assert.equal(result.input.packetFingerprint, packet.packetFingerprint);
  assert.equal(result.prompt.version, prompt.VERSION);
  assert.match(result.prompt.requestFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(result.provider.name, 'openai-responses');
  assert.equal(result.provider.requestedModel, 'gpt-5.6-terra');
  assert.equal(result.provider.returnedModel, 'gpt-5.6-terra-2026-08-01');
  assert.equal(result.provider.responseId, 'resp_test');
  assert.equal(result.provider.requestId, 'req_test');
  assert.equal(result.provider.store, false);
  assert.equal(result.provider.toolsEnabled, false);
  assert.deepEqual(result.output, structured);
  assert.equal(result.semantics.affectsForecast, false);
  assert.equal(result.semantics.affectsEvaluator, false);
  assert.equal(result.semantics.noExternalTools, true);
  assert.equal(result.semantics.inputPacketIsSoleMeteorologicalEvidence, true);
  assert.equal(result.semantics.exactEvidenceReferencesRequired, true);

  assert.deepEqual(runner.extractStructuredOutput(providerPayload, packet.evidencePacket), structured);

  const invalidPayload = JSON.parse(JSON.stringify(providerPayload));
  const invalidStructured = validOutput();
  invalidStructured.supportingEvidence[0].ref = '$.evidence.missing.path';
  invalidPayload.output[0].content[0].text = JSON.stringify(invalidStructured);
  assert.throws(() => runner.extractStructuredOutput(invalidPayload, packet.evidencePacket), /does not resolve exactly/);

  assert.throws(
    () => runner.extractStructuredOutput({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'refused' }] }]
    }),
    /OpenAI refusal/
  );
  assert.throws(
    () => runner.extractStructuredOutput({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }),
    /max_output_tokens/
  );

  await assert.rejects(
    runner.runInference(packet, { apiKey: null, fetchImpl: mockFetch }),
    /OPENAI_API_KEY is required/
  );

  console.log('hk-situation-analysis-openai-inference tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
