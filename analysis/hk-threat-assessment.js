(function attachStormHkThreatAssessment(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StormHkThreatAssessment = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormHkThreatAssessment() {
  'use strict';

  const VERSION = 'hk-threat-assessment/v1';
  const AGENCIES = Object.freeze(['HKO', 'CMA', 'JMA', 'CWA']);
  const EARTH_RADIUS_KM = 6371;
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

  function haversineKm(lat1, lon1, lat2, lon2) {
    const values = [lat1, lon1, lat2, lon2].map(finite);
    if (values.some(value => value == null)) return null;
    const [aLat, aLon, bLat, bLon] = values;
    const toRad = degree => degree * Math.PI / 180;
    const dLat = toRad(bLat - aLat);
    const dLon = toRad(bLon - aLon);
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function median(values) {
    const usable = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!usable.length) return null;
    const middle = Math.floor(usable.length / 2);
    return usable.length % 2 ? usable[middle] : (usable[middle - 1] + usable[middle]) / 2;
  }

  function softTimeRelevance(leadHours) {
    if (!Number.isFinite(leadHours)) return 0;
    if (leadHours <= 0) return 1;
    return 1 / (1 + leadHours / SOFT_TIME_SCALE_HOURS);
  }

  function smoothCloser(distanceKm, scaleKm) {
    if (!Number.isFinite(distanceKm) || !(scaleKm > 0)) return 0;
    const ratio = Math.max(0, distanceKm) / scaleKm;
    return 1 / (1 + ratio ** 3);
  }

  function normalizePoint(point, referencePoint, referenceTimeMs) {
    if (!point || typeof point !== 'object') return null;
    const lat = finite(point.lat);
    const lon = finite(point.lon);
    const pointTimeMs = timeMs(point.timeMs ?? point.time);
    if (lat == null || lon == null || !Number.isFinite(pointTimeMs)) return null;
    const distanceKm = haversineKm(referencePoint.lat, referencePoint.lon, lat, lon);
    if (!Number.isFinite(distanceKm)) return null;
    return {
      time: iso(pointTimeMs),
      timeMs: pointTimeMs,
      leadHours: Number.isFinite(referenceTimeMs) ? (pointTimeMs - referenceTimeMs) / HOUR_MS : null,
      lat,
      lon,
      distanceKm,
      kind: point.kind ?? null
    };
  }

  function buildAgencyTrack(source, referencePoint, referenceTimeMs) {
    if (!source || source.state !== 'ok') return [];
    const positions = (Array.isArray(source.positions) ? source.positions : [])
      .map(point => normalizePoint(point, referencePoint, referenceTimeMs))
      .filter(Boolean)
      .sort((a, b) => a.timeMs - b.timeMs);
    const forecast = (Array.isArray(source.forecast) ? source.forecast : [])
      .map(point => normalizePoint(point, referencePoint, referenceTimeMs))
      .filter(Boolean)
      .sort((a, b) => a.timeMs - b.timeMs);
    const latestAnalysis = positions.length ? positions[positions.length - 1] : null;
    const candidates = [];
    if (latestAnalysis) candidates.push(latestAnalysis);
    forecast.forEach(point => {
      if (!latestAnalysis || point.timeMs >= latestAnalysis.timeMs) candidates.push(point);
    });
    const byTime = new Map();
    candidates.forEach(point => {
      const existing = byTime.get(point.timeMs);
      if (!existing || (existing.kind === 'forecast' && point.kind !== 'forecast')) byTime.set(point.timeMs, point);
    });
    return Array.from(byTime.values()).sort((a, b) => a.timeMs - b.timeMs);
  }

  function buildSegments(track) {
    const segments = [];
    for (let index = 1; index < track.length; index += 1) {
      const before = track[index - 1];
      const after = track[index];
      const durationHours = (after.timeMs - before.timeMs) / HOUR_MS;
      if (!(durationHours > 0)) continue;
      const distanceDeltaKm = after.distanceKm - before.distanceKm;
      const radialRateKmh = distanceDeltaKm / durationHours;
      const motionDistanceKm = haversineKm(before.lat, before.lon, after.lat, after.lon);
      const motionSpeedKmh = Number.isFinite(motionDistanceKm) ? motionDistanceKm / durationHours : null;
      const midpointLead = Number.isFinite(before.leadHours) && Number.isFinite(after.leadHours)
        ? (before.leadHours + after.leadHours) / 2 : null;
      segments.push({
        startTime: before.time,
        endTime: after.time,
        startLeadHours: before.leadHours,
        endLeadHours: after.leadHours,
        durationHours,
        distanceDeltaKm,
        radialRateKmh,
        motionSpeedKmh,
        approachStrength: clamp(-radialRateKmh / 18),
        departStrength: clamp(radialRateKmh / 18),
        stationaryStrength: Number.isFinite(motionSpeedKmh) ? Math.exp(-motionSpeedKmh / 8) : 0,
        timeRelevance: softTimeRelevance(midpointLead)
      });
    }
    return segments;
  }

  function weightedAverage(items, valueKey, weightKey = 'timeRelevance') {
    let numerator = 0;
    let denominator = 0;
    items.forEach(item => {
      const value = finite(item?.[valueKey]);
      const weight = finite(item?.[weightKey]);
      if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) return;
      numerator += value * weight;
      denominator += weight;
    });
    return denominator > 0 ? numerator / denominator : 0;
  }

  function agencyPattern(track) {
    if (!track.length) return null;
    const segments = buildSegments(track);
    const first = track[0];
    const last = track[track.length - 1];
    const minimum = track.reduce((best, point) => !best || point.distanceKm < best.distanceKm ? point : best, null);
    const spanHours = Number.isFinite(first.leadHours) && Number.isFinite(last.leadHours)
      ? Math.max(0, last.leadHours - first.leadHours) : 0;
    const remainingAfterMinimum = Number.isFinite(minimum?.leadHours) && Number.isFinite(last?.leadHours)
      ? Math.max(0, last.leadHours - minimum.leadHours) : null;
    const edgeConfidence = spanHours > 0 && Number.isFinite(remainingAfterMinimum)
      ? clamp(1 - remainingAfterMinimum / Math.max(12, spanHours * 0.35)) : 0;

    const directApproachConfidence = weightedAverage(segments, 'approachStrength');
    const directDepartConfidence = weightedAverage(segments, 'departStrength');
    const quasiStationaryConfidence = weightedAverage(segments, 'stationaryStrength');

    let reApproachConfidence = 0;
    for (let left = 0; left < segments.length; left += 1) {
      for (let right = left + 1; right < segments.length; right += 1) {
        const pair = segments[left].departStrength * segments[right].approachStrength;
        const relevance = Math.sqrt(segments[left].timeRelevance * segments[right].timeRelevance);
        reApproachConfidence = Math.max(reApproachConfidence, pair * relevance);
      }
    }

    for (let peakIndex = 1; peakIndex < track.length - 1; peakIndex += 1) {
      const beforePeak = track.slice(0, peakIndex);
      const afterPeak = track.slice(peakIndex + 1);
      if (!beforePeak.length || !afterPeak.length) continue;
      const priorMinimum = beforePeak.reduce((best, point) => point.distanceKm < best.distanceKm ? point : best, beforePeak[0]);
      const laterMinimum = afterPeak.reduce((best, point) => point.distanceKm < best.distanceKm ? point : best, afterPeak[0]);
      const peak = track[peakIndex];
      const outwardKm = peak.distanceKm - priorMinimum.distanceKm;
      const recoveryKm = peak.distanceKm - laterMinimum.distanceKm;
      if (!(outwardKm > 0) || !(recoveryKm > 0)) continue;
      const outwardStrength = clamp(outwardKm / Math.max(80, priorMinimum.distanceKm * 0.12));
      const recoveryStrength = clamp(recoveryKm / Math.max(100, peak.distanceKm * 0.18));
      const shapeStrength = Math.sqrt(outwardStrength * recoveryStrength);
      const relevance = softTimeRelevance(laterMinimum.leadHours);
      reApproachConfidence = Math.max(reApproachConfidence, shapeStrength * (0.5 + 0.5 * relevance));
    }

    return {
      currentDistanceKm: first.distanceKm,
      forecastEndDistanceKm: last.distanceKm,
      forecastEndLeadHours: last.leadHours,
      minimumWithinForecast: minimum ? {
        distanceKm: minimum.distanceKm,
        time: minimum.time,
        leadHours: minimum.leadHours,
        horizonEdgeConfidence: edgeConfidence
      } : null,
      directApproachConfidence,
      directDepartConfidence,
      reApproachConfidence,
      quasiStationaryConfidence,
      segments
    };
  }

  function disagreementConfidence(impact) {
    const level = impact?.uncertainty?.level;
    const levelBase = level === 'high' ? 0.8 : (level === 'moderate' ? 0.5 : (level === 'low' ? 0.2 : 0.35));
    const distanceRange = impact?.closestApproach?.distanceRangeKm;
    const distanceSpan = Number.isFinite(finite(distanceRange?.min)) && Number.isFinite(finite(distanceRange?.max))
      ? Math.max(0, finite(distanceRange.max) - finite(distanceRange.min)) : 0;
    const timeSpan = Math.max(0, finite(impact?.closestApproach?.agencyTimeWindow?.spanHours) ?? 0);
    const distanceEvidence = 1 - Math.exp(-distanceSpan / 180);
    const timeEvidence = 1 - Math.exp(-timeSpan / 30);
    return clamp(levelBase * 0.5 + distanceEvidence * 0.25 + timeEvidence * 0.25);
  }

  function aggregateAnalyzer(patterns, key) {
    const values = patterns.map(pattern => finite(pattern?.[key])).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  function buildTimeline(agencyTracks) {
    const maximumLead = Math.max(0, ...Object.values(agencyTracks)
      .flatMap(track => track.map(point => finite(point.leadHours)).filter(Number.isFinite)));
    const dayCount = Math.max(1, Math.ceil(maximumLead / 24));
    const windows = [];
    for (let day = 1; day <= dayCount; day += 1) {
      const startLeadHours = (day - 1) * 24;
      const endLeadHours = day * 24;
      const agencyEntries = [];
      Object.entries(agencyTracks).forEach(([agency, track]) => {
        const points = track.filter(point => Number.isFinite(point.leadHours)
          && point.leadHours >= startLeadHours
          && (day === dayCount ? point.leadHours <= endLeadHours + 0.001 : point.leadHours < endLeadHours));
        if (!points.length) return;
        const minimum = points.reduce((best, point) => point.distanceKm < best.distanceKm ? point : best, points[0]);
        agencyEntries.push({ agency, distanceKm: minimum.distanceKm, time: minimum.time, leadHours: minimum.leadHours });
      });
      if (!agencyEntries.length) continue;
      const distances = agencyEntries.map(entry => entry.distanceKm);
      const minimumKm = Math.min(...distances);
      const maximumKm = Math.max(...distances);
      const medianKm = median(distances);
      const midpointLead = (startLeadHours + endLeadHours) / 2;
      const proximityIndex = smoothCloser(medianKm, 650);
      const agreementIndex = Math.exp(-(maximumKm - minimumKm) / 260);
      const threatIndex = clamp(proximityIndex * (0.65 + 0.35 * agreementIndex) * softTimeRelevance(midpointLead));
      windows.push({
        label: `D${day}`,
        startLeadHours,
        endLeadHours,
        supportAgencyCount: agencyEntries.length,
        distanceMedianKm: medianKm,
        distanceRangeKm: { min: minimumKm, max: maximumKm },
        proximityIndex,
        agreementIndex,
        timeRelevance: softTimeRelevance(midpointLead),
        threatIndex,
        agencies: agencyEntries
      });
    }
    return windows.map((window, index) => ({
      ...window,
      distanceDeltaFromPreviousKm: index > 0 && Number.isFinite(windows[index - 1].distanceMedianKm)
        ? window.distanceMedianKm - windows[index - 1].distanceMedianKm : null
    }));
  }

  function buildHkThreatAssessment({ snapshot, impact, weightedImpact, signalInputs, generatedAt } = {}) {
    const referencePoint = snapshot?.referencePoint;
    const referenceTime = generatedAt ?? snapshot?.generatedAt ?? signalInputs?.generatedAt ?? impact?.generatedAt ?? null;
    const referenceTimeMs = timeMs(referenceTime);
    if (!Number.isFinite(finite(referencePoint?.lat)) || !Number.isFinite(finite(referencePoint?.lon)) || !Number.isFinite(referenceTimeMs)) {
      return {
        schemaVersion: VERSION,
        available: false,
        reason: 'reference-point-or-time-unavailable',
        semantics: { deterministic: true, hardThreatGateUsed: false, officialHkoForecast: false, aiGenerated: false }
      };
    }

    const agencyTracks = {};
    const agencyPatterns = {};
    AGENCIES.forEach(agency => {
      const track = buildAgencyTrack(snapshot?.sources?.[agency], referencePoint, referenceTimeMs);
      if (!track.length) return;
      agencyTracks[agency] = track;
      agencyPatterns[agency] = agencyPattern(track);
    });
    const patterns = Object.values(agencyPatterns).filter(Boolean);
    if (!patterns.length) {
      return {
        schemaVersion: VERSION,
        available: false,
        reason: 'no-usable-agency-tracks',
        semantics: { deterministic: true, hardThreatGateUsed: false, officialHkoForecast: false, aiGenerated: false }
      };
    }

    const directApproachConfidence = aggregateAnalyzer(patterns, 'directApproachConfidence');
    const directDepartConfidence = aggregateAnalyzer(patterns, 'directDepartConfidence');
    const reApproachConfidence = aggregateAnalyzer(patterns, 'reApproachConfidence');
    const quasiStationaryConfidence = aggregateAnalyzer(patterns, 'quasiStationaryConfidence');
    const forecastEdgeConfidence = aggregateAnalyzer(patterns.map(pattern => ({
      score: pattern.minimumWithinForecast?.horizonEdgeConfidence ?? 0
    })), 'score');
    const agencyDisagreementConfidence = disagreementConfidence(impact);

    const featureVector = signalInputs?.featureVector || {};
    const usableAgencyCount = finite(featureVector.usableAgencyCount)
      ?? finite(signalInputs?.coverage?.usableAgencyCount)
      ?? patterns.length;
    const windFieldCoverageCount = finite(featureVector.closestTimeWindFieldCoverageAgencyCount) ?? 0;
    const representativeWindMs = finite(featureVector.closestMaximumWindMedianMs)
      ?? finite(featureVector.currentMaximumWindMedianMs);
    const windFieldConfidence = clamp((usableAgencyCount > 0 ? windFieldCoverageCount / usableAgencyCount : 0) * 0.65
      + (Number.isFinite(representativeWindMs) ? clamp(representativeWindMs / 35) * 0.35 : 0));

    const timeline = buildTimeline(agencyTracks);
    const strongestTimelineThreat = timeline.reduce((best, item) => item.threatIndex > (best?.threatIndex ?? -1) ? item : best, null);
    const currentDistanceKm = median(patterns.map(pattern => pattern.currentDistanceKm));
    const forecastMinimumKm = median(patterns.map(pattern => pattern.minimumWithinForecast?.distanceKm).filter(Number.isFinite));
    const forecastMinimumLeadHours = median(patterns.map(pattern => pattern.minimumWithinForecast?.leadHours).filter(Number.isFinite));
    const representativeMinimum = weightedImpact?.available === true && Number.isFinite(finite(weightedImpact?.closestApproach?.distanceKm))
      ? {
          distanceKm: finite(weightedImpact.closestApproach.distanceKm),
          time: weightedImpact.closestApproach.time ?? null,
          source: 'weighted-consensus'
        }
      : (impact?.closestApproach?.consensus && Number.isFinite(finite(impact.closestApproach.consensus.distanceKm))
        ? {
            distanceKm: finite(impact.closestApproach.consensus.distanceKm),
            time: impact.closestApproach.consensus.time ?? null,
            source: 'unweighted-consensus'
          }
        : null);

    const currentProximityIndex = smoothCloser(currentDistanceKm, 800);
    const futureProximityIndex = smoothCloser(representativeMinimum?.distanceKm ?? forecastMinimumKm, 650)
      * softTimeRelevance(forecastMinimumLeadHours);
    const trajectoryConfidence = clamp(Math.max(
      directApproachConfidence,
      reApproachConfidence * 0.85,
      quasiStationaryConfidence * 0.35
    ));
    const overallThreatIndex = clamp(
      currentProximityIndex * 0.24
      + futureProximityIndex * 0.32
      + trajectoryConfidence * 0.24
      + windFieldConfidence * 0.12
      + (1 - agencyDisagreementConfidence) * 0.08
    );
    const confidenceIndex = clamp(1 - agencyDisagreementConfidence * 0.55 - forecastEdgeConfidence * 0.25);

    return {
      schemaVersion: VERSION,
      available: true,
      generatedAt: iso(referenceTimeMs),
      referencePoint: { lat: finite(referencePoint.lat), lon: finite(referencePoint.lon) },
      summary: {
        currentDistanceKm,
        forecastMinimumKm,
        forecastMinimumLeadHours,
        representativeMinimum,
        overallThreatIndex,
        confidenceIndex,
        strongestTimelineThreat: strongestTimelineThreat ? {
          label: strongestTimelineThreat.label,
          threatIndex: strongestTimelineThreat.threatIndex,
          distanceMedianKm: strongestTimelineThreat.distanceMedianKm
        } : null
      },
      analyzers: {
        directApproach: { confidence: directApproachConfidence },
        directDepart: { confidence: directDepartConfidence },
        reApproach: { confidence: reApproachConfidence },
        quasiStationary: { confidence: quasiStationaryConfidence },
        forecastEdge: { confidence: forecastEdgeConfidence },
        agencyDisagreement: { confidence: agencyDisagreementConfidence },
        windField: { confidence: windFieldConfidence, representativeWindMs, coverageAgencyCount: windFieldCoverageCount }
      },
      timeline,
      agencies: agencyPatterns,
      semantics: {
        deterministic: true,
        evidenceCombination: true,
        hardThreatGateUsed: false,
        timeWeightingIsContinuous: true,
        softTimeScaleHours: SOFT_TIME_SCALE_HOURS,
        forecastMinimumMayBeHorizonLimited: forecastEdgeConfidence > 0,
        officialAgencyDataRemainSeparate: true,
        officialHkoForecast: false,
        officialHkoDecisionInferred: false,
        aiGenerated: false
      }
    };
  }

  return Object.freeze({ VERSION, SOFT_TIME_SCALE_HOURS, buildHkThreatAssessment });
});
