(function attachHkSignalEvaluator(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HkSignalEvaluator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHkSignalEvaluator() {
  'use strict';

  const VERSION = 'hk-signal-evaluator/v2';
  const RUBRIC_VERSION = 'hk-signal-validation-rubric/v1';
  const EVENT_POLICY_VERSION = 'hk-signal-event-policy/v1';
  const CHECKPOINT_HOURS = Object.freeze([48, 24, 12, 6, 3]);
  const SIGNALS = Object.freeze(['T1', 'T3', 'T8']);
  const HKO_CASE_ACTIVITY_HOURS = 72;
  const POSITIVE_STATES = new Set(['possible', 'likely']);

  const RUBRIC = Object.freeze({
    version: RUBRIC_VERSION,
    checkpointHours: CHECKPOINT_HOURS,
    windowTiming: Object.freeze({ A: 'inside-window', B: '<=3h-from-boundary', C: '<=6h-from-boundary', D: '>6h-or-no-window' }),
    stableLead: Object.freeze({ A: '>=12h', B: '6-<12h', C: '3-<6h', D: '<3h-or-never-stable' }),
    stability: Object.freeze({ A: '0-reversal-flips', B: '1-reversal-flip', C: '2-reversal-flips', D: '>=3-reversal-flips' }),
    windowPrecision: Object.freeze({ A: '<=18h', B: '>18-<=24h', C: '>24-<=36h', D: '>36h-or-no-window' })
  });

  const EVENT_POLICY = Object.freeze({
    version: EVENT_POLICY_VERSION,
    T1: 'first ISSUE of TC1 only; later downgrade to TC1 is not a T1 issue event',
    T3: 'first upward transition to TC3 from a lower signal; downgrade from TC8/9/10 is excluded',
    T8: 'first upward transition to any TC8NE/TC8SE/TC8SW/TC8NW from below T8; direction changes and downgrades are excluded',
    skippedLowerSignal: 'if a higher signal is issued before an eligible lower-signal event, the lower signal is recorded as not-issued/skipped and is not scored'
  });

  function parseTimeMs(value) {
    const ms = Date.parse(value || '');
    return Number.isFinite(ms) ? ms : NaN;
  }

  function hoursBetween(later, earlier) {
    const a = typeof later === 'number' ? later : parseTimeMs(later);
    const b = typeof earlier === 'number' ? earlier : parseTimeMs(earlier);
    return Number.isFinite(a) && Number.isFinite(b) ? (a - b) / 3600000 : null;
  }

  function normalizeText(value) {
    return String(value || '').toUpperCase().replace(/[\s()（）._\-/,:;，。；：'"「」『』]+/g, '');
  }

  function normalizeSignal(signal) {
    const value = String(signal || '').toUpperCase();
    if (!SIGNALS.includes(value)) throw new Error(`unsupported signal: ${signal}`);
    return value;
  }

  function isPositiveLikelihood(value) {
    return POSITIVE_STATES.has(String(value || '').toLowerCase());
  }

  function signalPrediction(observation, signal = 'T1') {
    const key = normalizeSignal(signal);
    const item = observation?.analysis?.basicForecast?.signals?.[key] || null;
    if (!item) {
      return {
        signal: key,
        likelihood: null,
        window: null,
        riskIndex: null,
        confidenceIndex: null,
        persistenceHours: null
      };
    }
    const window = item.estimatedWindow && typeof item.estimatedWindow === 'object'
      ? { start: item.estimatedWindow.start || null, end: item.estimatedWindow.end || null }
      : null;
    return {
      signal: key,
      likelihood: String(item.likelihood || '').toLowerCase() || null,
      window,
      riskIndex: Number.isFinite(Number(item.riskIndex)) ? Number(item.riskIndex) : null,
      confidenceIndex: Number.isFinite(Number(item.confidenceIndex)) ? Number(item.confidenceIndex) : null,
      persistenceHours: Number.isFinite(Number(item.persistenceHours)) ? Number(item.persistenceHours) : null
    };
  }

  function t1Prediction(observation) {
    return signalPrediction(observation, 'T1');
  }

  function gradeWindow(eventTime, window) {
    const eventMs = parseTimeMs(eventTime);
    const startMs = parseTimeMs(window?.start);
    const endMs = parseTimeMs(window?.end);
    if (![eventMs, startMs, endMs].every(Number.isFinite) || endMs < startMs) {
      return { grade: 'D', hit: false, boundaryErrorHours: null, widthHours: null };
    }
    const widthHours = (endMs - startMs) / 3600000;
    if (eventMs >= startMs && eventMs <= endMs) {
      return { grade: 'A', hit: true, boundaryErrorHours: 0, widthHours };
    }
    const boundaryErrorHours = eventMs < startMs
      ? (startMs - eventMs) / 3600000
      : (eventMs - endMs) / 3600000;
    const grade = boundaryErrorHours <= 3 ? 'B' : boundaryErrorHours <= 6 ? 'C' : 'D';
    return { grade, hit: false, boundaryErrorHours, widthHours };
  }

  function gradeStableLead(hours) {
    if (!Number.isFinite(hours)) return 'D';
    if (hours >= 12) return 'A';
    if (hours >= 6) return 'B';
    if (hours >= 3) return 'C';
    return 'D';
  }

  function gradeStability(flips) {
    if (!Number.isFinite(flips) || flips <= 0) return 'A';
    if (flips === 1) return 'B';
    if (flips === 2) return 'C';
    return 'D';
  }

  function gradeWindowPrecision(widthHours) {
    if (!Number.isFinite(widthHours)) return 'D';
    if (widthHours <= 18) return 'A';
    if (widthHours <= 24) return 'B';
    if (widthHours <= 36) return 'C';
    return 'D';
  }

  function sortTimeline(timeline) {
    return [...(timeline || [])]
      .filter(row => Number.isFinite(parseTimeMs(row?.capturedAt)))
      .sort((a, b) => parseTimeMs(a.capturedAt) - parseTimeMs(b.capturedAt));
  }

  function latestAtOrBefore(timeline, cutoffMs) {
    let selected = null;
    for (const row of timeline) {
      const time = parseTimeMs(row.capturedAt);
      if (time <= cutoffMs) selected = row;
      else break;
    }
    return selected;
  }

  function firstPositive(timeline, signal) {
    return timeline.find(row => isPositiveLikelihood(signalPrediction(row.observation, signal).likelihood)) || null;
  }

  function firstStablePositive(timeline, signal) {
    for (let index = 0; index < timeline.length; index += 1) {
      if (!isPositiveLikelihood(signalPrediction(timeline[index].observation, signal).likelihood)) continue;
      const stable = timeline.slice(index).every(row => isPositiveLikelihood(signalPrediction(row.observation, signal).likelihood));
      if (stable) return timeline[index];
    }
    return null;
  }

  function reversalFlips(timeline, signal) {
    const firstIndex = timeline.findIndex(row => isPositiveLikelihood(signalPrediction(row.observation, signal).likelihood));
    if (firstIndex < 0) return 0;
    let flips = 0;
    let previousPositive = true;
    for (let index = firstIndex + 1; index < timeline.length; index += 1) {
      const positive = isPositiveLikelihood(signalPrediction(timeline[index].observation, signal).likelihood);
      if (positive !== previousPositive) flips += 1;
      previousPositive = positive;
    }
    return flips;
  }

  function checkpointResult(timeline, eventMs, checkpointHours, signal) {
    const key = normalizeSignal(signal);
    const targetMs = eventMs - checkpointHours * 3600000;
    const selected = latestAtOrBefore(timeline, targetMs);
    if (!selected) {
      return {
        signal: key,
        checkpointHours,
        targetTime: new Date(targetMs).toISOString(),
        status: 'no-snapshot',
        snapshot: null,
        scoring: null
      };
    }
    const prediction = signalPrediction(selected.observation, key);
    const scoring = gradeWindow(new Date(eventMs).toISOString(), prediction.window);
    return {
      signal: key,
      checkpointHours,
      targetTime: new Date(targetMs).toISOString(),
      status: 'scored',
      snapshot: {
        capturedAt: selected.capturedAt,
        captureFingerprint: selected.captureFingerprint || null,
        rawGroupKey: selected.rawGroupKey || selected.observation?.group?.key || null,
        likelihood: prediction.likelihood,
        riskIndex: prediction.riskIndex,
        confidenceIndex: prediction.confidenceIndex,
        persistenceHours: prediction.persistenceHours,
        estimatedWindow: prediction.window,
        disagreement: selected.observation?.analysis?.threatAssessment?.analyzers?.agencyDisagreement?.confidence ?? null,
        engineVersions: selected.observation?.engineVersions || null
      },
      scoring
    };
  }

  function eventText(event) {
    const truth = event?.currentTruth || {};
    const parts = [truth.type];
    for (const detail of truth.details || []) {
      for (const content of detail?.contents || []) parts.push(content);
    }
    return normalizeText(parts.filter(Boolean).join(' '));
  }

  function candidateCasesForEvent(event, caseIndex) {
    const eventMs = parseTimeMs(event?.eventTime);
    if (!Number.isFinite(eventMs)) return [];
    const latestByCase = new Map();
    const lowerBound = eventMs - HKO_CASE_ACTIVITY_HOURS * 3600000;
    const upperBound = eventMs + 15 * 60000;
    for (const row of caseIndex || []) {
      const capturedMs = parseTimeMs(row?.capturedAt);
      if (!Number.isFinite(capturedMs) || capturedMs < lowerBound || capturedMs > upperBound) continue;
      if (!(row?.sourceTokens || []).some(token => String(token).startsWith('HKO:'))) continue;
      const previous = latestByCase.get(row.caseId);
      if (!previous || parseTimeMs(previous.capturedAt) < capturedMs) latestByCase.set(row.caseId, row);
    }
    return [...latestByCase.values()].sort((a, b) => parseTimeMs(b.capturedAt) - parseTimeMs(a.capturedAt));
  }

  function attributeCase(event, caseIndex) {
    const candidates = candidateCasesForEvent(event, caseIndex);
    if (candidates.length === 1) {
      return { status: 'attributed', caseId: candidates[0].caseId, reason: 'unique-active-hko-case', candidates: candidates.map(row => row.caseId) };
    }
    if (!candidates.length) return { status: 'unresolved', caseId: null, reason: 'no-active-hko-case', candidates: [] };

    const text = eventText(event);
    const matching = candidates.filter(row => (row.specificNames || []).some(name => {
      const normalized = normalizeText(name);
      return normalized && text.includes(normalized);
    }));
    if (matching.length === 1) {
      return { status: 'attributed', caseId: matching[0].caseId, reason: 'hko-warning-name-match', candidates: candidates.map(row => row.caseId) };
    }
    return { status: 'ambiguous', caseId: null, reason: 'multiple-active-hko-cases', candidates: candidates.map(row => row.caseId) };
  }

  function previousLevel(event) {
    const value = Number(event?.previousTruth?.level);
    return Number.isFinite(value) ? value : 0;
  }

  function currentLevel(event) {
    const value = Number(event?.currentTruth?.level);
    return Number.isFinite(value) ? value : null;
  }

  function isInitialSignalEvent(event, signal) {
    const key = normalizeSignal(signal);
    const code = String(event?.currentTruth?.code || '').toUpperCase();
    const type = String(event?.eventType || '').toUpperCase();
    const level = currentLevel(event);
    const prior = previousLevel(event);
    if (key === 'T1') {
      return type === 'ISSUE' && code === 'TC1' && level === 1;
    }
    if (key === 'T3') {
      return (type === 'ISSUE' || type === 'SIGNAL_CHANGE')
        && code === 'TC3'
        && level === 3
        && prior < 3;
    }
    return (type === 'ISSUE' || type === 'SIGNAL_CHANGE')
      && /^TC8(?:NE|SE|SW|NW)$/.test(code)
      && level === 8
      && prior < 8;
  }

  function evaluateSignalEvent({ event, timeline, caseId, attribution, signal }) {
    const key = normalizeSignal(signal);
    const eventMs = parseTimeMs(event?.eventTime);
    if (!Number.isFinite(eventMs)) throw new Error(`${key} event must have a valid eventTime`);
    const preEvent = sortTimeline(timeline).filter(row => parseTimeMs(row.capturedAt) < eventMs);
    const checkpoints = CHECKPOINT_HOURS.map(hours => checkpointResult(preEvent, eventMs, hours, key));
    const first = firstPositive(preEvent, key);
    const stable = firstStablePositive(preEvent, key);
    const flips = reversalFlips(preEvent, key);
    const final = preEvent.at(-1) || null;
    const finalPrediction = final ? signalPrediction(final.observation, key) : signalPrediction(null, key);
    const finalWindowScore = gradeWindow(event.eventTime, finalPrediction.window);
    const stableLeadHours = stable ? hoursBetween(eventMs, parseTimeMs(stable.capturedAt)) : null;
    const firstLeadHours = first ? hoursBetween(eventMs, parseTimeMs(first.capturedAt)) : null;

    return {
      schemaVersion: VERSION,
      rubricVersion: RUBRIC_VERSION,
      eventPolicyVersion: EVENT_POLICY_VERSION,
      status: 'evaluated',
      signal: key,
      caseId,
      attribution,
      truth: {
        signal: key,
        eventType: event.eventType,
        eventTime: event.eventTime,
        timeSource: event.timeSource,
        code: event?.currentTruth?.code || null,
        level: event?.currentTruth?.level ?? null,
        issueTime: event?.currentTruth?.issueTime || null,
        updateTime: event?.currentTruth?.updateTime || null,
        truthFingerprint: event.truthFingerprint || null
      },
      evidence: {
        trustedRecorderSchema: 'beta-prospective-recorder/v2',
        preEventSnapshotCount: preEvent.length,
        firstSnapshotAt: preEvent[0]?.capturedAt || null,
        lastSnapshotAt: final?.capturedAt || null
      },
      checkpoints,
      lifecycle: {
        firstPossibleAt: first?.capturedAt || null,
        firstPossibleLeadHours: firstLeadHours,
        firstStablePossibleAt: stable?.capturedAt || null,
        stableLeadHours,
        reversalFlips: flips
      },
      finalPreEvent: final ? {
        capturedAt: final.capturedAt,
        captureFingerprint: final.captureFingerprint || null,
        likelihood: finalPrediction.likelihood,
        riskIndex: finalPrediction.riskIndex,
        confidenceIndex: finalPrediction.confidenceIndex,
        persistenceHours: finalPrediction.persistenceHours,
        estimatedWindow: finalPrediction.window,
        windowScoring: finalWindowScore
      } : null,
      grades: {
        stableLead: gradeStableLead(stableLeadHours),
        stability: gradeStability(flips),
        finalWindowTiming: finalWindowScore.grade,
        finalWindowPrecision: gradeWindowPrecision(finalWindowScore.widthHours)
      },
      rubric: RUBRIC,
      eventPolicy: EVENT_POLICY
    };
  }

  function evaluateTc1Event(args) {
    return evaluateSignalEvent({ ...args, signal: 'T1' });
  }

  function skippedLowerSignal({ signal, higherSignalEvaluation }) {
    const key = normalizeSignal(signal);
    if (!higherSignalEvaluation?.caseId || !higherSignalEvaluation?.truth?.eventTime) {
      throw new Error('higher-signal evaluation must be attributed before creating skipped marker');
    }
    return {
      schemaVersion: VERSION,
      rubricVersion: RUBRIC_VERSION,
      eventPolicyVersion: EVENT_POLICY_VERSION,
      status: 'not-issued',
      signal: key,
      caseId: higherSignalEvaluation.caseId,
      attribution: higherSignalEvaluation.attribution,
      truth: {
        signal: key,
        eventType: 'SKIPPED_BY_HIGHER_SIGNAL',
        eventTime: higherSignalEvaluation.truth.eventTime,
        timeSource: higherSignalEvaluation.truth.timeSource,
        code: null,
        level: key === 'T1' ? 1 : key === 'T3' ? 3 : 8,
        issueTime: null,
        truthFingerprint: higherSignalEvaluation.truth.truthFingerprint || null,
        skippedBySignal: higherSignalEvaluation.signal,
        skippedByCode: higherSignalEvaluation.truth.code || null
      },
      reason: 'higher-signal-issued-without-eligible-lower-signal-event',
      checkpoints: [],
      lifecycle: null,
      finalPreEvent: null,
      grades: null,
      rubric: RUBRIC,
      eventPolicy: EVENT_POLICY
    };
  }

  function isInitialTc1Issue(event) {
    return isInitialSignalEvent(event, 'T1');
  }

  return Object.freeze({
    VERSION,
    RUBRIC_VERSION,
    EVENT_POLICY_VERSION,
    CHECKPOINT_HOURS,
    SIGNALS,
    RUBRIC,
    EVENT_POLICY,
    normalizeText,
    normalizeSignal,
    isPositiveLikelihood,
    signalPrediction,
    t1Prediction,
    gradeWindow,
    gradeStableLead,
    gradeStability,
    gradeWindowPrecision,
    candidateCasesForEvent,
    attributeCase,
    isInitialSignalEvent,
    evaluateSignalEvent,
    evaluateTc1Event,
    skippedLowerSignal,
    isInitialTc1Issue
  });
});
