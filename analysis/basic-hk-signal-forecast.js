(function attachStormBasicHkSignalForecast(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StormBasicHkSignalForecast = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormBasicHkSignalForecast() {
  'use strict';

  const VERSION = 'basic-hk-signal-forecast/v1';
  const HOUR_MS = 60 * 60 * 1000;
  const SOFT_TIME_SCALE_HOURS = 72;

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
  }

  function timeMs(value) {
    if (value == null || value === '') return null;
    if (Number.isFinite(value)) return value;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function iso(value) {
    return Number.isFinite(value) ? new Date(value).toISOString() : null;
  }

  function addHours(value, hours) {
    const ms = timeMs(value);
    return Number.isFinite(ms) ? iso(ms + hours * HOUR_MS) : null;
  }

  function leadHours(reference, target) {
    const referenceMs = timeMs(reference);
    const targetMs = timeMs(target);
    if (!Number.isFinite(referenceMs) || !Number.isFinite(targetMs)) return null;
    return (targetMs - referenceMs) / HOUR_MS;
  }

  function softTimeRelevance(lead) {
    if (!Number.isFinite(lead)) return 0;
    if (lead <= 0) return 1;
    return 1 / (1 + lead / SOFT_TIME_SCALE_HOURS);
  }

  function smoothCloser(distanceKm, scaleKm) {
    if (!Number.isFinite(distanceKm) || !(scaleKm > 0)) return 0;
    const ratio = Math.max(0, distanceKm) / scaleKm;
    return 1 / (1 + ratio ** 3);
  }

  function representativeClosest(impact, weightedImpact) {
    const weighted = weightedImpact?.available === true ? weightedImpact.closestApproach : null;
    if (Number.isFinite(finite(weighted?.distanceKm)) && timeMs(weighted?.time) != null) {
      return { distanceKm: finite(weighted.distanceKm), time: iso(timeMs(weighted.time)), source: 'weighted-consensus' };
    }
    const consensus = impact?.closestApproach?.consensus;
    if (Number.isFinite(finite(consensus?.distanceKm)) && timeMs(consensus?.time) != null) {
      return { distanceKm: finite(consensus.distanceKm), time: iso(timeMs(consensus.time)), source: 'unweighted-consensus' };
    }
    const entries = (Array.isArray(impact?.agencyClosestApproaches) ? impact.agencyClosestApproaches : [])
      .filter(entry => Number.isFinite(finite(entry?.distanceKm)) && timeMs(entry?.time) != null)
      .sort((a, b) => finite(a.distanceKm) - finite(b.distanceKm));
    return entries.length ? {
      distanceKm: finite(entries[0].distanceKm),
      time: iso(timeMs(entries[0].time)),
      source: `agency-${entries[0].agency || 'unknown'}`
    } : null;
  }

  function firstBandEntry(impact, weightedImpact, thresholds) {
    for (const threshold of thresholds) {
      const weighted = weightedImpact?.distanceBands?.[String(threshold)]?.firstEntryTime;
      if (timeMs(weighted) != null) return { thresholdKm: threshold, time: iso(timeMs(weighted)), source: 'weighted-consensus' };
      const unweighted = impact?.distanceBands?.[String(threshold)]?.entryWindow?.start;
      if (timeMs(unweighted) != null) return { thresholdKm: threshold, time: iso(timeMs(unweighted)), source: 'agency-window' };
    }
    return null;
  }

  function windowAround(anchor, beforeHours, afterHours) {
    if (timeMs(anchor) == null) return null;
    return { start: addHours(anchor, -beforeHours), end: addHours(anchor, afterHours) };
  }

  function likelihoodFromIndex(index, likelyAt, possibleAt) {
    if (index >= likelyAt) return 'likely';
    if (index >= possibleAt) return 'possible';
    return 'unlikely';
  }

  function fallbackAssessment({ impact, signalInputs, referenceTime, closest }) {
    const featureVector = signalInputs?.featureVector || {};
    const currentDistanceKm = finite(featureVector.currentDistanceMedianKm) ?? closest.distanceKm;
    const minimumLead = leadHours(referenceTime, closest.time);
    const windMs = finite(featureVector.closestMaximumWindMedianMs)
      ?? finite(featureVector.currentMaximumWindMedianMs);
    const usableAgencyCount = finite(featureVector.usableAgencyCount)
      ?? finite(signalInputs?.coverage?.usableAgencyCount)
      ?? 0;
    const coverage = finite(featureVector.closestTimeWindFieldCoverageAgencyCount) ?? 0;
    const trend = impact?.trend?.aggregate ?? 'unavailable';
    const directApproach = trend === 'approaching' ? 0.65 : (trend === 'departing' ? 0.05 : 0.25);
    const disagreement = impact?.uncertainty?.level === 'high' ? 0.8
      : (impact?.uncertainty?.level === 'moderate' ? 0.5 : 0.25);
    const windField = clamp((usableAgencyCount > 0 ? coverage / usableAgencyCount : 0) * 0.65
      + (Number.isFinite(windMs) ? clamp(windMs / 35) * 0.35 : 0));
    return {
      schemaVersion: 'fallback-threat-evidence/v1',
      available: true,
      summary: {
        currentDistanceKm,
        forecastMinimumKm: closest.distanceKm,
        forecastMinimumLeadHours: minimumLead,
        representativeMinimum: closest,
        overallThreatIndex: null,
        confidenceIndex: 1 - disagreement * 0.55
      },
      analyzers: {
        directApproach: { confidence: directApproach },
        directDepart: { confidence: trend === 'departing' ? 0.65 : 0.1 },
        reApproach: { confidence: 0 },
        quasiStationary: { confidence: 0 },
        forecastEdge: { confidence: 0 },
        agencyDisagreement: { confidence: disagreement },
        windField: { confidence: windField, representativeWindMs: windMs, coverageAgencyCount: coverage },
        rapidEvolution: { confidence: 0 }
      },
      timeline: [],
      semantics: { hardThreatGateUsed: false, timeWeightingIsContinuous: true }
    };
  }

  function checkpointEvidence(checkpoint, signal) {
    const distanceKm = finite(checkpoint?.distanceMedianKm);
    const windMs = finite(checkpoint?.windMedianMs);
    const timeRelevance = clamp(finite(checkpoint?.timeRelevance) ?? softTimeRelevance(finite(checkpoint?.leadHours)));
    const agreement = clamp(finite(checkpoint?.agreementIndex) ?? 0.5);
    const rapid = clamp(finite(checkpoint?.rapidEvolutionIndex) ?? 0);
    let proximity;
    let windEvidence;
    if (signal === 'T8') {
      proximity = smoothCloser(distanceKm, 300);
      windEvidence = Number.isFinite(windMs) ? clamp((windMs - 20) / 22) : 0;
    } else if (signal === 'T3') {
      proximity = smoothCloser(distanceKm, 500);
      windEvidence = Number.isFinite(windMs) ? clamp((windMs - 12) / 18) : 0;
    } else {
      proximity = smoothCloser(distanceKm, 800);
      windEvidence = Number.isFinite(windMs) ? clamp((windMs - 10) / 25) : 0;
    }
    const raw = signal === 'T8'
      ? proximity * 0.38 + windEvidence * 0.34 + rapid * 0.18 + agreement * 0.10
      : (signal === 'T3'
        ? proximity * 0.40 + windEvidence * 0.28 + rapid * 0.20 + agreement * 0.12
        : proximity * 0.48 + windEvidence * 0.14 + rapid * 0.24 + agreement * 0.14);
    return clamp(raw * (0.55 + 0.45 * timeRelevance));
  }

  function timelineSignalSummary(timeline, signal) {
    const entries = (Array.isArray(timeline) ? timeline : [])
      .filter(item => Number.isFinite(finite(item?.leadHours)) && finite(item.leadHours) >= 0)
      .map(item => ({ checkpoint: item, evidence: checkpointEvidence(item, signal) }));
    if (!entries.length) return { maxEvidence: 0, strongest: null, firstPossible: null, firstLikely: null };
    const strongest = entries.reduce((best, item) => item.evidence > best.evidence ? item : best, entries[0]);
    return {
      maxEvidence: strongest.evidence,
      strongest,
      firstPossible: entries.find(item => item.evidence >= (signal === 'T8' ? 0.40 : signal === 'T3' ? 0.38 : 0.35)) ?? null,
      firstLikely: entries.find(item => item.evidence >= (signal === 'T8' ? 0.70 : signal === 'T3' ? 0.65 : 0.58)) ?? null
    };
  }

  function timelineAnchor(summary, likelihood) {
    const selected = likelihood === 'likely' ? (summary.firstLikely ?? summary.firstPossible) : summary.firstPossible;
    return selected?.checkpoint?.validTime ?? selected?.checkpoint?.time ?? null;
  }

  function timelineWindow(anchor, timeline, defaultBefore = 4, defaultAfter = 6) {
    if (!anchor) return null;
    const anchorMs = timeMs(anchor);
    if (!Number.isFinite(anchorMs)) return null;
    const index = (Array.isArray(timeline) ? timeline : []).findIndex(item => timeMs(item?.validTime ?? item?.time) === anchorMs);
    const previousGap = index > 0 ? finite(timeline[index]?.intervalFromPreviousHours) : null;
    const nextGap = index >= 0 && index + 1 < timeline.length
      ? finite(timeline[index + 1]?.intervalFromPreviousHours) : null;
    const before = Number.isFinite(previousGap) ? clamp(previousGap / 2, 2, 6) : defaultBefore;
    const after = Number.isFinite(nextGap) ? clamp(nextGap / 2, 2, 8) : defaultAfter;
    return windowAround(anchor, before, after);
  }

  function buildBasicHkSignalForecast({ impact, weightedImpact, signalInputs, threatAssessment, generatedAt } = {}) {
    const closest = representativeClosest(impact, weightedImpact);
    if (!closest) {
      return {
        schemaVersion: VERSION,
        available: false,
        reason: 'no-hong-kong-proximity-forecast',
        semantics: { deterministic: true, officialHkoForecast: false, aiGenerated: false }
      };
    }

    const referenceTime = generatedAt ?? signalInputs?.generatedAt ?? impact?.generatedAt ?? null;
    const assessment = threatAssessment?.available === true
      ? threatAssessment
      : fallbackAssessment({ impact, signalInputs, referenceTime, closest });
    const summary = assessment.summary || {};
    const analyzers = assessment.analyzers || {};
    const timeline = Array.isArray(assessment.timeline) ? assessment.timeline : [];
    const currentDistanceKm = finite(summary.currentDistanceKm) ?? closest.distanceKm;
    const minimumDistanceKm = finite(summary.representativeMinimum?.distanceKm)
      ?? finite(summary.forecastMinimumKm)
      ?? closest.distanceKm;
    const minimumTime = summary.representativeMinimum?.time ?? closest.time;
    const minimumLeadHours = finite(summary.forecastMinimumLeadHours)
      ?? leadHours(referenceTime, minimumTime);
    const timeRelevance = softTimeRelevance(minimumLeadHours);
    const directApproach = clamp(finite(analyzers.directApproach?.confidence) ?? 0);
    const reApproach = clamp(finite(analyzers.reApproach?.confidence) ?? 0);
    const quasiStationary = clamp(finite(analyzers.quasiStationary?.confidence) ?? 0);
    const forecastEdge = clamp(finite(analyzers.forecastEdge?.confidence) ?? 0);
    const disagreement = clamp(finite(analyzers.agencyDisagreement?.confidence) ?? 0.35);
    const windFieldConfidence = clamp(finite(analyzers.windField?.confidence) ?? 0);
    const rapidEvolution = clamp(finite(analyzers.rapidEvolution?.confidence) ?? 0);
    const windMs = finite(analyzers.windField?.representativeWindMs)
      ?? finite(signalInputs?.featureVector?.closestMaximumWindMedianMs)
      ?? finite(signalInputs?.featureVector?.currentMaximumWindMedianMs);
    const agreement = 1 - disagreement;
    const trajectory = clamp(Math.max(directApproach, reApproach * 0.85, quasiStationary * 0.25));

    const t1Timeline = timelineSignalSummary(timeline, 'T1');
    const t3Timeline = timelineSignalSummary(timeline, 'T3');
    const t8Timeline = timelineSignalSummary(timeline, 'T8');

    const currentT1Proximity = smoothCloser(currentDistanceKm, 800);
    const futureT1Proximity = smoothCloser(minimumDistanceKm, 650) * timeRelevance;
    const staticT1Risk = clamp(
      currentT1Proximity * 0.18
      + futureT1Proximity * 0.42
      + trajectory * 0.20
      + rapidEvolution * 0.05
      + windFieldConfidence * 0.10
      + agreement * 0.05
    );
    const t1RiskIndex = clamp(Math.max(staticT1Risk, t1Timeline.maxEvidence));

    const currentT3Proximity = smoothCloser(currentDistanceKm, 550);
    const futureT3Proximity = smoothCloser(minimumDistanceKm, 450) * timeRelevance;
    const strongWindEvidence = Number.isFinite(windMs) ? clamp((windMs - 12) / 18) : 0;
    const staticT3Risk = clamp(
      currentT3Proximity * 0.12
      + futureT3Proximity * 0.34
      + trajectory * 0.14
      + rapidEvolution * 0.06
      + strongWindEvidence * 0.22
      + windFieldConfidence * 0.07
      + agreement * 0.05
    );
    const t3RiskIndex = clamp(Math.max(staticT3Risk, t3Timeline.maxEvidence));

    const currentT8Proximity = smoothCloser(currentDistanceKm, 350);
    const futureT8Proximity = smoothCloser(minimumDistanceKm, 280) * timeRelevance;
    const galeEvidence = Number.isFinite(windMs) ? clamp((windMs - 20) / 22) : 0;
    const staticT8Risk = clamp(
      currentT8Proximity * 0.10
      + futureT8Proximity * 0.30
      + trajectory * 0.11
      + rapidEvolution * 0.08
      + galeEvidence * 0.24
      + windFieldConfidence * 0.12
      + agreement * 0.05
    );
    const t8RiskIndex = clamp(Math.max(staticT8Risk, t8Timeline.maxEvidence));

    const t1Likelihood = likelihoodFromIndex(t1RiskIndex, 0.58, 0.35);
    const t3Likelihood = likelihoodFromIndex(t3RiskIndex, 0.65, 0.38);
    const t8Likelihood = likelihoodFromIndex(t8RiskIndex, 0.70, 0.40);
    const impactIndex = Number.isFinite(finite(summary.overallThreatIndex))
      ? finite(summary.overallThreatIndex)
      : clamp(currentT1Proximity * 0.35 + futureT1Proximity * 0.40 + trajectory * 0.25);
    const impactLikelihood = likelihoodFromIndex(impactIndex, 0.58, 0.28);

    const entry800 = firstBandEntry(impact, weightedImpact, [800]);
    const entry500 = firstBandEntry(impact, weightedImpact, [500, 400]);
    const entry300 = firstBandEntry(impact, weightedImpact, [300, 200]);
    const futureEntry = entry => {
      const lead = leadHours(referenceTime, entry?.time);
      return Number.isFinite(lead) && lead >= 0 ? entry.time : null;
    };
    const t1TimelineAnchor = timelineAnchor(t1Timeline, t1Likelihood);
    const t3TimelineAnchor = timelineAnchor(t3Timeline, t3Likelihood);
    const t8TimelineAnchor = timelineAnchor(t8Timeline, t8Likelihood);
    const t1Anchor = t1TimelineAnchor ?? futureEntry(entry800) ?? addHours(minimumTime, -24);
    const t3Anchor = t3TimelineAnchor ?? futureEntry(entry500) ?? addHours(minimumTime, -12);
    const t8Anchor = t8TimelineAnchor ?? futureEntry(entry300) ?? addHours(minimumTime, -6);

    const commonBasis = [
      `current-distance:${Math.round(currentDistanceKm)}km`,
      `forecast-minimum:${Math.round(minimumDistanceKm)}km`,
      Number.isFinite(minimumLeadHours) ? `forecast-minimum-lead:${minimumLeadHours.toFixed(1)}h` : 'forecast-minimum-lead:unavailable',
      `time-relevance:${timeRelevance.toFixed(3)}`,
      `direct-approach:${directApproach.toFixed(3)}`,
      `re-approach:${reApproach.toFixed(3)}`,
      `quasi-stationary:${quasiStationary.toFixed(3)}`,
      `rapid-evolution:${rapidEvolution.toFixed(3)}`,
      `forecast-edge:${forecastEdge.toFixed(3)}`,
      `agency-disagreement:${disagreement.toFixed(3)}`,
      Number.isFinite(windMs) ? `representative-wind:${windMs.toFixed(1)}m/s` : 'representative-wind:unavailable',
      `wind-field:${windFieldConfidence.toFixed(3)}`
    ];

    const signalWindow = (likelihood, timelineAnchorValue, fallbackAnchor, before, after) => {
      if (likelihood === 'unlikely') return null;
      if (timelineAnchorValue) return timelineWindow(timelineAnchorValue, timeline, before, after);
      return fallbackAnchor ? windowAround(fallbackAnchor, before, after) : null;
    };

    return {
      schemaVersion: VERSION,
      available: true,
      generatedAt: referenceTime,
      impact: {
        likelihood: impactLikelihood,
        expected: impactLikelihood !== 'unlikely',
        closestApproach: closest,
        currentDistanceKm,
        threatIndex: impactIndex,
        confidenceIndex: finite(summary.confidenceIndex),
        forecastMinimumMayBeHorizonLimited: forecastEdge > 0.5,
        uncertainty: impact?.uncertainty?.level ?? 'unknown'
      },
      signals: {
        T1: {
          likelihood: t1Likelihood,
          riskIndex: t1RiskIndex,
          estimatedWindow: signalWindow(t1Likelihood, t1TimelineAnchor, t1Anchor, 6, 6),
          strongestCheckpoint: t1Timeline.strongest ? {
            label: t1Timeline.strongest.checkpoint.label,
            validTime: t1Timeline.strongest.checkpoint.validTime,
            evidence: t1Timeline.strongest.evidence
          } : null,
          basis: [...commonBasis, `timeline-evidence:${t1Timeline.maxEvidence.toFixed(3)}`, `t1-risk-index:${t1RiskIndex.toFixed(3)}`]
        },
        T3: {
          likelihood: t3Likelihood,
          riskIndex: t3RiskIndex,
          estimatedWindow: signalWindow(t3Likelihood, t3TimelineAnchor, t3Anchor, 6, 9),
          strongestCheckpoint: t3Timeline.strongest ? {
            label: t3Timeline.strongest.checkpoint.label,
            validTime: t3Timeline.strongest.checkpoint.validTime,
            evidence: t3Timeline.strongest.evidence
          } : null,
          basis: [...commonBasis, `timeline-evidence:${t3Timeline.maxEvidence.toFixed(3)}`, `t3-risk-index:${t3RiskIndex.toFixed(3)}`]
        },
        T8: {
          likelihood: t8Likelihood,
          riskIndex: t8RiskIndex,
          estimatedWindow: signalWindow(t8Likelihood, t8TimelineAnchor, t8Anchor, 6, 9),
          strongestCheckpoint: t8Timeline.strongest ? {
            label: t8Timeline.strongest.checkpoint.label,
            validTime: t8Timeline.strongest.checkpoint.validTime,
            evidence: t8Timeline.strongest.evidence
          } : null,
          basis: [...commonBasis, `timeline-evidence:${t8Timeline.maxEvidence.toFixed(3)}`, `t8-risk-index:${t8RiskIndex.toFixed(3)}`]
        }
      },
      assessment: {
        schemaVersion: assessment.schemaVersion ?? null,
        timeline,
        analyzers
      },
      semantics: {
        deterministic: true,
        firstVersionHeuristic: true,
        evidenceCombination: true,
        hardThreatGateUsed: false,
        fixedDayBucketsUsed: false,
        timelineCanDriveSignalRisk: timeline.length > 0,
        timeWeightingIsContinuous: true,
        softTimeScaleHours: SOFT_TIME_SCALE_HOURS,
        historicalCalibrationRequired: false,
        probabilityOutputIncluded: false,
        estimatedWindowsAreBroadGuidance: true,
        officialHkoForecast: false,
        officialHkoDecisionInferred: false,
        label: 'Storm Track warning signal risk estimate',
        aiGenerated: false
      }
    };
  }

  return Object.freeze({
    VERSION,
    SOFT_TIME_SCALE_HOURS,
    NEAR_TERM_HOURS: SOFT_TIME_SCALE_HOURS,
    buildBasicHkSignalForecast
  });
});
