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

  function normalizeLongitude(lon) {
    let value = lon;
    while (value > 180) value -= 360;
    while (value < -180) value += 360;
    return value;
  }

  function interpolateLongitude(leftLon, rightLon, ratio) {
    let delta = rightLon - leftLon;
    if (delta > 180) delta -= 360;
    else if (delta < -180) delta += 360;
    return normalizeLongitude(leftLon + delta * ratio);
  }

  function parseWindMs(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const text = String(value).trim().toLowerCase();
    const match = text.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const number = Number(match[0]);
    if (!Number.isFinite(number)) return null;
    if (/km\s*\/?h|kmh|kph/.test(text)) return number / 3.6;
    if (/kt|knot/.test(text)) return number * 0.514444;
    return number;
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
      maximumWindMs: parseWindMs(point.maximumWind ?? point.maxWind ?? point.wind),
      windRadiiAvailable: Array.isArray(point.windRadii) && point.windRadii.length > 0,
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

  function interpolateTrackAtTime(track, targetMs, referencePoint, referenceTimeMs) {
    if (!track.length || !Number.isFinite(targetMs)) return null;
    const exact = track.find(point => point.timeMs === targetMs);
    if (exact) return { ...exact, exactOfficialTime: true, interpolationSpanHours: 0, interpolationReliability: 1 };
    if (targetMs < track[0].timeMs || targetMs > track[track.length - 1].timeMs) return null;
    for (let index = 1; index < track.length; index += 1) {
      const before = track[index - 1];
      const after = track[index];
      if (targetMs >= after.timeMs) continue;
      const span = after.timeMs - before.timeMs;
      if (!(span > 0)) return null;
      const interpolationSpanHours = span / HOUR_MS;
      const interpolationReliability = 1 / (1 + interpolationSpanHours / 18);
      const ratio = (targetMs - before.timeMs) / span;
      const lat = before.lat + (after.lat - before.lat) * ratio;
      const lon = interpolateLongitude(before.lon, after.lon, ratio);
      const beforeWind = finite(before.maximumWindMs);
      const afterWind = finite(after.maximumWindMs);
      const maximumWindMs = Number.isFinite(beforeWind) && Number.isFinite(afterWind)
        ? beforeWind + (afterWind - beforeWind) * ratio
        : null;
      return {
        time: iso(targetMs),
        timeMs: targetMs,
        leadHours: (targetMs - referenceTimeMs) / HOUR_MS,
        lat,
        lon,
        distanceKm: haversineKm(referencePoint.lat, referencePoint.lon, lat, lon),
        maximumWindMs,
        windRadiiAvailable: false,
        kind: 'interpolated',
        exactOfficialTime: false,
        interpolationSpanHours,
        interpolationReliability
      };
    }
    return null;
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
      const windDeltaMs = Number.isFinite(before.maximumWindMs) && Number.isFinite(after.maximumWindMs)
        ? after.maximumWindMs - before.maximumWindMs : null;
      segments.push({
        startTime: before.time,
        endTime: after.time,
        startLeadHours: before.leadHours,
        endLeadHours: after.leadHours,
        durationHours,
        distanceDeltaKm,
        radialRateKmh,
        motionSpeedKmh,
        windDeltaMs,
        windRateMsPerHour: Number.isFinite(windDeltaMs) ? windDeltaMs / durationHours : null,
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
      const relevance = finite(item?.[weightKey]);
      const durationHours = finite(item?.durationHours);
      const durationWeight = Number.isFinite(durationHours) && durationHours > 0 ? durationHours : 1;
      const weight = Number.isFinite(relevance) ? relevance * durationWeight : null;
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

  function collectCheckpointTimes(agencyTracks) {
    return Array.from(new Set(Object.values(agencyTracks)
      .flatMap(track => track.map(point => point.timeMs).filter(Number.isFinite))))
      .sort((a, b) => a - b);
  }

  function checkpointLabel(leadHours) {
    if (!Number.isFinite(leadHours)) return 'unknown';
    const rounded = Math.round(leadHours * 10) / 10;
    return `${rounded >= 0 ? '+' : ''}${rounded}h`;
  }

  function buildTimeline(agencyTracks, referencePoint, referenceTimeMs) {
    const checkpointTimes = collectCheckpointTimes(agencyTracks);
    const checkpoints = checkpointTimes.map(targetMs => {
      const agencyEntries = [];
      Object.entries(agencyTracks).forEach(([agency, track]) => {
        const sample = interpolateTrackAtTime(track, targetMs, referencePoint, referenceTimeMs);
        if (!sample) return;
        agencyEntries.push({
agency,
time: sample.time,
leadHours: sample.leadHours,
distanceKm: sample.distanceKm,
maximumWindMs: sample.maximumWindMs,
interpolationSpanHours: finite(sample.interpolationSpanHours) ?? 0,
interpolationReliability: clamp(finite(sample.interpolationReliability) ?? (sample.exactOfficialTime === true ? 1 : 0.5)),
exactOfficialTime: sample.exactOfficialTime === true,
windRadiiAvailable: sample.windRadiiAvailable === true
        });
      });
      if (!agencyEntries.length) return null;
      const leadHours = (targetMs - referenceTimeMs) / HOUR_MS;
      const distances = agencyEntries.map(entry => entry.distanceKm).filter(Number.isFinite);
      const winds = agencyEntries.map(entry => entry.maximumWindMs).filter(Number.isFinite);
      const minimumKm = distances.length ? Math.min(...distances) : null;
      const maximumKm = distances.length ? Math.max(...distances) : null;
      const distanceMedianKm = median(distances);
      const windMedianMs = median(winds);
      const agreementIndex = distances.length > 1
        ? Math.exp(-(maximumKm - minimumKm) / 260)
        : 0.65;
      const proximityIndex = smoothCloser(distanceMedianKm, 650);
      const windSeverityIndex = Number.isFinite(windMedianMs) ? clamp((windMedianMs - 10) / 30) : 0;
      const timeRelevance = softTimeRelevance(leadHours);
      const physicalThreatIndex = clamp(proximityIndex * 0.70 + windSeverityIndex * 0.30);
      const threatIndex = clamp(physicalThreatIndex * (0.55 + 0.45 * timeRelevance));
      return {
        label: checkpointLabel(leadHours),
        validTime: iso(targetMs),
        leadHours,
        supportAgencyCount: agencyEntries.length,
        exactOfficialSupportCount: agencyEntries.filter(entry => entry.exactOfficialTime).length,
        interpolationReliability: agencyEntries.length
          ? agencyEntries.reduce((sum, entry) => sum + entry.interpolationReliability, 0) / agencyEntries.length
          : 0,
        windSupportAgencyCount: winds.length,
        distanceMedianKm,
        distanceRangeKm: Number.isFinite(minimumKm) && Number.isFinite(maximumKm) ? { min: minimumKm, max: maximumKm } : null,
        windMedianMs,
        proximityIndex,
        windSeverityIndex,
        agreementIndex,
        timeRelevance,
        physicalThreatIndex,
        threatIndex,
        agencies: agencyEntries
      };
    }).filter(Boolean);

    return checkpoints.map((checkpoint, index) => {
      const previous = index > 0 ? checkpoints[index - 1] : null;
      const intervalHours = previous && Number.isFinite(previous.leadHours)
        ? checkpoint.leadHours - previous.leadHours : null;
      const distanceDeltaKm = previous && Number.isFinite(previous.distanceMedianKm) && Number.isFinite(checkpoint.distanceMedianKm)
        ? checkpoint.distanceMedianKm - previous.distanceMedianKm : null;
      const windDeltaMs = previous && Number.isFinite(previous.windMedianMs) && Number.isFinite(checkpoint.windMedianMs)
        ? checkpoint.windMedianMs - previous.windMedianMs : null;
      const approachRateKmh = Number.isFinite(distanceDeltaKm) && Number.isFinite(intervalHours) && intervalHours > 0
        ? -distanceDeltaKm / intervalHours : null;
      const strengtheningRateMsPerHour = Number.isFinite(windDeltaMs) && Number.isFinite(intervalHours) && intervalHours > 0
        ? windDeltaMs / intervalHours : null;
      const agencies = checkpoint.agencies.map(entry => {
        const previousEntry = previous?.agencies?.find(item => item.agency === entry.agency) ?? null;
        const agencyDistanceDeltaKm = previousEntry && Number.isFinite(previousEntry.distanceKm) && Number.isFinite(entry.distanceKm)
? entry.distanceKm - previousEntry.distanceKm : null;
        const agencyWindDeltaMs = previousEntry && Number.isFinite(previousEntry.maximumWindMs) && Number.isFinite(entry.maximumWindMs)
? entry.maximumWindMs - previousEntry.maximumWindMs : null;
        const agencyApproachRateKmh = Number.isFinite(agencyDistanceDeltaKm) && Number.isFinite(intervalHours) && intervalHours > 0
? -agencyDistanceDeltaKm / intervalHours : null;
        const agencyStrengtheningRateMsPerHour = Number.isFinite(agencyWindDeltaMs) && Number.isFinite(intervalHours) && intervalHours > 0
? agencyWindDeltaMs / intervalHours : null;
        const agencyRapidEvolutionIndex = clamp(
(Number.isFinite(agencyApproachRateKmh) ? clamp(agencyApproachRateKmh / 25) : 0) * 0.6
+ (Number.isFinite(agencyStrengtheningRateMsPerHour) ? clamp(agencyStrengtheningRateMsPerHour / 1.2) : 0) * 0.4
        );
        return {
...entry,
distanceDeltaFromPreviousKm: agencyDistanceDeltaKm,
windDeltaFromPreviousMs: agencyWindDeltaMs,
approachRateKmh: agencyApproachRateKmh,
strengtheningRateMsPerHour: agencyStrengtheningRateMsPerHour,
rapidEvolutionIndex: agencyRapidEvolutionIndex
        };
      });
      const agencyRapidValues = agencies.map(entry => entry.rapidEvolutionIndex).filter(Number.isFinite);
      const rapidEvolutionIndex = agencyRapidValues.length ? median(agencyRapidValues) : 0;
      const scenarioRapidEvolutionIndex = agencyRapidValues.length ? Math.max(...agencyRapidValues) : 0;
      return {
        ...checkpoint,
        agencies,
        intervalFromPreviousHours: intervalHours,
        distanceDeltaFromPreviousKm: distanceDeltaKm,
        windDeltaFromPreviousMs: windDeltaMs,
        approachRateKmh,
        strengtheningRateMsPerHour,
        rapidEvolutionIndex,
        scenarioRapidEvolutionIndex
      };
    });
  }

  function representativeMinimumFromImpact(impact, weightedImpact, referenceTimeMs, patterns) {
    const weighted = weightedImpact?.available === true ? weightedImpact.closestApproach : null;
    if (Number.isFinite(finite(weighted?.distanceKm)) && Number.isFinite(timeMs(weighted?.time))) {
      const targetMs = timeMs(weighted.time);
      return { distanceKm: finite(weighted.distanceKm), time: iso(targetMs), leadHours: (targetMs - referenceTimeMs) / HOUR_MS, source: 'weighted-consensus' };
    }
    const consensus = impact?.closestApproach?.consensus;
    if (Number.isFinite(finite(consensus?.distanceKm)) && Number.isFinite(timeMs(consensus?.time))) {
      const targetMs = timeMs(consensus.time);
      return { distanceKm: finite(consensus.distanceKm), time: iso(targetMs), leadHours: (targetMs - referenceTimeMs) / HOUR_MS, source: 'unweighted-consensus' };
    }
    const candidates = patterns.map(pattern => pattern.minimumWithinForecast).filter(Boolean);
    if (!candidates.length) return null;
    const minimum = candidates.reduce((best, item) => item.distanceKm < best.distanceKm ? item : best, candidates[0]);
    return { ...minimum, source: 'agency-minimum' };
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

    const normalizedReferencePoint = { lat: finite(referencePoint.lat), lon: finite(referencePoint.lon) };
    const agencyTracks = {};
    const agencyPatterns = {};
    AGENCIES.forEach(agency => {
      const track = buildAgencyTrack(snapshot?.sources?.[agency], normalizedReferencePoint, referenceTimeMs);
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
    const forecastEdgeConfidence = aggregateAnalyzer(patterns.map(pattern => ({ score: pattern.minimumWithinForecast?.horizonEdgeConfidence ?? 0 })), 'score');
    const agencyDisagreementConfidence = disagreementConfidence(impact);

    const featureVector = signalInputs?.featureVector || {};
    const usableAgencyCount = finite(featureVector.usableAgencyCount)
      ?? finite(signalInputs?.coverage?.usableAgencyCount)
      ?? patterns.length;
    const latestWindFieldCoverageCount = finite(featureVector.latestWindFieldCoverageAgencyCount) ?? 0;
    const closestWindFieldCoverageCount = finite(featureVector.closestTimeWindFieldCoverageAgencyCount) ?? 0;
    const latestStrongWindCoverageCount = finite(featureVector.latestStrongWindFieldCoverageAgencyCount) ?? 0;
    const closestStrongWindCoverageCount = finite(featureVector.closestTimeStrongWindFieldCoverageAgencyCount) ?? 0;
    const latestGaleCoverageCount = finite(featureVector.latestGaleWindFieldCoverageAgencyCount) ?? 0;
    const closestGaleCoverageCount = finite(featureVector.closestTimeGaleWindFieldCoverageAgencyCount) ?? 0;
    const windRadiusAgencyCount = finite(featureVector.windRadiusAgencyCount) ?? 0;
    const representativeWindMs = finite(featureVector.closestMaximumWindMedianMs)
      ?? finite(featureVector.currentMaximumWindMedianMs);
    const coverageFraction = count => usableAgencyCount > 0 ? clamp(count / usableAgencyCount) : 0;
    const windFieldConfidence = Math.max(
      coverageFraction(latestWindFieldCoverageCount),
      coverageFraction(closestWindFieldCoverageCount)
    );

    const fullTimeline = buildTimeline(agencyTracks, normalizedReferencePoint, referenceTimeMs);
    const timeline = fullTimeline.filter(item => Number.isFinite(item.leadHours) && item.leadHours >= 0);
    const strongestTimelineThreat = timeline.reduce((best, item) => item.threatIndex > (best?.threatIndex ?? -1) ? item : best, null);
    const fastestEvolution = timeline.reduce((best, item) => item.scenarioRapidEvolutionIndex > (best?.scenarioRapidEvolutionIndex ?? -1) ? item : best, null);
    const interpolationReliabilityConfidence = timeline.length
      ? weightedAverage(timeline, 'interpolationReliability')
      : 1;
    const currentDistanceKm = finite(featureVector.currentDistanceMedianKm)
      ?? median(patterns.map(pattern => pattern.currentDistanceKm).filter(Number.isFinite));
    const representativeMinimum = representativeMinimumFromImpact(impact, weightedImpact, referenceTimeMs, patterns);
    const forecastMinimumKm = finite(representativeMinimum?.distanceKm);
    const forecastMinimumLeadHours = finite(representativeMinimum?.leadHours);

    const currentProximityIndex = smoothCloser(currentDistanceKm, 800);
    const positiveMinimumLead = Math.max(0, forecastMinimumLeadHours ?? 0);
    const futureNovelty = 1 - Math.exp(-positiveMinimumLead / 8);
    const futureProximityIndex = positiveMinimumLead > 0
      ? smoothCloser(forecastMinimumKm, 650) * softTimeRelevance(forecastMinimumLeadHours) * futureNovelty
      : 0;
    const trajectoryConfidence = clamp(Math.max(
      directApproachConfidence,
      reApproachConfidence * 0.85,
      quasiStationaryConfidence * 0.35
    ));
    const currentMotionThreat = clamp(
      0.22 + directApproachConfidence * 0.65 + reApproachConfidence * 0.20
      + quasiStationaryConfidence * 0.15 - directDepartConfidence * 0.42
    );
    const rapidEvolutionConfidence = clamp(finite(fastestEvolution?.scenarioRapidEvolutionIndex) ?? 0);
    const currentThreatChannel = clamp(currentProximityIndex * (0.16 + currentMotionThreat * 0.56));
    const futureThreatChannel = clamp(futureProximityIndex * (0.18 + trajectoryConfidence * 0.70));
    const windFieldThreatChannel = clamp(windFieldConfidence * 0.75);
    const rapidThreatChannel = clamp(rapidEvolutionConfidence * Math.max(currentProximityIndex, futureProximityIndex, 0.20) * 0.55);
    const overallThreatIndex = clamp(Math.max(
      currentThreatChannel,
      futureThreatChannel,
      windFieldThreatChannel,
      rapidThreatChannel
    ));
    const agencyCoverageConfidence = clamp(usableAgencyCount / 3);
    const confidenceIndex = clamp(
      (1 - agencyDisagreementConfidence * 0.55 - forecastEdgeConfidence * 0.25)
      * (0.55 + 0.45 * agencyCoverageConfidence)
      * (0.75 + 0.25 * interpolationReliabilityConfidence)
    );

    return {
      schemaVersion: VERSION,
      available: true,
      generatedAt: iso(referenceTimeMs),
      referencePoint: normalizedReferencePoint,
      summary: {
        currentDistanceKm,
        forecastMinimumKm,
        forecastMinimumLeadHours,
        representativeMinimum,
        overallThreatIndex,
        confidenceIndex,
        strongestTimelineThreat: strongestTimelineThreat ? {
          label: strongestTimelineThreat.label,
          validTime: strongestTimelineThreat.validTime,
          leadHours: strongestTimelineThreat.leadHours,
          threatIndex: strongestTimelineThreat.threatIndex,
          distanceMedianKm: strongestTimelineThreat.distanceMedianKm,
          windMedianMs: strongestTimelineThreat.windMedianMs
        } : null,
        fastestEvolution: fastestEvolution ? {
          label: fastestEvolution.label,
          validTime: fastestEvolution.validTime,
          leadHours: fastestEvolution.leadHours,
          rapidEvolutionIndex: fastestEvolution.scenarioRapidEvolutionIndex,
          medianRapidEvolutionIndex: fastestEvolution.rapidEvolutionIndex,
          approachRateKmh: fastestEvolution.approachRateKmh,
          strengtheningRateMsPerHour: fastestEvolution.strengtheningRateMsPerHour
        } : null
      },
      analyzers: {
        directApproach: { confidence: directApproachConfidence },
        directDepart: { confidence: directDepartConfidence },
        reApproach: { confidence: reApproachConfidence },
        quasiStationary: { confidence: quasiStationaryConfidence },
        forecastEdge: { confidence: forecastEdgeConfidence },
        agencyDisagreement: { confidence: agencyDisagreementConfidence },
        interpolationReliability: { confidence: interpolationReliabilityConfidence },
        windField: {
          confidence: windFieldConfidence,
          representativeWindMs,
          dataAgencyCount: windRadiusAgencyCount,
          latestCoverageAgencyCount: latestWindFieldCoverageCount,
          closestCoverageAgencyCount: closestWindFieldCoverageCount,
          latestStrongWindCoverageAgencyCount: latestStrongWindCoverageCount,
          closestStrongWindCoverageAgencyCount: closestStrongWindCoverageCount,
          latestGaleCoverageAgencyCount: latestGaleCoverageCount,
          closestGaleCoverageAgencyCount: closestGaleCoverageCount,
          strongWindCoverageFraction: Math.max(coverageFraction(latestStrongWindCoverageCount), coverageFraction(closestStrongWindCoverageCount)),
          galeCoverageFraction: Math.max(coverageFraction(latestGaleCoverageCount), coverageFraction(closestGaleCoverageCount))
        },
        rapidEvolution: {
          confidence: rapidEvolutionConfidence,
          checkpoint: fastestEvolution?.label ?? null
        }
      },
      timeline,
      agencies: agencyPatterns,
      semantics: {
        deterministic: true,
        hardThreatGateUsed: false,
        timeWeightingIsContinuous: true,
        timelineUsesOfficialValidTimes: true,
        crossAgencyInterpolationIsTransparent: true,
        interpolationGapAffectsConfidenceNotPhysicalThreat: true,
        interpolationReliabilityIsContinuous: true,
        pastCheckpointsExcludedFromForecastTimeline: true,
        fixedDayBucketsUsed: false,
        checkpointSpacingIsDecisionGate: false,
        officialHkoForecast: false,
        officialHkoDecisionInferred: false,
        aiGenerated: false
      }
    };
  }

  return Object.freeze({
    VERSION,
    SOFT_TIME_SCALE_HOURS,
    buildHkThreatAssessment
  });
});
