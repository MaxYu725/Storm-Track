const assert = require('node:assert/strict');
const audit = require('../analysis/hk-situation-analysis-prospective-audit.js');

function basePacket() {
  return {
    packetFingerprint: 'a'.repeat(64),
    caseId: 'STC-TEST',
    groupKey: 'TEST',
    sourceObservationObservedAt: '2026-09-02T06:00:00.000Z',
    evidencePacket: {
      evidence: {
        deterministicForecasts: {
          v1: {
            impact: { expected: true, likelihood: 'possible', threatIndex: 0.42 },
            signals: {
              T1: { estimatedWindow: null },
              T3: { estimatedWindow: null },
              T8: { estimatedWindow: null }
            }
          },
          v2Shadow: { impact: { expected: true, likelihood: 'possible', threatIndex: 0.42 } }
        },
        officialHko: { signalStatement: { currentSignalCode: 'TC1', currentSignal: '一號戒備信號' } }
      }
    }
  };
}

function baseInference() {
  return {
    createdAt: '2026-09-02T06:01:00.000Z',
    input: { packetFingerprint: 'a'.repeat(64), caseId: 'STC-TEST', groupKey: 'TEST' },
    prompt: {
      version: 'hk-situation-analysis-prompt/v0.5',
      outputSchemaVersion: 'hk-situation-analysis-shadow-output/v0.3',
      requestFingerprint: 'c'.repeat(64)
    },
    provider: { name: 'cloudflare-workers-ai-chat-completions', requestedModel: '@cf/openai/gpt-oss-120b', attemptCount: 1, repairAttempted: false },
    output: {
      currentPhase: 'departing',
      currentThreatInterpretation: 'Threat remains possible with high uncertainty.',
      futurePhases: [],
      signalInterpretation: {
        T1: { nextQuestion: 'maintenance', interpretation: 'Official context supports maintenance.' },
        T3: { nextQuestion: 'reassessment', interpretation: 'Reassess later.' },
        T8: { nextQuestion: 'none', interpretation: 'No action.' }
      }
    },
    semantics: { shadowOnly: true, affectsForecast: false, affectsEvaluator: false }
  };
}

const alwaysValid = () => ({ valid: true, errors: [] });

{
  const result = audit.auditInference(baseInference(), basePacket(), { validator: alwaysValid, now: () => '2026-09-02T07:00:00.000Z' });
  assert.equal(result.status, 'pass');
  assert.equal(result.reviewFlags.length, 0);
  assert.equal(result.semantics.noOutcomeTruthUsed, true);
  assert.equal(result.input.inferenceRequestFingerprint, 'c'.repeat(64));
  assert.equal(result.input.outputSchemaVersion, 'hk-situation-analysis-shadow-output/v0.3');
}

{
  const packet = basePacket();
  const inference = baseInference();
  inference.output.currentThreatInterpretation = 'The threat index is 0.68.';
  const result = audit.auditInference(inference, packet, { validator: alwaysValid });
  assert.equal(result.status, 'review');
  assert.ok(result.reviewFlags.some(flag => flag.code === 'CURRENT_THREAT_METRIC_MISMATCH'));
}

{
  const packet = basePacket();
  const inference = baseInference();
  inference.output.currentThreatInterpretation = 'The threat index is 0.421.';
  const result = audit.auditInference(inference, packet, { validator: alwaysValid });
  assert.ok(!result.reviewFlags.some(flag => flag.code === 'CURRENT_THREAT_METRIC_MISMATCH'));
}

{
  const packet = basePacket();
  packet.evidencePacket.evidence.deterministicForecasts.v1.impact = { expected: false, likelihood: 'unlikely', threatIndex: 0.03 };
  packet.evidencePacket.evidence.officialHko.signalStatement = null;
  const inference = baseInference();
  inference.output.currentPhase = 'remote';
  inference.output.futurePhases = [{ phase: 'approaching', interpretation: 'Distance is decreasing.' }];
  inference.output.signalInterpretation.T1.nextQuestion = 'none';
  const result = audit.auditInference(inference, packet, { validator: alwaysValid });
  assert.ok(result.reviewFlags.some(flag => flag.code === 'FUTURE_OPERATIONAL_PHASE_REVIEW'));
}

{
  const packet = basePacket();
  const inference = baseInference();
  inference.output.signalInterpretation.T1.interpretation = 'No estimated window, indicating the signal should be maintained until further guidance.';
  const result = audit.auditInference(inference, packet, { validator: alwaysValid });
  assert.ok(result.reviewFlags.some(flag => flag.code === 'NULL_TIMING_ACTION_CAUSALITY_REVIEW'));
}

{
  const packet = basePacket();
  const inference = baseInference();
  inference.input.packetFingerprint = 'b'.repeat(64);
  const result = audit.auditInference(inference, packet, { validator: alwaysValid });
  assert.equal(result.status, 'fail');
  assert.ok(result.errors.some(error => /fingerprint/.test(error)));
}

{
  const result = audit.auditInference(baseInference(), basePacket(), { validator: () => ({ valid: false, errors: ['semantic failure'] }) });
  assert.equal(result.status, 'fail');
  assert.ok(result.errors.includes('semantic failure'));
}

console.log('hk-situation-analysis-prospective-audit tests passed');
