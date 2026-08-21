(function attachStormBasicHkSignalForecast(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StormBasicHkSignalForecast = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormBasicHkSignalForecast() {
  'use strict';

  const VERSION = 'basic-hk-signal-forecast/v1';
  const HOUR_MS = 60 * 60 * 1000;

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
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

  function likelihood(score, likelyAt, possibleAt) {
    if (score >= likelyAt) return 'likely';
    if (score >= possibleAt) return 'possible';
    return 'unlikely';
  }

  function buildBasicHkSignalForecast({ impact, weightedImpact, signalInputs, generatedAt } = {}) {
    const closest = representativeClosest(impact, weightedImpact);
    if (!closest) {
      return {
        schemaVersion: VERSION,
        available: false,
        reason: 'no-hong-kong-proximity-forecast',
        semantics: { deterministic: true, officialHkoForecast: false, aiGenerated: false }
      };
    }

    const distanceKm = closest.distanceKm;
    const trend = impact?.trend?.aggregate ?? 'unavailable';
    const featureVector = signalInputs?.featureVector || {};
    const windMs = finite(featureVector.closestMaximumWindMedianMs)
      ?? finite(featureVector.currentMaximumWindMedianMs);
    const windCoverageCount = finite(featureVector.closestTimeWindFieldCoverageAgencyCount) ?? 0;
    const usableAgencyCount = finite(featureVector.usableAgencyCount)
      ?? finite(signalInputs?.coverage?.usableAgencyCount)
      ?? 0;

    const entry800 = firstBandEntry(impact, weightedImpact, [800]);
    const entry500 = firstBandEntry(impact, weightedImpact, [500, 400]);
    const entry300 = firstBandEntry(impact, weightedImpact, [300, 200]);
    const approaching = trend === 'approaching';

    let impactScore = distanceKm <= 800 ? 3 : (distanceKm <= 1000 ? 2 : (distanceKm <= 1200 ? 1 : 0));
    if (approaching) impactScore += 1;
    if (entry800) impactScore += 1;
    const impactLikelihood = likelihood(impactScore, 3, 1);

    let t1Score = distanceKm <= 800 ? 3 : (distanceKm <= 1000 ? 2 : (distanceKm <= 1200 ? 1 : 0));
    if (approaching) t1Score += 1;
    if (entry800) t1Score += 1;

    let t3Score = distanceKm <= 400 ? 3 : (distanceKm <= 600 ? 2 : (distanceKm <= 800 ? 1 : 0));
    if (approaching) t3Score += 1;
    if (Number.isFinite(windMs) && windMs >= 17.5) t3Score += 1;
    if (windCoverageCount > 0) t3Score += 1;

    let t8Score = distanceKm <= 200 ? 3 : (distanceKm <= 300 ? 2 : (distanceKm <= 450 ? 1 : 0));
    if (approaching) t8Score += 1;
    if (Number.isFinite(windMs) && windMs >= 25) t8Score += 1;
    if (Number.isFinite(windMs) && windMs >= 33) t8Score += 1;
    if (windCoverageCount > 0) t8Score += 1;

    const t1Likelihood = likelihood(t1Score, 3, 1);
    const t3Likelihood = likelihood(t3Score, 4, 2);
    const t8SeverityEvidence = (Number.isFinite(windMs) && windMs >= 25) || windCoverageCount > 0;
    const t8Likelihood = t8Score >= 4 && t8SeverityEvidence ? 'likely' : likelihood(t8Score, 99, 2);

    const t1Anchor = entry800?.time ?? addHours(closest.time, -24);
    const t3Anchor = entry500?.time ?? addHours(closest.time, -12);
    const t8Anchor = entry300?.time ?? addHours(closest.time, -6);

    const reasons = {
      common: [
        `closest:${Math.round(distanceKm)}km`,
        `trend:${trend}`,
        Number.isFinite(windMs) ? `representative-wind:${windMs.toFixed(1)}m/s` : 'representative-wind:unavailable',
        `wind-field-coverage-agencies:${windCoverageCount}`,
        `usable-agencies:${usableAgencyCount}`
      ],
      T1: entry800 ? [`800km-entry:${entry800.time}`] : [],
      T3: entry500 ? [`${entry500.thresholdKm}km-entry:${entry500.time}`] : [],
      T8: entry300 ? [`${entry300.thresholdKm}km-entry:${entry300.time}`] : []
    };

    return {
      schemaVersion: VERSION,
      available: true,
      generatedAt: generatedAt ?? signalInputs?.generatedAt ?? impact?.generatedAt ?? null,
      impact: {
        likelihood: impactLikelihood,
        expected: impactLikelihood !== 'unlikely',
        closestApproach: closest,
        uncertainty: impact?.uncertainty?.level ?? 'unknown'
      },
      signals: {
        T1: {
          likelihood: t1Likelihood,
          estimatedWindow: t1Likelihood === 'unlikely' ? null : windowAround(t1Anchor, 6, 6),
          basis: [...reasons.common, ...reasons.T1]
        },
        T3: {
          likelihood: t3Likelihood,
          estimatedWindow: t3Likelihood === 'unlikely' ? null : windowAround(t3Anchor, 6, 9),
          basis: [...reasons.common, ...reasons.T3]
        },
        T8: {
          likelihood: t8Likelihood,
          estimatedWindow: t8Likelihood === 'unlikely' ? null : windowAround(t8Anchor, 6, 9),
          basis: [...reasons.common, ...reasons.T8]
        }
      },
      semantics: {
        deterministic: true,
        firstVersionHeuristic: true,
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

  return Object.freeze({ VERSION, buildBasicHkSignalForecast });
});
