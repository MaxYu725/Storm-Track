(function attachHkSignalEvaluator(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HkSignalEvaluator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHkSignalEvaluator() {
  'use strict';

  const VERSION = 'hk-signal-evaluator/v1';
  const RUBRIC_VERSION = 'hk-signal-validation-rubric/v1';
  const CHECKPOINT_HOURS = Object.freeze([48, 24, 12, 6, 3]);
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

  function isPositiveLikelihood(value) {
    return POSITIVE_STATES.has(String(value || '').toLowerCase());
  }

  function t1Prediction(observation) {
    const signal = observation?.analysis?.basicForecast?.signals?.T1 || null;
    if (!signal) return { likelihood: null, window: null };
    const window = signal.estimatedWindow && typeof signal.estimatedWindow === 'object'
      ? { start: signal.estimatedWindow.start || null, end: signal.estimatedWindow.end || null }
      : null;
    return {
      likelihood: String(signal.likelihood || '').toLowerCase() || null,
      window
    };
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

  function firstPositive(timeline) {
    return timeline.find(row => isPositiveLikelihood(t1Prediction(row.observation).likelihood)) || null;
  }

  function firstStablePositive(timeline) {
    for (let index = 0; index < timeline.length; index += 1) {
      if (!isPositiveLikelihood(t1Prediction(timeline[index].observation).likelihood)) continue;
      const stable = timeline.slice(index).every(row => isPositiveLikelihood(t1Prediction(row.observation).likelihood));
      if (stable) return timeline[index];
    }
    return null;
  }

  function reversalFlips(timeline) {
    const firstIndex = timeline.findIndex(row => isPositiveLikelihood(t1Prediction(row.observation).likelihood));
    if (firstIndex < 0) return 0;
    let flips = 0;
    let previousPositive = true;
    for (let index = firstIndex + 1; index < timeline.length; index += 1) {
      const positive = isPositiveLikelihood(t1Prediction(timeline[index].observation).likelihood);
      if (positive !== previousPositive) flips += 1;
      previousPositive = positive;
    }
    return flips;
  }

  function checkpointResult(timeline, eventMs, checkpointHours) {
    const targetMs = eventMs - checkpointHours * 3600000;
    const selected = latestAtOrBefore(timeline, targetMs);
    if (!selected) {
      return {
        checkpointHours,
        targetTime: new Date(targetMs).toISOString(),
        status: 'no-snapshot',
        snapshot: null,
        scoring: null
      };
    }
    const prediction = t1Prediction(selected.observation);
    const scoring = gradeWindow(new Date(eventMs).toISOString(), prediction.window);
    return {
      checkpointHours,
      targetTime: new Date(targetMs).toISOString(),
      status: 'scored',
      snapshot: {
        capturedAt: selected.capturedAt,
        captureFingerprint: selected.captureFingerprint || null,
        rawGroupKey: selected.rawGroupKey || selected.observation?.group?.key || null,
        likelihood: prediction.likelihood,
        estimatedWindow: prediction.window,
        confidence: selected.observation?.analysis?.basicForecast?.confidence ?? null,
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

  function evaluateTc1Event({ event, timeline, caseId, attribution }) {
    const eventMs = parseTimeMs(event?.eventTime);
    if (!Number.isFinite(eventMs)) throw new Error('TC1 event must have a valid eventTime');
    const preEvent = sortTimeline(timeline).filter(row => parseTimeMs(row.capturedAt) < eventMs);
    const checkpoints = CHECKPOINT_HOURS.map(hours => checkpointResult(preEvent, eventMs, hours));
    const first = firstPositive(preEvent);
    const stable = firstStablePositive(preEvent);
    const flips = reversalFlips(preEvent);
    const final = preEvent.at(-1) || null;
    const finalPrediction = final ? t1Prediction(final.observation) : { likelihood: null, window: null };
    const finalWindowScore = gradeWindow(event.eventTime, finalPrediction.window);
    const stableLeadHours = stable ? hoursBetween(eventMs, parseTimeMs(stable.capturedAt)) : null;
    const firstLeadHours = first ? hoursBetween(eventMs, parseTimeMs(first.capturedAt)) : null;

    return {
      schemaVersion: VERSION,
      rubricVersion: RUBRIC_VERSION,
      status: 'evaluated',
      caseId,
      attribution,
      truth: {
        eventType: event.eventType,
        eventTime: event.eventTime,
        timeSource: event.timeSource,
        code: event?.currentTruth?.code || null,
        level: event?.currentTruth?.level ?? null,
        issueTime: event?.currentTruth?.issueTime || null,
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
        estimatedWindow: finalPrediction.window,
        windowScoring: finalWindowScore
      } : null,
      grades: {
        stableLead: gradeStableLead(stableLeadHours),
        stability: gradeStability(flips),
        finalWindowTiming: finalWindowScore.grade,
        finalWindowPrecision: gradeWindowPrecision(finalWindowScore.widthHours)
      },
      rubric: RUBRIC
    };
  }

  function isInitialTc1Issue(event) {
    return event?.eventType === 'ISSUE'
      && String(event?.currentTruth?.code || '').toUpperCase() === 'TC1'
      && Number(event?.currentTruth?.level) === 1;
  }

  return Object.freeze({
    VERSION,
    RUBRIC_VERSION,
    CHECKPOINT_HOURS,
    RUBRIC,
    normalizeText,
    isPositiveLikelihood,
    t1Prediction,
    gradeWindow,
    gradeStableLead,
    gradeStability,
    gradeWindowPrecision,
    candidateCasesForEvent,
    attributeCase,
    evaluateTc1Event,
    isInitialTc1Issue
  });
});
