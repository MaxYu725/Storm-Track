'use strict';

const assert = require('node:assert/strict');
const threat = require('../analysis/hk-threat-assessment.js');
const basic = require('../analysis/basic-hk-signal-forecast.js');

const BASE = '2026-08-21T00:00:00.000Z';
const HK = { lat: 22.3023, lon: 114.1746 };
const HOUR_MS = 3600000;
const time = hours => new Date(Date.parse(BASE) + hours * HOUR_MS).toISOString();

function haversineKm(a, b) {
  const R = 6371.0088;
  const rad = value => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function sourceState(hour, variant = 'slow-tail') {
  let lon;
  if (variant === 'turn-away') {
    lon = hour <= 96 ? 124 - 0.055 * hour : 120.2;
  } else {
    lon = hour <= 48 ? 124 - (4.5 * hour / 48) : 119.5 - 0.006 * (hour - 48);
  }
  const wind = hour <= 48 ? 15 + 0.15 * hour : Math.max(18, 22.2 - 0.05 * (hour - 48));
  return { lat: 22.0, lon, wind };
}

function buildSnapshot(horizonHours, variant = 'slow-tail') {
  const offsets = {
    HKO: { lat: 0, lon: 0 },
    CMA: { lat: 0.08, lon: -0.05 },
    CWA: { lat: -0.06, lon: 0.06 }
  };
  const sources = {};
  for (const [agency, offset] of Object.entries(offsets)) {
    const current = sourceState(0, variant);
    const positions = [{
      time: BASE,
      lat: current.lat + offset.lat,
      lon: current.lon + offset.lon,
      maximumWind: current.wind,
      kind: 'analysis'
    }];
    const forecast = [];
    for (let hour = 12; hour <= horizonHours; hour += 12) {
      const state = sourceState(hour, variant);
      forecast.push({
        time: time(hour),
        lat: state.lat + offset.lat,
        lon: state.lon + offset.lon,
        maximumWind: state.wind,
        kind: 'forecast'
      });
    }
    sources[agency] = { state: 'ok', positions, forecast };
  }
  sources.JMA = { state: 'missing' };
  return { generatedAt: BASE, referencePoint: HK, sources };
}

function consensusAt(snapshot, hour) {
  const points = ['HKO', 'CMA', 'CWA'].map(agency => {
    if (hour === 0) return snapshot.sources[agency].positions[0];
    return snapshot.sources[agency].forecast.find(item => item.time === time(hour));
  }).filter(Boolean);
  return {
    lat: median(points.map(item => item.lat)),
    lon: median(points.map(item => item.lon))
  };
}

function closestHourFor(snapshot, horizonHours) {
  let best = null;
  for (let hour = 0; hour <= horizonHours; hour += 12) {
    const point = consensusAt(snapshot, hour);
    if (!point) continue;
    const distanceKm = haversineKm(HK, point);
    if (!best || distanceKm < best.distanceKm) best = { hour, distanceKm };
  }
  return best;
}

function signalInputs(snapshot, closestHour) {
  const currentDistances = ['HKO', 'CMA', 'CWA'].map(agency => haversineKm(HK, snapshot.sources[agency].positions[0]));
  const currentWinds = ['HKO', 'CMA', 'CWA'].map(agency => snapshot.sources[agency].positions[0].maximumWind);
  const closestWinds = ['HKO', 'CMA', 'CWA'].map(agency => {
    const point = closestHour === 0
      ? snapshot.sources[agency].positions[0]
      : snapshot.sources[agency].forecast.find(item => item.time === time(closestHour));
    return point?.maximumWind;
  }).filter(Number.isFinite);
  return {
    generatedAt: BASE,
    coverage: { usableAgencyCount: 3 },
    agencies: {},
    featureVector: {
      usableAgencyCount: 3,
      currentDistanceMedianKm: median(currentDistances),
      currentMaximumWindMedianMs: median(currentWinds),
      closestMaximumWindMedianMs: median(closestWinds),
      windRadiusAgencyCount: 0,
      latestWindFieldCoverageAgencyCount: 0,
      closestTimeWindFieldCoverageAgencyCount: 0,
      latestStrongWindFieldCoverageAgencyCount: 0,
      closestTimeStrongWindFieldCoverageAgencyCount: 0,
      latestGaleWindFieldCoverageAgencyCount: 0,
      closestTimeGaleWindFieldCoverageAgencyCount: 0,
      unknownThresholdWindFieldCoverageAgencyCount: 0
    }
  };
}

function run(horizonHours, variant = 'slow-tail') {
  const snapshot = buildSnapshot(horizonHours, variant);
  const closest = closestHourFor(snapshot, horizonHours);
  const impact = {
    generatedAt: BASE,
    uncertainty: { level: 'moderate' },
    closestApproach: {
      distanceRangeKm: { min: closest.distanceKm - 20, max: closest.distanceKm + 20 },
      agencyTimeWindow: { spanHours: 6 },
      consensus: {
        distanceKm: closest.distanceKm,
        time: time(closest.hour)
      }
    },
    distanceBands: {}
  };
  const inputs = signalInputs(snapshot, closest.hour);
  const assessment = threat.buildHkThreatAssessment({ snapshot, impact, signalInputs: inputs });
  const forecast = basic.buildBasicHkSignalForecast({
    generatedAt: BASE,
    impact,
    weightedImpact: null,
    signalInputs: inputs,
    threatAssessment: assessment
  });
  return { snapshot, closest, assessment, forecast };
}

function windowCenter(window) {
  return window ? (Date.parse(window.start) + Date.parse(window.end)) / 2 : null;
}

// Once a signal crossing exists inside the common part of the forecast, merely
// appending a longer, slowly evolving tail must not rewrite the current signal
// classification or materially move its issuance window.
{
  const h72 = run(72, 'slow-tail');
  const h96 = run(96, 'slow-tail');
  const h120 = run(120, 'slow-tail');

  assert.equal(h72.assessment.available, true);
  assert.ok(h72.assessment.analyzers.forecastEdge.confidence > 0.5);
  assert.equal(h72.forecast.signals.T1.likelihood, h96.forecast.signals.T1.likelihood, '72h vs 96h tail length changed T1 likelihood');
  assert.equal(h96.forecast.signals.T1.likelihood, h120.forecast.signals.T1.likelihood, '96h vs 120h tail length changed T1 likelihood');
  assert.notEqual(h72.forecast.signals.T1.likelihood, 'unlikely', 'fixture must contain an established T1 threat');
  assert.equal(h72.forecast.signals.T3.likelihood, h96.forecast.signals.T3.likelihood, '72h vs 96h tail length changed T3 likelihood');
  assert.equal(h96.forecast.signals.T3.likelihood, h120.forecast.signals.T3.likelihood, '96h vs 120h tail length changed T3 likelihood');
  assert.equal(h72.forecast.signals.T8.likelihood, h96.forecast.signals.T8.likelihood, '72h vs 96h tail length changed T8 likelihood');
  assert.equal(h96.forecast.signals.T8.likelihood, h120.forecast.signals.T8.likelihood, '96h vs 120h tail length changed T8 likelihood');

  const windows = [h72, h96, h120].map(item => item.forecast.signals.T1.estimatedWindow);
  assert.ok(windows.every(Boolean), 'established common-horizon T1 crossing should retain timing guidance');
  const centers = windows.map(windowCenter);
  const maxCenterSpreadHours = (Math.max(...centers) - Math.min(...centers)) / HOUR_MS;
  assert.ok(maxCenterSpreadHours <= 2, `tail extension moved established T1 timing by ${maxCenterSpreadHours.toFixed(2)}h`);
}

// A forecast that ends while the cyclone is still approaching is censored. If a
// later extension reveals the system turns away, the edge-warning/confidence
// should improve without pretending the truncated endpoint was the true closest.
{
  const truncated = run(96, 'turn-away');
  const extended = run(120, 'turn-away');

  assert.equal(truncated.closest.hour, 96, 'truncated fixture minimum should lie at its final forecast point');
  assert.equal(extended.closest.hour, 96, 'extended fixture should reveal the same point as an interior minimum');
  assert.ok(truncated.assessment.analyzers.forecastEdge.confidence > extended.assessment.analyzers.forecastEdge.confidence + 0.15,
    `forecast-edge confidence should drop after turn-away is observed; truncated=${truncated.assessment.analyzers.forecastEdge.confidence.toFixed(3)} extended=${extended.assessment.analyzers.forecastEdge.confidence.toFixed(3)}`);
  assert.equal(truncated.forecast.impact.forecastMinimumMayBeHorizonLimited, true, 'truncated approaching forecast must be marked horizon-limited');
  assert.ok(extended.forecast.impact.confidenceIndex >= truncated.forecast.impact.confidenceIndex,
    `observing the turn-away should not reduce confidence; truncated=${truncated.forecast.impact.confidenceIndex.toFixed(3)} extended=${extended.forecast.impact.confidenceIndex.toFixed(3)}`);
}

console.log('HK forecast horizon invariants: OK');
