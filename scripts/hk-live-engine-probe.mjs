import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../analysis/storm-analysis-core.js');
const impactEngine = require('../analysis/hk-impact-engine.js');
const signalEngine = require('../analysis/hko-signal-risk-inputs.js');
const threatEngine = require('../analysis/hk-threat-assessment.js');
const basicEngine = require('../analysis/basic-hk-signal-forecast.js');

async function getText(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'Storm-Track-readonly-live-engine-probe/1.0' } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text;
}

function tag(body, name) {
  const match = String(body || '').match(new RegExp(`<${name}>([^<]*)<\\/${name}>`, 'i'));
  return match ? match[1].trim() : null;
}

function blocks(xml, name) {
  return [...String(xml || '').matchAll(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'gi'))].map(match => match[1]);
}

function coord(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^([0-9.]+)\s*([NSEW])$/i);
  if (!match) return Number(value);
  const number = Number(match[1]);
  return /[SW]/i.test(match[2]) ? -number : number;
}

function windRadii(level, values) {
  if (!Array.isArray(values) || values.length < 5) return [];
  return [{ level, ne: Number(values[1]), se: Number(values[2]), sw: Number(values[3]), nw: Number(values[4]) }];
}

function parseHko(xml) {
  const bulletinTime = tag(xml, 'BulletinTime');
  const past = blocks(xml, 'PastInformation').map(body => ({
    kind: 'past', time: tag(body, 'Time'), lat: coord(tag(body, 'Latitude')), lon: coord(tag(body, 'Longitude')),
    intensity: tag(body, 'Intensity'), maximumWind: tag(body, 'MaximumWind')
  })).filter(point => point.time && Number.isFinite(point.lat) && Number.isFinite(point.lon));
  const analysisBlock = blocks(xml, 'AnalysisInformation')[0];
  if (!analysisBlock) throw new Error('HKO analysis missing');
  const analysis = {
    kind: 'analysis', time: tag(analysisBlock, 'Time'), lat: coord(tag(analysisBlock, 'Latitude')), lon: coord(tag(analysisBlock, 'Longitude')),
    intensity: tag(analysisBlock, 'Intensity'), maximumWind: tag(analysisBlock, 'MaximumWind')
  };
  const analysisMs = Date.parse(analysis.time);
  const forecast = blocks(xml, 'ForecastInformation').map(body => {
    const index = Number(tag(body, 'Index'));
    const explicitTime = tag(body, 'Time');
    const time = explicitTime || (Number.isFinite(index) && Number.isFinite(analysisMs) ? new Date(analysisMs + index * 3600000).toISOString() : null);
    return {
      kind: 'forecast', time, baseTime: analysis.time, forecastHour: Number.isFinite(index) ? index : null,
      lat: coord(tag(body, 'Latitude')), lon: coord(tag(body, 'Longitude')),
      intensity: tag(body, 'Intensity'), maximumWind: tag(body, 'MaximumWind')
    };
  }).filter(point => point.time && Number.isFinite(point.lat) && Number.isFinite(point.lon));
  return { agency: 'HKO', sourceId: 'HKO-2629', bulletinTime, positions: [...past, analysis], forecast };
}

function parseJsonp(text) {
  let raw = String(text || '').trim().replace(/;\s*$/, '').trim();
  const candidates = ['{', '['].map(ch => raw.indexOf(ch)).filter(index => index >= 0);
  if (!candidates.length) throw new Error('JSONP payload has no JSON body');
  raw = raw.slice(Math.min(...candidates)).trim();
  while (raw.endsWith(')')) raw = raw.slice(0, -1).trim();
  return JSON.parse(raw);
}

