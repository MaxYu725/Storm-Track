(function attachStormBasicHkSignalForecast(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StormBasicHkSignalForecast = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormBasicHkSignalForecast() {
  'use strict';

  const VERSION = 'basic-hk-signal-forecast/v1';
  const HOUR_MS = 60 * 60 * 1000;
  const NEAR_TERM_HOURS = 72;

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

  function leadHours(reference, target) {
    const referenceMs = timeMs(reference);
    const targetMs = timeMs(target);
    if (!Number.isFinite(referenceMs) || !Number.isFinite(targetMs)) return null;
    return (targetMs - referenceMs) / HOUR_MS;
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

  function westernSideMajority(signalInputs) {
    const agencies = Object.values(signalInputs?.agencies || {})
      .filter(item => item?.state === 'ok' && item?.current?.sectorFromHongKong);
    if (agencies.length < 2) return false;
    const west = new Set(['W', 'SW', 'NW']);
    const western = agencies.filter(item => west.has(item.current.sectorFromHongKong)).length;
    return western > agencies.length / 2;
  }

  function isNearTerm(referenceTime, targetTime, horizonHours = NEAR_TERM_HOURS) {
    const lead = leadHours(referenceTime, targetTime);
    return Number.isFinite(lead) && lead >= -1 && lead <= horizonHours;
  }

  function futureAnchor(entry, fallback, referenceTime) {
    if (entry?.time && isNearTerm(referenceTime, entry.time, NEAR_TERM_HOURS)) return entry.time;
    return fallback;
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

    const referenceTime = generatedAt ?? signalInputs?.generatedAt ?? impact?.generatedAt ?? null;
    const distanceKm = closest.distanceKm;
    const closestLeadHours = leadHours(referenceTime, closest.time);
    const trend = impact?.trend?.aggregate ?? 'unavailable';
    const featureVector = signalInputs?.featureVector || {};
    const currentDistanceKm = finite(featureVector.currentDistanceMedianKm) ?? distanceKm;
    const windMs = finite(featureVector.closestMaximumWindMedianMs)
      ?? finite(featureVector.currentMaximumWindMedianMs);
    const windCoverageCount = finite(featureVector.closestTimeWindFieldCoverageAgencyCount) ?? 0;
    const usableAgencyCount = finite(featureVector.usableAgencyCount)
      ?? finite(signalInputs?.coverage?.usableAgencyCount)
      ?? 0;

    const entry800 = firstBandEntry(impact, weightedImpact, [800]);
    const entry500 = firstBandEntry(impact, weightedImpact, [500, 400]);
    const entry300 = firstBandEntry(impact, weightedImpact, [300, 200]);
    const entry500LeadHours = leadHours(referenceTime, entry500?.time);
    const entry300LeadHours = leadHours(referenceTime, entry300?.time);
    const approaching = trend === 'approaching';
    const westernMajority = westernSideMajority(signalInputs);
    const nearTermClosest500 = distanceKm <= 500 && isNearTerm(referenceTime, closest.time, NEAR_TERM_HOURS);
    const nearTerm500Entry = isNearTerm(referenceTime, entry500?.time, NEAR_TERM_HOURS);
    const nearTerm300Entry = isNearTerm(referenceTime, entry300?.time, 48);
    const directWindEvidence = windCoverageCount > 0;
    const nearTermThreat = nearTermClosest500 || nearTerm500Entry || directWindEvidence;

    let impactLikelihood = 'unlikely';
    if (currentDistanceKm <= 800) impactLikelihood = nearTermThreat ? 'likely' : 'possible';
    else if (currentDistanceKm <= 1000) impactLikelihood = nearTermThreat ? 'possible' : 'unlikely';
    else if (currentDistanceKm <= 1200 && nearTermThreat) impactLikelihood = 'possible';

    let t1Score = currentDistanceKm <= 800 ? 2 : (currentDistanceKm <= 1000 ? 1 : 0);
    if (nearTermThreat) t1Score += 2;
    if (approaching && Number.isFinite(closestLeadHours) && closestLeadHours <= NEAR_TERM_HOURS) t1Score += 1;
    let t1Likelihood = likelihood(t1Score, 4, 2);
    if (westernMajority && !nearTermThreat) t1Likelihood = 'unlikely';
    else if (!nearTermThreat && t1Likelihood === 'likely') t1Likelihood = 'possible';

    let t3Score = distanceKm <= 400 ? 3 : (distanceKm <= 600 ? 2 : (distanceKm <= 800 ? 1 : 0));
    if (approaching) t3Score += 1;
    if (Number.isFinite(windMs) && windMs >= 17.5) t3Score += 1;
    if (directWindEvidence) t3Score += 1;
    const t3Threat = nearTerm500Entry
      || (currentDistanceKm <= 500 && approaching)
      || (nearTermClosest500 && Number.isFinite(windMs) && windMs >= 17.5)
      || directWindEvidence;
    const t3Likelihood = t3Threat ? likelihood(t3Score, 4, 2) : 'unlikely';

    let t8Score = distanceKm <= 200 ? 3 : (distanceKm <= 300 ? 2 : (distanceKm <= 450 ? 1 : 0));
    if (approaching) t8Score += 1;
    if (Number.isFinite(windMs) && windMs >= 25) t8Score += 1;
    if (Number.isFinite(windMs) && windMs >= 33) t8Score += 1;
    if (directWindEvidence) t8Score += 1;
    const t8Threat = nearTerm300Entry
      || (currentDistanceKm <= 300 && Number.isFinite(windMs) && windMs >= 25)
      || (directWindEvidence && currentDistanceKm <= 450);
    const t8SeverityEvidence = (Number.isFinite(windMs) && windMs >= 25) || directWindEvidence;
    const t8Likelihood = t8Threat
      ? (t8Score >= 4 && t8SeverityEvidence ? 'likely' : likelihood(t8Score, 99, 2))
      : 'unlikely';

    const t1Fallback = nearTermThreat ? addHours(closest.time, -24) : null;
    const t3Fallback = t3Threat ? addHours(closest.time, -12) : null;
    const t8Fallback = t8Threat ? addHours(closest.time, -6) : null;
    const t1Anchor = futureAnchor(entry800, t1Fallback, referenceTime);
    const t3Anchor = futureAnchor(entry500, t3Fallback, referenceTime);
    const t8Anchor = futureAnchor(entry300, t8Fallback, referenceTime);

    const reasons = {
      common: [
        `current-distance:${Math.round(currentDistanceKm)}km`,
        `closest:${Math.round(distanceKm)}km`,
        Number.isFinite(closestLeadHours) ? `closest-lead:${closestLeadHours.toFixed(1)}h` : 'closest-lead:unavailable',
        `trend:${trend}`,
        `western-side-majority:${westernMajority}`,
        `near-term-threat:${nearTermThreat}`,
        Number.isFinite(windMs) ? `representative-wind:${windMs.toFixed(1)}m/s` : 'representative-wind:unavailable',
        `wind-field-coverage-agencies:${windCoverageCount}`,
        `usable-agencies:${usableAgencyCount}`
      ],
      T1: entry800 ? [`800km-entry:${entry800.time}`] : [],
      T3: entry500 ? [`${entry500.thresholdKm}km-entry:${entry500.time}`, Number.isFinite(entry500LeadHours) ? `entry-lead:${entry500LeadHours.toFixed(1)}h` : 'entry-lead:unavailable'] : [],
      T8: entry300 ? [`${entry300.thresholdKm}km-entry:${entry300.time}`, Number.isFinite(entry300LeadHours) ? `entry-lead:${entry300LeadHours.toFixed(1)}h` : 'entry-lead:unavailable'] : []
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
        nearTermThreat,
        uncertainty: impact?.uncertainty?.level ?? 'unknown'
      },
      signals: {
        T1: {
          likelihood: t1Likelihood,
          estimatedWindow: t1Likelihood === 'unlikely' || !t1Anchor ? null : windowAround(t1Anchor, 6, 6),
          basis: [...reasons.common, ...reasons.T1]
        },
        T3: {
          likelihood: t3Likelihood,
          estimatedWindow: t3Likelihood === 'unlikely' || !t3Anchor ? null : windowAround(t3Anchor, 6, 9),
          basis: [...reasons.common, ...reasons.T3]
        },
        T8: {
          likelihood: t8Likelihood,
          estimatedWindow: t8Likelihood === 'unlikely' || !t8Anchor ? null : windowAround(t8Anchor, 6, 9),
          basis: [...reasons.common, ...reasons.T8]
        }
      },
      semantics: {
        deterministic: true,
        firstVersionHeuristic: true,
        nearTermThreatHorizonHours: NEAR_TERM_HOURS,
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

  return Object.freeze({ VERSION, NEAR_TERM_HOURS, buildBasicHkSignalForecast });
});
