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
    if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
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

  function median(values) {
    const usable = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!usable.length) return null;
    const middle = Math.floor(usable.length / 2);
    return usable.length % 2 ? usable[middle] : (usable[middle - 1] + usable[middle]) / 2;
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

  function nextBandEntry(impact, weightedImpact, thresholds, referenceTime) {
    const referenceMs = timeMs(referenceTime);
    if (!Number.isFinite(referenceMs)) return null;
    const candidates = [];
    thresholds.forEach(threshold => {
      const weightedBand = weightedImpact?.distanceBands?.[String(threshold)];
      const weightedIntervals = Array.isArray(weightedBand?.intervals) ? weightedBand.intervals : [];
      weightedIntervals.forEach(interval => {
        const enterMs = timeMs(interval?.enterTime);
        if (Number.isFinite(enterMs) && enterMs > referenceMs + 1000) {
candidates.push({ thresholdKm: threshold, time: iso(enterMs), source: 'weighted-consensus', supportAgencyCount: null });
        }
      });
      const agencies = impact?.distanceBands?.[String(threshold)]?.agencies;
      if (Array.isArray(agencies)) {
        agencies.forEach(item => (Array.isArray(item?.intervals) ? item.intervals : []).forEach(interval => {
const enterMs = timeMs(interval?.enterTime);
if (Number.isFinite(enterMs) && enterMs > referenceMs + 1000) {
  candidates.push({ thresholdKm: threshold, time: iso(enterMs), source: `agency-${item.agency || 'unknown'}`, supportAgencyCount: 1 });
}
        }));
      }
      const fallback = timeMs(weightedBand?.firstEntryTime ?? impact?.distanceBands?.[String(threshold)]?.entryWindow?.start);
      if (Number.isFinite(fallback) && fallback > referenceMs + 1000) {
        candidates.push({ thresholdKm: threshold, time: iso(fallback), source: weightedBand?.firstEntryTime ? 'weighted-consensus' : 'agency-window', supportAgencyCount: null });
      }
    });
    candidates.sort((a, b) => timeMs(a.time) - timeMs(b.time));
    return candidates[0] ?? null;
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

  function signalThresholds(signal) {
    if (signal === 'T8') return { possible: 0.40, likely: 0.70 };
    if (signal === 'T3') return { possible: 0.38, likely: 0.65 };
    return { possible: 0.35, likely: 0.58 };
  }

  function pointSignalEvidence(entry, checkpoint, signal) {
    const agencySpecific = entry?.agency != null;
    const distanceKm = agencySpecific
      ? finite(entry?.distanceKm)
      : (finite(entry?.distanceKm) ?? finite(checkpoint?.distanceMedianKm));
    const windMs = agencySpecific
      ? finite(entry?.maximumWindMs)
      : (finite(entry?.maximumWindMs) ?? finite(checkpoint?.windMedianMs));
    const timeRelevance = clamp(finite(checkpoint?.timeRelevance) ?? softTimeRelevance(finite(checkpoint?.leadHours)));
    const rapid = clamp(agencySpecific
      ? (finite(entry?.rapidEvolutionIndex) ?? 0)
      : (finite(entry?.rapidEvolutionIndex) ?? finite(checkpoint?.rapidEvolutionIndex) ?? 0));
    const approachRateKmh = agencySpecific
      ? finite(entry?.approachRateKmh)
      : (finite(entry?.approachRateKmh) ?? finite(checkpoint?.approachRateKmh));
    let physical;
    if (signal === 'T1') {
      const proximity = smoothCloser(distanceKm, 800);
      const motionPotential = Number.isFinite(approachRateKmh) ? clamp((approachRateKmh + 8) / 24) : 0.45;
      const intensityPotential = Number.isFinite(windMs) ? clamp((windMs - 8) / 22) : 0.35;
      physical = proximity * (0.28 + 0.52 * motionPotential) + intensityPotential * 0.08 + rapid * 0.12;
    } else if (signal === 'T3') {
      const proximity = smoothCloser(distanceKm, 500);
      const windCapability = Number.isFinite(windMs) ? clamp((windMs - 9) / 8.5) : 0.40;
      physical = proximity * (0.15 + 0.55 * windCapability) + rapid * proximity * 0.10;
    } else {
      const proximity = smoothCloser(distanceKm, 300);
      const windCapability = Number.isFinite(windMs) ? clamp((windMs - 15) / 10) : 0.35;
      physical = proximity * (0.12 + 0.58 * windCapability) + rapid * proximity * 0.10;
    }
    return clamp(physical * (0.62 + 0.38 * timeRelevance));
  }

  function checkpointEvidence(checkpoint, signal) {
    const agencies = Array.isArray(checkpoint?.agencies) ? checkpoint.agencies : [];
    const perAgency = agencies.map(entry => ({
      agency: entry.agency,
      evidence: pointSignalEvidence(entry, checkpoint, signal),
      reliability: clamp(finite(entry?.interpolationReliability) ?? 1),
      exactOfficialTime: entry?.exactOfficialTime === true
    }));
    if (!perAgency.length) {
      const fallback = pointSignalEvidence({}, checkpoint, signal);
      return {
        aggregate: fallback,
        credibleAggregate: fallback,
        consensus: fallback,
        credibleConsensus: fallback,
        scenarioMax: fallback,
        supportAgencyCount: 0,
        effectiveSupportWeight: 0,
        effectiveSupportFraction: 0,
        meanReliability: 1,
        totalAgencyCount: 0,
        perAgency: []
      };
    }
    const values = perAgency.map(item => item.evidence).filter(Number.isFinite);
    const consensus = median(values) ?? 0;
    const scenarioMax = values.length ? Math.max(...values) : 0;
    const threshold = signalThresholds(signal).possible;
    const supporting = perAgency.filter(item => item.evidence >= threshold);
    const supportAgencyCount = supporting.length;
    const totalAgencyCount = perAgency.length;
    const supportFraction = totalAgencyCount > 0 ? supportAgencyCount / totalAgencyCount : 0;
    const effectiveSupportWeight = supporting.reduce((sum, item) => sum + item.reliability, 0);
    const effectiveSupportFraction = totalAgencyCount > 0 ? effectiveSupportWeight / totalAgencyCount : 0;
    const meanReliability = totalAgencyCount > 0
      ? perAgency.reduce((sum, item) => sum + item.reliability, 0) / totalAgencyCount
      : 1;
    const coverageCredibility = totalAgencyCount >= 3 ? 1 : (totalAgencyCount === 2 ? 0.82 : 0.60);
    const scenarioCredibility = coverageCredibility * (0.35 + 0.65 * supportFraction);
    const credibleScenarioCredibility = coverageCredibility * (0.35 + 0.65 * effectiveSupportFraction);
    const aggregate = clamp(Math.max(consensus, scenarioMax * scenarioCredibility));
    const credibleConsensus = clamp(consensus * meanReliability);
    const credibleAggregate = clamp(Math.max(credibleConsensus, scenarioMax * credibleScenarioCredibility));
    return {
      aggregate,
      credibleAggregate,
      consensus,
      credibleConsensus,
      scenarioMax,
      supportAgencyCount,
      effectiveSupportWeight,
      effectiveSupportFraction,
      meanReliability,
      totalAgencyCount,
      scenarioCredibility,
      credibleScenarioCredibility,
      perAgency
    };
  }

  function segmentIntervalAbove(left, right, threshold) {
    const leftLead = finite(left?.checkpoint?.leadHours);
    const rightLead = finite(right?.checkpoint?.leadHours);
    const a = finite(left?.evidence);
    const b = finite(right?.evidence);
    if (!Number.isFinite(leftLead) || !Number.isFinite(rightLead) || !(rightLead > leftLead) || !Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (a >= threshold && b >= threshold) return { start: leftLead, end: rightLead };
    if (a < threshold && b < threshold) return null;
    const delta = b - a;
    if (Math.abs(delta) < 1e-12) return null;
    const crossing = leftLead + ((threshold - a) / delta) * (rightLead - leftLead);
    return a >= threshold
      ? { start: leftLead, end: crossing }
      : { start: crossing, end: rightLead };
  }

  function maximumPersistentDuration(entries, threshold) {
    const intervals = [];
    for (let index = 1; index < entries.length; index += 1) {
      const interval = segmentIntervalAbove(entries[index - 1], entries[index], threshold);
      if (interval && interval.end > interval.start) intervals.push(interval);
    }
    if (!intervals.length) return 0;
    const merged = [{ ...intervals[0] }];
    for (let index = 1; index < intervals.length; index += 1) {
      const interval = intervals[index];
      const current = merged[merged.length - 1];
      if (interval.start <= current.end + 1e-9) current.end = Math.max(current.end, interval.end);
      else merged.push({ ...interval });
    }
    return merged.reduce((best, interval) => Math.max(best, interval.end - interval.start), 0);
  }

  function timelineSignalSummary(timeline, signal) {
    const entries = (Array.isArray(timeline) ? timeline : [])
      .filter(item => Number.isFinite(finite(item?.leadHours)) && finite(item.leadHours) >= 0)
      .map(item => {
        const details = checkpointEvidence(item, signal);
        return {
          checkpoint: item,
          evidence: details.aggregate,
          credibleEvidence: details.credibleAggregate,
          details
        };
      });
    if (!entries.length) return {
      maxEvidence: 0,
      rawMaxEvidence: 0,
      credibleMaxEvidence: 0,
      sustainedEvidence: 0,
      credibleSustainedEvidence: 0,
      strongest: null,
      strongestCredible: null,
      firstPossible: null,
      firstLikely: null,
      persistenceHours: 0,
      crediblePersistenceHours: 0
    };
    const futureEntries = entries.filter(item => (finite(item?.checkpoint?.leadHours) ?? 0) > 1e-6);
    const scoringEntries = futureEntries.length ? futureEntries : entries;
    const strongest = scoringEntries.reduce((best, item) => item.evidence > best.evidence ? item : best, scoringEntries[0]);
    const strongestCredible = scoringEntries.reduce(
      (best, item) => item.credibleEvidence > best.credibleEvidence ? item : best,
      scoringEntries[0]
    );
    const thresholds = signalThresholds(signal);
    const persistenceHours = maximumPersistentDuration(entries, thresholds.possible);
    const credibleEntries = entries.map(item => ({ ...item, evidence: item.credibleEvidence }));
    const crediblePersistenceHours = maximumPersistentDuration(credibleEntries, thresholds.possible);
    const persistenceFactor = signal === 'T1' ? 1 : 1 - Math.exp(-persistenceHours / 6);
    const crediblePersistenceFactor = signal === 'T1' ? 1 : 1 - Math.exp(-crediblePersistenceHours / 6);
    const persistenceMultiplier = signal === 'T8'
      ? 0.66 + 0.34 * persistenceFactor
      : (signal === 'T3' ? 0.70 + 0.30 * persistenceFactor : 1);
    const crediblePersistenceMultiplier = signal === 'T8'
      ? 0.66 + 0.34 * crediblePersistenceFactor
      : (signal === 'T3' ? 0.70 + 0.30 * crediblePersistenceFactor : 1);
    const rawMaxEvidence = strongest.evidence;
    const credibleMaxEvidence = strongestCredible.credibleEvidence;
    const sustainedEvidence = clamp(rawMaxEvidence * persistenceMultiplier);
    const credibleSustainedEvidence = clamp(credibleMaxEvidence * crediblePersistenceMultiplier);
    const maxEvidence = rawMaxEvidence;
    const crossing = (threshold, evidenceKey = 'evidence') => {
      for (let index = 1; index < entries.length; index += 1) {
        const previous = entries[index - 1];
        const item = entries[index];
        const previousEvidence = finite(previous?.[evidenceKey]);
        const itemEvidence = finite(item?.[evidenceKey]);
        if (!Number.isFinite(previousEvidence) || !Number.isFinite(itemEvidence)) continue;
        if (!(previousEvidence < threshold && itemEvidence >= threshold)) continue;
        const previousMs = timeMs(previous.checkpoint?.validTime ?? previous.checkpoint?.time);
        const itemMs = timeMs(item.checkpoint?.validTime ?? item.checkpoint?.time);
        const evidenceDelta = itemEvidence - previousEvidence;
        if (!Number.isFinite(previousMs) || !Number.isFinite(itemMs) || !(itemMs > previousMs) || !(evidenceDelta > 1e-12)) {
          return item;
        }
        const fraction = clamp((threshold - previousEvidence) / evidenceDelta);
        const crossingMs = previousMs + fraction * (itemMs - previousMs);
        const previousLead = finite(previous.checkpoint?.leadHours);
        const itemLead = finite(item.checkpoint?.leadHours);
        const crossingLead = Number.isFinite(previousLead) && Number.isFinite(itemLead)
          ? previousLead + fraction * (itemLead - previousLead)
          : finite(item.checkpoint?.leadHours);
        return {
          ...item,
          checkpoint: {
            ...item.checkpoint,
            validTime: iso(crossingMs),
            time: iso(crossingMs),
            leadHours: crossingLead
          },
          thresholdCrossingInterpolated: true,
          crossingFraction: fraction
        };
      }
      return null;
    };
    return {
      maxEvidence,
      rawMaxEvidence,
      credibleMaxEvidence,
      sustainedEvidence,
      credibleSustainedEvidence,
      strongest,
      strongestCredible,
      firstPossible: crossing(thresholds.possible, 'evidence'),
      firstLikely: crossing(thresholds.likely, 'credibleEvidence'),
      persistenceHours,
      crediblePersistenceHours,
      persistenceFactor,
      crediblePersistenceFactor
    };
  }

  function timelineAnchor(summary, likelihood) {
    const selected = likelihood === 'likely' ? (summary.firstLikely ?? summary.firstPossible) : summary.firstPossible;
    return selected?.checkpoint?.validTime ?? selected?.checkpoint?.time ?? null;
  }

  function timelineWindow(anchor, timeline, referenceTime, defaultBefore = 4, defaultAfter = 6, analysisConfidence = 0.5) {
    if (!anchor) return null;
    const anchorMs = timeMs(anchor);
    if (!Number.isFinite(anchorMs)) return null;
    const index = (Array.isArray(timeline) ? timeline : []).findIndex(item => timeMs(item?.validTime ?? item?.time) === anchorMs);
    const previousGap = index > 0 ? finite(timeline[index]?.intervalFromPreviousHours) : null;
    const nextGap = index >= 0 && index + 1 < timeline.length
      ? finite(timeline[index + 1]?.intervalFromPreviousHours) : null;
    const cadenceBefore = Number.isFinite(previousGap) ? clamp(previousGap / 2, 2, 6) : defaultBefore;
    const cadenceAfter = Number.isFinite(nextGap) ? clamp(nextGap / 2, 2, 8) : defaultAfter;
    const referenceMs = timeMs(referenceTime);
    const anchorLeadHours = Number.isFinite(referenceMs) ? Math.max(0, (anchorMs - referenceMs) / HOUR_MS) : null;
    const horizonRelevance = Number.isFinite(anchorLeadHours) ? softTimeRelevance(anchorLeadHours) : 0.5;
    const confidence = clamp(finite(analysisConfidence) ?? 0.5);
    const uncertaintyHalfSpan = clamp(
      3
      + (1 - confidence) * 6
      + (1 - horizonRelevance) * 3,
      3,
      12
    );
    const before = Math.max(cadenceBefore, uncertaintyHalfSpan);
    const after = Math.max(cadenceAfter, uncertaintyHalfSpan);
    const startMs = Math.max(anchorMs - before * HOUR_MS, Number.isFinite(referenceMs) ? referenceMs : -Infinity);
    return { start: iso(startMs), end: iso(anchorMs + after * HOUR_MS) };
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
    const directDepart = clamp(finite(analyzers.directDepart?.confidence) ?? 0);
    const reApproach = clamp(finite(analyzers.reApproach?.confidence) ?? 0);
    const quasiStationary = clamp(finite(analyzers.quasiStationary?.confidence) ?? 0);
    const forecastEdge = clamp(finite(analyzers.forecastEdge?.confidence) ?? 0);
    const disagreement = clamp(finite(analyzers.agencyDisagreement?.confidence) ?? 0.35);
    const windFieldConfidence = clamp(finite(analyzers.windField?.confidence) ?? 0);
    const rapidEvolution = clamp(finite(analyzers.rapidEvolution?.confidence) ?? 0);
    const windMs = finite(analyzers.windField?.representativeWindMs)
      ?? finite(signalInputs?.featureVector?.closestMaximumWindMedianMs)
      ?? finite(signalInputs?.featureVector?.currentMaximumWindMedianMs);
    const trajectory = clamp(Math.max(directApproach, reApproach * 0.85, quasiStationary * 0.25));
    const usableAgencyCount = Math.max(0, finite(signalInputs?.featureVector?.usableAgencyCount) ?? finite(signalInputs?.coverage?.usableAgencyCount) ?? 0);
    const coverageFraction = count => usableAgencyCount > 0 ? clamp((finite(count) ?? 0) / usableAgencyCount) : 0;
    const latestStrongWindCoverage = coverageFraction(
      finite(signalInputs?.featureVector?.latestStrongWindFieldCoverageEffectiveAgencyCount)
        ?? signalInputs?.featureVector?.latestStrongWindFieldCoverageAgencyCount);
    const closestStrongWindCoverage = coverageFraction(
      finite(signalInputs?.featureVector?.closestTimeStrongWindFieldCoverageEffectiveAgencyCount)
        ?? signalInputs?.featureVector?.closestTimeStrongWindFieldCoverageAgencyCount);
    const latestGaleCoverage = coverageFraction(
      finite(signalInputs?.featureVector?.latestGaleWindFieldCoverageEffectiveAgencyCount)
        ?? signalInputs?.featureVector?.latestGaleWindFieldCoverageAgencyCount);
    const closestGaleCoverage = coverageFraction(
      finite(signalInputs?.featureVector?.closestTimeGaleWindFieldCoverageEffectiveAgencyCount)
        ?? signalInputs?.featureVector?.closestTimeGaleWindFieldCoverageAgencyCount);
    const unknownWindCoverage = coverageFraction(signalInputs?.featureVector?.unknownThresholdWindFieldCoverageAgencyCount);
    const windRadiusDataFraction = coverageFraction(signalInputs?.featureVector?.windRadiusAgencyCount);
    const windFieldScenarioExposure = coverageKey => {
      const agencyItems = Object.values(signalInputs?.agencies || {}).filter(item => item?.state === 'ok');
      if (!agencyItems.length) return 0;
      const strengths = agencyItems.map(item => {
        const latest = item?.windField?.latestEvidence;
        const closestEvidence = item?.windField?.closestTimeEvidence;
        const latestStrength = latest?.[coverageKey] ? clamp(finite(latest.freshness) ?? 1) : 0;
        const closestStrength = closestEvidence?.[coverageKey] ? clamp(finite(closestEvidence.freshness) ?? 1) : 0;
        return Math.max(latestStrength, closestStrength);
      });
      const scenarioMax = Math.max(...strengths, 0);
      const supportCount = strengths.filter(value => value > 0).length;
      const supportFraction = supportCount / agencyItems.length;
      const coverageCredibility = agencyItems.length >= 3 ? 1 : (agencyItems.length === 2 ? 0.82 : 0.60);
      return clamp(scenarioMax * coverageCredibility * (0.35 + 0.65 * supportFraction));
    };
    const t3WindFieldScenarioExposure = windFieldScenarioExposure('strongWindCoverage');
    const t8WindFieldScenarioExposure = windFieldScenarioExposure('galeCoverage');
    const t3WindFieldExposure = clamp(Math.max(latestStrongWindCoverage, closestStrongWindCoverage, t3WindFieldScenarioExposure, windFieldConfidence * 0.35, unknownWindCoverage * 0.20));
    const t8WindFieldExposure = clamp(Math.max(latestGaleCoverage, closestGaleCoverage, t8WindFieldScenarioExposure, windFieldConfidence * 0.18, unknownWindCoverage * 0.08));

    const t1Timeline = timelineSignalSummary(timeline, 'T1');
    const t3Timeline = timelineSignalSummary(timeline, 'T3');
    const t8Timeline = timelineSignalSummary(timeline, 'T8');

    const currentT1Proximity = smoothCloser(currentDistanceKm, 800);
    const futureT1Proximity = minimumLeadHours > 0 ? smoothCloser(minimumDistanceKm, 650) * timeRelevance : 0;
    const currentT1Motion = clamp(0.35 + directApproach * 0.65 - directDepart * 0.45 + reApproach * 0.25);
    const currentT1Risk = currentT1Proximity * (0.30 + currentT1Motion * 0.48);
    const futureT1Novelty = 1 - Math.exp(-Math.max(0, minimumLeadHours ?? 0) / 6);
    const futureT1Risk = futureT1Proximity * futureT1Novelty * (0.15 + trajectory * 0.85);
    const staticT1Risk = clamp(Math.max(currentT1Risk, futureT1Risk)
      + rapidEvolution * 0.05
      + windFieldConfidence * 0.04);
    const t1RiskIndex = clamp(Math.max(staticT1Risk, t1Timeline.rawMaxEvidence));

    const currentT3Proximity = smoothCloser(currentDistanceKm, 550);
    const futureT3Proximity = minimumLeadHours > 0 ? smoothCloser(minimumDistanceKm, 450) * timeRelevance : 0;
    const strongWindEvidence = Number.isFinite(windMs) ? clamp((windMs - 12) / 18) : 0;
    const strongWindExposure = strongWindEvidence * Math.max(currentT3Proximity, futureT3Proximity);
    const staticT3Risk = clamp(
      currentT3Proximity * 0.11
      + futureT3Proximity * 0.32
      + trajectory * 0.13
      + rapidEvolution * 0.07
      + strongWindExposure * 0.17
      + t3WindFieldExposure * 0.20
    );
    const t3DirectWindFieldRisk = clamp(t3WindFieldExposure * 0.70);
    const t3RiskIndex = clamp(Math.max(staticT3Risk, t3Timeline.maxEvidence, t3DirectWindFieldRisk));

    const currentT8Proximity = smoothCloser(currentDistanceKm, 350);
    const futureT8Proximity = minimumLeadHours > 0 ? smoothCloser(minimumDistanceKm, 280) * timeRelevance : 0;
    const galeEvidence = Number.isFinite(windMs) ? clamp((windMs - 20) / 22) : 0;
    const galeExposure = galeEvidence * Math.max(currentT8Proximity, futureT8Proximity);
    const staticT8Risk = clamp(
      currentT8Proximity * 0.09
      + futureT8Proximity * 0.29
      + trajectory * 0.11
      + rapidEvolution * 0.09
      + galeExposure * 0.17
      + t8WindFieldExposure * 0.25
    );
    const t8DirectWindFieldRisk = clamp(t8WindFieldExposure * 0.72);
    const t8RiskIndex = clamp(Math.max(staticT8Risk, t8Timeline.maxEvidence, t8DirectWindFieldRisk));

    const interpolationConfidence = clamp(finite(analyzers.interpolationReliability?.confidence) ?? 1);
    // Current analysed proximity is direct evidence and must not be penalized merely
    // because later forecast points are sparse. Only future/trajectory-derived T1
    // escalation is reliability-weighted; raw T1 risk remains unchanged for 'possible'.
    const t1CredibleStaticRisk = clamp(Math.max(
      currentT1Risk,
      futureT1Risk * interpolationConfidence
    ) + rapidEvolution * 0.05 * interpolationConfidence + windFieldConfidence * 0.04);
    const t1LikelyIndex = clamp(Math.max(
      t1CredibleStaticRisk,
      t1Timeline.credibleSustainedEvidence ?? 0
    ));
    const t3LikelyIndex = clamp(Math.max(
      staticT3Risk * 0.88 * interpolationConfidence,
      t3Timeline.credibleSustainedEvidence ?? 0,
      t3WindFieldExposure * 0.72
    ));
    // T8 normally benefits from persistence, but a short-lived extreme close-pass can
    // still be operationally important when the peak itself is well supported by
    // official forecast points. Keep this as a continuous credibility channel rather
    // than a hard agency-count gate: interpolated peaks decay with their checkpoint
    // reliability, while fully confirmed peaks retain their physical evidence.
    const t8PeakReliability = clamp(
      finite(t8Timeline.strongestCredible?.checkpoint?.interpolationReliability)
        ?? interpolationConfidence
    );
    const t8CrediblePeakEvidence = clamp(
      (t8Timeline.credibleMaxEvidence ?? 0) * t8PeakReliability
    );
    const t8LikelyIndex = clamp(Math.max(
      staticT8Risk * 0.86 * interpolationConfidence,
      t8Timeline.credibleSustainedEvidence ?? 0,
      t8CrediblePeakEvidence,
      t8WindFieldExposure * 0.75
    ));
    const t1Likelihood = t1RiskIndex < 0.35 ? 'unlikely' : (t1LikelyIndex >= 0.58 ? 'likely' : 'possible');
    const t3Likelihood = t3RiskIndex < 0.38 ? 'unlikely' : (t3LikelyIndex >= 0.65 ? 'likely' : 'possible');
    const t8Likelihood = t8RiskIndex < 0.40 ? 'unlikely' : (t8LikelyIndex >= 0.70 ? 'likely' : 'possible');
    const impactIndex = Number.isFinite(finite(summary.overallThreatIndex))
      ? finite(summary.overallThreatIndex)
      : clamp(currentT1Proximity * 0.35 + futureT1Proximity * 0.40 + trajectory * 0.25);
    const impactLikelihood = likelihoodFromIndex(impactIndex, 0.58, 0.28);
    const baseConfidence = clamp(finite(summary.confidenceIndex) ?? (1 - disagreement * 0.55));
    const t1ConfidenceIndex = baseConfidence;
    const t3ConfidenceIndex = clamp(baseConfidence * (0.70 + 0.30 * windRadiusDataFraction));
    const t8ConfidenceIndex = clamp(baseConfidence * (0.62 + 0.38 * windRadiusDataFraction));

    const entry800 = nextBandEntry(impact, weightedImpact, [800], referenceTime);
    const entry500 = nextBandEntry(impact, weightedImpact, [500, 400], referenceTime);
    const entry300 = nextBandEntry(impact, weightedImpact, [300, 200], referenceTime);
    const futureEntry = entry => {
      const lead = leadHours(referenceTime, entry?.time);
      return Number.isFinite(lead) && lead >= 0 ? entry.time : null;
    };
    const t1TimelineAnchor = timelineAnchor(t1Timeline, t1Likelihood);
    const t3TimelineAnchor = timelineAnchor(t3Timeline, t3Likelihood);
    const t8TimelineAnchor = timelineAnchor(t8Timeline, t8Likelihood);
    const t1Anchor = t1TimelineAnchor ?? futureEntry(entry800) ?? null;
    const t3Anchor = t3TimelineAnchor ?? futureEntry(entry500) ?? null;
    const t8Anchor = t8TimelineAnchor ?? futureEntry(entry300) ?? null;

    const commonBasis = [
      `current-distance:${Math.round(currentDistanceKm)}km`,
      `forecast-minimum:${Math.round(minimumDistanceKm)}km`,
      Number.isFinite(minimumLeadHours) ? `forecast-minimum-lead:${minimumLeadHours.toFixed(1)}h` : 'forecast-minimum-lead:unavailable',
      `time-relevance:${timeRelevance.toFixed(3)}`,
      `direct-approach:${directApproach.toFixed(3)}`,
      `direct-depart:${directDepart.toFixed(3)}`,
      `re-approach:${reApproach.toFixed(3)}`,
      `quasi-stationary:${quasiStationary.toFixed(3)}`,
      `rapid-evolution:${rapidEvolution.toFixed(3)}`,
      `forecast-edge:${forecastEdge.toFixed(3)}`,
      `agency-disagreement:${disagreement.toFixed(3)}`,
      Number.isFinite(windMs) ? `representative-wind:${windMs.toFixed(1)}m/s` : 'representative-wind:unavailable',
      `wind-field-any:${windFieldConfidence.toFixed(3)}`,
      `wind-field-t3:${t3WindFieldExposure.toFixed(3)}`,
      `wind-field-t3-scenario:${t3WindFieldScenarioExposure.toFixed(3)}`,
      `wind-field-t8:${t8WindFieldExposure.toFixed(3)}`,
      `wind-field-t8-scenario:${t8WindFieldScenarioExposure.toFixed(3)}`,
      `wind-radius-data:${windRadiusDataFraction.toFixed(3)}`,
      Number.isFinite(finite(signalInputs?.featureVector?.latestWindFieldEvidenceAgeMedianHours))
        ? `wind-field-latest-age:${finite(signalInputs.featureVector.latestWindFieldEvidenceAgeMedianHours).toFixed(1)}h` : 'wind-field-latest-age:unavailable',
      Number.isFinite(finite(signalInputs?.featureVector?.closestTimeWindFieldEvidenceAgeMedianHours))
        ? `wind-field-closest-age:${finite(signalInputs.featureVector.closestTimeWindFieldEvidenceAgeMedianHours).toFixed(1)}h` : 'wind-field-closest-age:unavailable'
    ];

    const signalWindow = (likelihood, timelineAnchorValue, fallbackAnchor, before, after) => {
      if (likelihood === 'unlikely') return null;
      if (timelineAnchorValue) return timelineWindow(
        timelineAnchorValue,
        timeline,
        referenceTime,
        before,
        after,
        finite(summary.confidenceIndex)
      );
      if (forecastEdge > 0.5 || !fallbackAnchor) return null;
      const fallbackWindow = windowAround(fallbackAnchor, before, after);
      const referenceMs = timeMs(referenceTime);
      const fallbackStartMs = timeMs(fallbackWindow?.start);
      if (fallbackWindow && Number.isFinite(referenceMs) && Number.isFinite(fallbackStartMs) && fallbackStartMs < referenceMs) fallbackWindow.start = iso(referenceMs);
      return fallbackWindow;
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
          confidenceIndex: t1ConfidenceIndex,
          persistenceHours: t1Timeline.persistenceHours,
          estimatedWindow: signalWindow(t1Likelihood, t1TimelineAnchor, t1Anchor, 6, 6),
          strongestCheckpoint: t1Timeline.strongest ? {
            label: t1Timeline.strongest.checkpoint.label,
            validTime: t1Timeline.strongest.checkpoint.validTime,
            evidence: t1Timeline.strongest.evidence,
            consensusEvidence: t1Timeline.strongest.details.consensus,
            scenarioMaxEvidence: t1Timeline.strongest.details.scenarioMax,
            supportAgencyCount: t1Timeline.strongest.details.supportAgencyCount,
            totalAgencyCount: t1Timeline.strongest.details.totalAgencyCount
          } : null,
          basis: [...commonBasis, `timeline-evidence:${t1Timeline.maxEvidence.toFixed(3)}`, `t1-risk-index:${t1RiskIndex.toFixed(3)}`]
        },
        T3: {
          likelihood: t3Likelihood,
          riskIndex: t3RiskIndex,
          confidenceIndex: t3ConfidenceIndex,
          persistenceHours: t3Timeline.persistenceHours,
          estimatedWindow: signalWindow(t3Likelihood, t3TimelineAnchor, t3Anchor, 6, 9),
          strongestCheckpoint: t3Timeline.strongest ? {
            label: t3Timeline.strongest.checkpoint.label,
            validTime: t3Timeline.strongest.checkpoint.validTime,
            evidence: t3Timeline.strongest.evidence,
            consensusEvidence: t3Timeline.strongest.details.consensus,
            scenarioMaxEvidence: t3Timeline.strongest.details.scenarioMax,
            supportAgencyCount: t3Timeline.strongest.details.supportAgencyCount,
            totalAgencyCount: t3Timeline.strongest.details.totalAgencyCount
          } : null,
          basis: [...commonBasis, `timeline-evidence:${t3Timeline.maxEvidence.toFixed(3)}`, `timeline-persistence:${t3Timeline.persistenceHours.toFixed(1)}h`, `direct-wind-field-risk:${t3DirectWindFieldRisk.toFixed(3)}`, `t3-likely-index:${t3LikelyIndex.toFixed(3)}`, `t3-risk-index:${t3RiskIndex.toFixed(3)}`]
        },
        T8: {
          likelihood: t8Likelihood,
          riskIndex: t8RiskIndex,
          confidenceIndex: t8ConfidenceIndex,
          persistenceHours: t8Timeline.persistenceHours,
          estimatedWindow: signalWindow(t8Likelihood, t8TimelineAnchor, t8Anchor, 6, 9),
          strongestCheckpoint: t8Timeline.strongest ? {
            label: t8Timeline.strongest.checkpoint.label,
            validTime: t8Timeline.strongest.checkpoint.validTime,
            evidence: t8Timeline.strongest.evidence,
            consensusEvidence: t8Timeline.strongest.details.consensus,
            scenarioMaxEvidence: t8Timeline.strongest.details.scenarioMax,
            supportAgencyCount: t8Timeline.strongest.details.supportAgencyCount,
            totalAgencyCount: t8Timeline.strongest.details.totalAgencyCount
          } : null,
          basis: [...commonBasis, `timeline-evidence:${t8Timeline.maxEvidence.toFixed(3)}`, `timeline-persistence:${t8Timeline.persistenceHours.toFixed(1)}h`, `direct-wind-field-risk:${t8DirectWindFieldRisk.toFixed(3)}`, `t8-peak-reliability:${t8PeakReliability.toFixed(3)}`, `t8-credible-peak-evidence:${t8CrediblePeakEvidence.toFixed(3)}`, `t8-likely-index:${t8LikelyIndex.toFixed(3)}`, `t8-risk-index:${t8RiskIndex.toFixed(3)}`]
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
        signalTimingUsesFutureThresholdCrossings: true,
        stormIntensityIsCoupledToHongKongExposureForT3T8: true,
        agencyAgreementAffectsConfidenceNotThreatMagnitude: true,
        minorityAgencyThreatScenarioPreserved: true,
        minorityAgencyWindFieldScenarioPreserved: true,
        perAgencyEvidenceUsesOnlyAgencyData: true,
        windFieldThresholdsAreSignalSpecificWhenKnown: true,
        windFieldIntersectionIsDirectThreatEvidence: true,
        localWindPersistenceIsContinuousEvidence: true,
        horizonLimitedFallbackTimingSuppressed: true,
        timeWeightingIsContinuous: true,
        softTimeScaleHours: SOFT_TIME_SCALE_HOURS,
        historicalCalibrationRequired: false,
        probabilityOutputIncluded: false,
        estimatedWindowsAreBroadGuidance: true,
        timingWindowsReflectAnalysisConfidence: true,
        interpolationCadenceDoesNotSetTimingPrecision: true,
        interpolationReliabilityAffectsLikelyEscalationNotRawThreat: true,
        reliableConfirmedPeakCanSupportT8LikelyEscalation: true,
        timingThresholdCrossingsAreInterpolated: true,
        firstVisibleAboveThresholdDoesNotInventCrossing: true,
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