function compactTime(value) {
  const text = String(value || '');
  const match = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00Z`;
}

function parseCma(detail) {
  const typhoon = detail?.typhoon;
  const analyses = Array.isArray(typhoon?.[8]) ? typhoon[8] : [];
  if (!analyses.length) throw new Error('CMA analyses missing');
  const latest = analyses[analyses.length - 1];
  const positions = analyses.slice(-8).map(row => ({
    kind: 'analysis', time: compactTime(row?.[1]), lon: Number(row?.[4]), lat: Number(row?.[5]),
    pressure: Number(row?.[6]), maximumWind: Number(row?.[7]), intensity: row?.[3],
    movingDirection: row?.[8], movingSpeed: Number(row?.[9]),
    windRadii: Array.isArray(row?.[10]) ? row[10].flatMap(item => windRadii(item?.[0], item)) : []
  })).filter(point => point.time && Number.isFinite(point.lat) && Number.isFinite(point.lon));
  const baseTime = compactTime(latest?.[1]);
  const forecasts = Array.isArray(latest?.[11]?.BABJ) ? latest[11].BABJ : [];
  const forecast = forecasts.map(row => ({
    kind: 'forecast', baseTime, forecastHour: Number(row?.[0]),
    time: Number.isFinite(Number(row?.[0])) ? new Date(Date.parse(baseTime) + Number(row[0]) * 3600000).toISOString() : null,
    lon: Number(row?.[2]), lat: Number(row?.[3]), pressure: Number(row?.[4]), maximumWind: Number(row?.[5]), intensity: row?.[7]
  })).filter(point => point.time && Number.isFinite(point.lat) && Number.isFinite(point.lon));
  return { agency: 'CMA', sourceId: String(typhoon?.[0] || 'CMA-NAMELESS'), bulletinTime: baseTime, positions, forecast };
}

function asArray(value) { return Array.isArray(value) ? value : value == null ? [] : [value]; }

function cwaCircle(level, circle) {
  if (!circle || typeof circle !== 'object') return null;
  const scalar = Number(circle.Radius) || 0;
  const values = { NE: scalar, SE: scalar, SW: scalar, NW: scalar };
  asArray(circle?.QuadrantRadii?.Radius).forEach(entry => {
    const dir = String(entry?.dir || '').toUpperCase();
    const value = Number(entry?.value);
    if (dir in values && Number.isFinite(value)) values[dir] = value;
  });
  return { level, ne: values.NE, se: values.SE, sw: values.SW, nw: values.NW };
}

function parseCwaCyclone(cyclone) {
  const positions = asArray(cyclone?.AnalysisData?.Fix).map(item => ({
    kind: 'analysis', time: item.DateTime, lon: Number(item.CoordinateLongitude), lat: Number(item.CoordinateLatitude),
    maximumWind: Number(item.MaxWindSpeed), maximumGust: Number(item.MaxGustSpeed), pressure: Number(item.Pressure),
    movingSpeed: Number(item.MovingSpeed), movingDirection: item.MovingDirection,
    windRadii: [cwaCircle('15 m/s', item.Circle15ms), cwaCircle('25 m/s', item.Circle25ms)].filter(Boolean)
  })).filter(point => point.time && Number.isFinite(point.lat) && Number.isFinite(point.lon));
  const forecast = asArray(cyclone?.ForecastData?.Fix).map(item => {
    const baseTime = item.InitialTime;
    const hour = Number(item.ForecastHour);
    return {
      kind: 'forecast', baseTime, forecastHour: hour,
      time: baseTime && Number.isFinite(hour) ? new Date(Date.parse(baseTime) + hour * 3600000).toISOString() : null,
      lon: Number(item.CoordinateLongitude), lat: Number(item.CoordinateLatitude), maximumWind: Number(item.MaxWindSpeed),
      maximumGust: Number(item.MaxGustSpeed), pressure: Number(item.Pressure), movingSpeed: Number(item.MovingSpeed), movingDirection: item.MovingDirection,
      windRadii: [cwaCircle('15 m/s', item.Circle15ms), cwaCircle('25 m/s', item.Circle25ms)].filter(Boolean)
    };
  }).filter(point => point.time && Number.isFinite(point.lat) && Number.isFinite(point.lon));
  return { agency: 'CWA', sourceId: `CWA-${cyclone?.CwaTdNo || 'unknown'}`, bulletinTime: forecast[0]?.baseTime || positions.at(-1)?.time, positions, forecast };
}

const hkoList = await getText('https://www.weather.gov.hk/wxinfo/currwx/tc_list.xml');
const hkoUrl = tag(blocks(hkoList, 'TropicalCyclone')[0], 'TropicalCycloneURL')?.replace(/^http:/, 'https:');
if (!hkoUrl) throw new Error('HKO active cyclone URL missing');
const hko = parseHko(await getText(hkoUrl));

const cmaList = parseJsonp(await getText(`https://typhoon.nmc.cn/weatherservice/typhoon/jsons/list_default?t=${Date.now()}&callback=storm_track_live_list`));
const cmaActive = (Array.isArray(cmaList?.typhoonList) ? cmaList.typhoonList : []).find(item => String(item?.[1] || '').toUpperCase() === 'NAMELESS' && String(item?.[7] || '').toLowerCase() === 'start');
if (!cmaActive) throw new Error('CMA nearby NAMELESS cyclone missing');
const cmaId = String(cmaActive[0]);
const cma = parseCma(parseJsonp(await getText(`https://typhoon.nmc.cn/weatherservice/typhoon/jsons/view_${cmaId}?t=${Date.now()}&callback=storm_track_live_${cmaId}`)));

const cwaJson = JSON.parse(await getText('https://storm.max-yu.workers.dev/api/cwa'));
const cwaCyclones = asArray(cwaJson?.records?.TropicalCyclones?.TropicalCyclone);
const cwaNearby = cwaCyclones.find(item => {
  const fixes = asArray(item?.AnalysisData?.Fix);
  const latest = fixes.at(-1);
  return Number(latest?.CoordinateLongitude) < 120 && Number(latest?.CoordinateLatitude) > 15;
});
if (!cwaNearby) throw new Error('CWA nearby cyclone missing');
const cwa = parseCwaCyclone(cwaNearby);

const allTimes = [hko.bulletinTime, cma.bulletinTime, cwa.bulletinTime, hko.positions.at(-1)?.time, cma.positions.at(-1)?.time, cwa.positions.at(-1)?.time]
  .map(Date.parse).filter(Number.isFinite);
const generatedAt = new Date(Math.max(...allTimes)).toISOString();
const group = {
  key: 'LIVE-HKO-2629', displayName: 'HKO 2629 live acceptance', nameTc: '熱帶風暴', nameEn: 'Tropical Storm',
  sources: { HKO: hko, CMA: cma, CWA: cwa }
};

const snapshot = core.buildStormAnalysisSnapshot(group, { generatedAt });
const impact = impactEngine.buildHongKongImpact(snapshot);
const signalInputs = signalEngine.buildHkoSignalRiskInputs(snapshot, impact, group);
const threatAssessment = threatEngine.buildHkThreatAssessment({ snapshot, impact, weightedImpact: null, signalInputs, generatedAt });
const forecast = basicEngine.buildBasicHkSignalForecast({ impact, weightedImpact: null, signalInputs, threatAssessment, generatedAt });

const sourceSummary = Object.fromEntries(['HKO','CMA','CWA'].map(agency => {
  const src = group.sources[agency];
  const current = src.positions.at(-1);
  return [agency, {
    bulletinTime: src.bulletinTime,
    current: current ? { time: current.time, lat: current.lat, lon: current.lon, wind: current.maximumWind } : null,
    forecastEnd: src.forecast.at(-1) ? { time: src.forecast.at(-1).time, lat: src.forecast.at(-1).lat, lon: src.forecast.at(-1).lon, wind: src.forecast.at(-1).maximumWind } : null,
    forecastCount: src.forecast.length
  }];
}));

console.log('LIVE_ENGINE_SOURCE_SUMMARY', JSON.stringify(sourceSummary));
console.log('LIVE_ENGINE_IMPACT', JSON.stringify({
  generatedAt,
  closestApproach: impact.closestApproach,
  trend: impact.trend,
  uncertainty: impact.uncertainty,
  distanceBands: Object.fromEntries(['800','500','400','300','200'].map(key => [key, impact.distanceBands?.[key] || null]))
}));
console.log('LIVE_ENGINE_SIGNAL_INPUTS', JSON.stringify({
  proximity: signalInputs.proximity,
  motion: signalInputs.motion,
  intensity: signalInputs.intensity,
  windField: signalInputs.windField,
  disagreement: signalInputs.disagreement,
  featureVector: signalInputs.featureVector
}));
console.log('LIVE_ENGINE_THREAT', JSON.stringify({ summary: threatAssessment.summary, analyzers: threatAssessment.analyzers }));
console.log('LIVE_ENGINE_FORECAST', JSON.stringify({ impact: forecast.impact, signals: forecast.signals, semantics: forecast.semantics }));
console.log('LIVE_ENGINE_TIMELINE', JSON.stringify(threatAssessment.timeline.map(item => ({
  label: item.label, time: item.validTime, leadHours: item.leadHours, distanceKm: item.distanceMedianKm,
  windMs: item.windMedianMs, threatIndex: item.threatIndex, approachRateKmh: item.approachRateKmh,
  supportAgencyCount: item.supportAgencyCount, exactOfficialSupportCount: item.exactOfficialSupportCount
}))));
