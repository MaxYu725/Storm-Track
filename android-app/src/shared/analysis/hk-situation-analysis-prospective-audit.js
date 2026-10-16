(function attachStormHkSituationAnalysisProspectiveAudit(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StormHkSituationAnalysisProspectiveAudit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormHkSituationAnalysisProspectiveAudit() {
  'use strict';

  const VERSION = 'hk-situation-analysis-prospective-audit/v0.1';
  const ACTION_QUESTIONS = new Set(['maintenance', 'cancellation', 'escalation']);

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function closeEnough(left, right) {
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    return Math.abs(left - right) <= Math.max(0.005, Math.abs(right) * 0.05);
  }

  function extractNamedMetric(text, label) {
    const source = String(text || '');
    const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(`${escaped}[^0-9]{0,20}([0-9]+(?:\\.[0-9]+)?)`, 'i'));
    return match ? Number(match[1]) : null;
  }

  function officialContextPresent(packet) {
    return isObject(packet?.evidencePacket?.evidence?.officialHko?.signalStatement);
  }

  function auditThreatIndex(output, packet, flags) {
    const text = output?.currentThreatInterpretation;
    const stated = extractNamedMetric(text, 'threat index');
    if (!Number.isFinite(stated)) return;
    const v1 = packet?.evidencePacket?.evidence?.deterministicForecasts?.v1?.impact?.threatIndex;
    const v2 = packet?.evidencePacket?.evidence?.deterministicForecasts?.v2Shadow?.impact?.threatIndex;
    const candidates = [v1, v2].filter(Number.isFinite);
    if (candidates.length && !candidates.some(value => closeEnough(stated, value))) {
      flags.push({
        code: 'CURRENT_THREAT_METRIC_MISMATCH',
        severity: 'review',
        field: 'currentThreatInterpretation',
        detail: `Stated threat index ${stated} does not match deterministic impact threat index values in the supplied packet.`
      });
    }
  }

  function auditRemoteFuturePhase(output, packet, flags) {
    const impact = packet?.evidencePacket?.evidence?.deterministicForecasts?.v1?.impact;
    if (output?.currentPhase !== 'remote' || impact?.expected !== false || impact?.likelihood !== 'unlikely' || officialContextPresent(packet)) return;
    const approaching = Array.isArray(output?.futurePhases)
      ? output.futurePhases.find(row => row?.phase === 'approaching')
      : null;
    if (approaching) {
      flags.push({
        code: 'FUTURE_OPERATIONAL_PHASE_REVIEW',
        severity: 'review',
        field: 'futurePhases',
        detail: 'A remote, unlikely, not-expected case introduces a future approaching phase. Review whether this is operational lifecycle relevance or geometry-only motion.'
      });
    }
  }

  function auditNullTimingCausality(output, packet, flags) {
    const v1Signals = packet?.evidencePacket?.evidence?.deterministicForecasts?.v1?.signals || {};
    for (const code of ['T1', 'T3', 'T8']) {
      const signalOutput = output?.signalInterpretation?.[code];
      const deterministic = v1Signals?.[code];
      if (!signalOutput || !deterministic || deterministic.estimatedWindow != null || !ACTION_QUESTIONS.has(signalOutput.nextQuestion)) continue;
      const text = String(signalOutput.interpretation || '');
      const mentionsMissingTiming = /(?:no estimated window|null timing|no timing|estimated window.{0,12}(?:none|null|absent))/i.test(text);
      const impliesAction = /(?:indicat|therefore|thus|support|maintain|cancel|escalat|should be)/i.test(text);
      if (mentionsMissingTiming && impliesAction) {
        flags.push({
          code: 'NULL_TIMING_ACTION_CAUSALITY_REVIEW',
          severity: 'review',
          field: `signalInterpretation.${code}.interpretation`,
          detail: 'The interpretation appears to use absence of a deterministic estimated window as support for an operational action. Null timing is absence of guidance, not action evidence.'
        });
      }
    }
  }

  function auditInference(inference, packet, { validator = null, now = () => new Date().toISOString() } = {}) {
    if (!isObject(inference)) throw new Error('Inference must be an object');
    if (!isObject(packet)) throw new Error('Packet must be an object');

    const errors = [];
    const flags = [];
    if (inference?.input?.packetFingerprint !== packet?.packetFingerprint) {
      errors.push('inference input packet fingerprint does not match supplied packet');
    }
    if (inference?.semantics?.shadowOnly !== true || inference?.semantics?.affectsForecast !== false || inference?.semantics?.affectsEvaluator !== false) {
      errors.push('inference shadow isolation semantics are invalid');
    }

    let validatorResult = null;
    if (typeof validator === 'function') {
      validatorResult = validator(inference.output, packet.evidencePacket);
      if (!validatorResult?.valid) errors.push(...(validatorResult?.errors || ['prompt/evidence validator failed']));
    }

    auditThreatIndex(inference.output, packet, flags);
    auditRemoteFuturePhase(inference.output, packet, flags);
    auditNullTimingCausality(inference.output, packet, flags);

    const status = errors.length ? 'fail' : (flags.length ? 'review' : 'pass');
    return {
      schemaVersion: VERSION,
      createdAt: now(),
      status,
      input: {
        caseId: inference?.input?.caseId ?? packet?.caseId ?? null,
        groupKey: inference?.input?.groupKey ?? packet?.groupKey ?? null,
        packetFingerprint: packet?.packetFingerprint ?? null,
        sourceObservationObservedAt: packet?.sourceObservationObservedAt ?? null,
        inferenceCreatedAt: inference?.createdAt ?? null,
        inferenceRequestFingerprint: inference?.prompt?.requestFingerprint ?? null,
        promptVersion: inference?.prompt?.version ?? null,
        outputSchemaVersion: inference?.prompt?.outputSchemaVersion ?? null,
        provider: inference?.provider?.name ?? null,
        model: inference?.provider?.requestedModel ?? null,
        attemptCount: inference?.provider?.attemptCount ?? null,
        repairAttempted: inference?.provider?.repairAttempted ?? null
      },
      automaticChecks: {
        packetFingerprintMatch: inference?.input?.packetFingerprint === packet?.packetFingerprint,
        shadowIsolation: inference?.semantics?.shadowOnly === true
          && inference?.semantics?.affectsForecast === false
          && inference?.semantics?.affectsEvaluator === false,
        promptEvidenceValidation: validatorResult == null ? null : Boolean(validatorResult.valid)
      },
      errors,
      reviewFlags: flags,
      semantics: {
        prospectiveOnly: true,
        noOutcomeTruthUsed: true,
        affectsForecast: false,
        affectsEvaluator: false,
        doesNotRetunePrompt: true,
        reviewFlagsAreNotAutomaticModelFailures: true
      }
    };
  }

  return Object.freeze({ VERSION, auditInference, closeEnough, extractNamedMetric });
});
