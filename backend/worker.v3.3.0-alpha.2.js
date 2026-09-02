/**
 * Storm Track Worker v3.3.0-alpha.2
 *
 * 保留 v2.5 的 HKO/CMA/JMA/CWA 即時代理，並新增：
 * - D1 歷史風暴資料庫
 * - R2 原始公報保存
 * - 每 15 分鐘 scheduled() 收集器
 * - 手動收集、資料庫診斷與歷史 API
 *
 * 必要 bindings/secrets：
 * - DB            D1 database
 * - RAW_BUCKET    R2 bucket
 * - CWA_AUTHORIZATION (Secret)
 * - ADMIN_TOKEN       (Secret)
 */

const VERSION = '3.3.0-alpha.2';
const PARSER_VERSION = VERSION;
const EXPECTED_TABLES = [
  'schema_migrations', 'storms', 'storm_aliases', 'advisories',
  'track_points', 'wind_radii', 'collection_runs', 'identity_merges'
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
  'Access-Control-Max-Age': '86400'
};

const RULES = [
  {
    source: 'Hong Kong Observatory',
    hosts: new Set(['www.weather.gov.hk', 'www.hko.gov.hk', 'data.weather.gov.hk']),
    path: /^\/wxinfo\/currwx\/(?:tc_list|hko_tctrack_\d{4})\.xml$/i,
    accept: 'application/xml,text/xml,text/plain,*/*',
    contentType: 'application/xml; charset=utf-8',
    cacheTtl: 60
  },
  {
    source: 'China National Meteorological Center',
    hosts: new Set(['typhoon.nmc.cn']),
    path: /^\/weatherservice\/typhoon\/jsons\/(?:list_default|view_[A-Za-z0-9_-]+)(?:\.json)?$/i,
    accept: 'application/json,application/javascript,text/javascript,text/plain,*/*',
    contentType: 'application/javascript; charset=utf-8',
    cacheTtl: 90
  },
  {
    source: 'Japan Meteorological Agency Atom feed',
    hosts: new Set(['www.data.jma.go.jp']),
    path: /^\/developer\/xml\/feed\/(?:extra|extra_l)\.xml$/i,
    accept: 'application/atom+xml,application/xml,text/xml,text/plain,*/*',
    contentType: 'application/xml; charset=utf-8',
    cacheTtl: 60
  },
  {
    source: 'Japan Meteorological Agency typhoon XML',
    hosts: new Set(['www.data.jma.go.jp']),
    path: /^\/developer\/xml\/data\/[A-Za-z0-9_.-]*VPTW6[0-5][A-Za-z0-9_.-]*\.xml$/i,
    accept: 'application/xml,text/xml,text/plain,*/*',
    contentType: 'application/xml; charset=utf-8',
    cacheTtl: 180
  }
];

const HKO_LIST_URL = 'https://www.weather.gov.hk/wxinfo/currwx/tc_list.xml';
const NMC_LIST_URL = 'https://typhoon.nmc.cn/weatherservice/typhoon/jsons/list_default';
const JMA_FEED_URLS = [
  'https://www.data.jma.go.jp/developer/xml/feed/extra_l.xml',
  'https://www.data.jma.go.jp/developer/xml/feed/extra.xml'
];
const CWA_DATASET_ID = 'W-C0034-005';
const CWA_API_URL = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${CWA_DATASET_ID}?format=JSON`;

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    }
  });
}

function nowIso() { return new Date().toISOString(); }
function asArray(value) { return Array.isArray(value) ? value : (value == null ? [] : [value]); }
function finiteNumber(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}
function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
function truncateText(value, maxLength = 1000) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
function safeSegment(value, fallback = 'unknown') {
  const text = String(value || '').trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return (text || fallback).slice(0, 100);
}
function normalizeName(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9\u3400-\u9fff]/g, '');
}
function normalizeInternationalNumber(value, year) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return null;
  const fullYear = String(Number(year) || '').padStart(4, '0');
  const shortYear = fullYear.slice(-2);
  let number = null;
  if (digits.length <= 2) number = digits;
  else if (digits.length === 4 && digits.slice(0, 2) === shortYear) number = digits.slice(-2);
  else if (digits.length >= 6 && digits.slice(0, 4) === fullYear) number = digits.slice(-2);
  else if (digits.length > 2 && digits.slice(0, 2) === shortYear) number = digits.slice(-2);
  if (number == null) return null;
  const parsed = Number.parseInt(number, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 99) return null;
  return String(parsed).padStart(2, '0');
}
function canonicalStormId(year, internationalNumber) {
  const normalized = normalizeInternationalNumber(internationalNumber, year);
  return normalized ? `WP-${Number(year)}-${normalized}` : null;
}
function haversineKm(lat1, lon1, lat2, lon2) {
  const values = [lat1, lon1, lat2, lon2].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [aLat, aLon, bLat, bLon] = values.map(value => value * Math.PI / 180);
  const dLat = bLat - aLat;
  const dLon = bLon - aLon;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat) * Math.cos(bLat) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function isGenericName(value) {
  const normalized = normalizeName(value);
  return !normalized || /^(UNNAMED|TROPICALDEPRESSION|熱帶低氣壓|熱帶氣旋|未命名熱帶氣旋|台風第\d+號|颱風第\d+號)$/.test(normalized);
}
function normalizeIsoTime(value, assumeUtc = true) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^\d{12,14}$/.test(raw.replace(/\D/g, ''))) {
    const digits = raw.replace(/\D/g, '');
    const iso = `${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6,8)}T${digits.slice(8,10)}:${digits.slice(10,12)}:${digits.length >= 14 ? digits.slice(12,14) : '00'}Z`;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  let candidate = raw.replace(' ', 'T');
  if (assumeUtc && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(candidate)) candidate += 'Z';
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function addHoursIso(baseTime, hoursValue) {
  const base = new Date(baseTime);
  const hours = Number(hoursValue);
  if (!baseTime || Number.isNaN(base.getTime()) || !Number.isFinite(hours)) return baseTime || null;
  return new Date(base.getTime() + hours * 3600000).toISOString();
}
function yearFromTime(value, fallback = new Date().getUTCFullYear()) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.getUTCFullYear();
}
function compactTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? safeSegment(value) : date.toISOString().replace(/[-:.]/g, '').replace('Z', 'Z');
}
function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function stripTags(value) { return decodeXml(String(value || '').replace(/<[^>]*>/g, '')).trim(); }
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function xmlBlocks(xml, localName) {
  const name = escapeRegExp(localName);
  const re = new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>[\\s\\S]*?<\\/(?:(?:[\\w.-]+):)?${name}>`, 'gi');
  return String(xml || '').match(re) || [];
}
function xmlNode(xml, localName) {
  const name = escapeRegExp(localName);
  const re = new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b([^>]*)>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`, 'i');
  const match = String(xml || '').match(re);
  return match ? { attrs: match[1] || '', inner: match[2] || '', text: stripTags(match[2] || '') } : null;
}
function xmlText(xml, localName) { return xmlNode(xml, localName)?.text || ''; }
function xmlAttr(attrs, name) {
  const match = String(attrs || '').match(new RegExp(`\\b${escapeRegExp(name)}=["']([^"']*)["']`, 'i'));
  return decodeXml(match?.[1] || '');
}
function xmlNodes(xml, localName) {
  const name = escapeRegExp(localName);
  const re = new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b([^>]*)>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${name}>`, 'gi');
  const output = [];
  let match;
  while ((match = re.exec(String(xml || ''))) !== null) {
    output.push({ attrs: match[1] || '', inner: match[2] || '', text: stripTags(match[2] || '') });
  }
  return output;
}

async function sha256Hex(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function deterministicId(prefix, ...parts) {
  const hash = await sha256Hex(parts.map(part => String(part ?? '')).join('|'));
  return `${prefix}-${hash.slice(0, 24)}`;
}
function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left || ''));
  const b = new TextEncoder().encode(String(right || ''));
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) diff |= (a[index % (a.length || 1)] || 0) ^ (b[index % (b.length || 1)] || 0);
  return diff === 0;
}

function matchRule(target) {
  return RULES.find(rule => rule.hosts.has(target.hostname) && rule.path.test(target.pathname));
}
function sanitizeTarget(target) {
  target.protocol = 'https:';
  target.username = '';
  target.password = '';
  target.hash = '';
  target.port = '';
  if (target.hostname === 'typhoon.nmc.cn') {
    const timestamp = target.searchParams.get('t');
    const callback = target.searchParams.get('callback');
    target.search = '';
    if (timestamp && /^\d{10,16}$/.test(timestamp)) target.searchParams.set('t', timestamp);
    if (callback && /^[A-Za-z_$][\w$]{0,100}$/.test(callback)) target.searchParams.set('callback', callback);
  } else {
    target.search = '';
  }
  return target;
}
function candidateUrls(target) {
  if (target.hostname !== 'typhoon.nmc.cn') return [target.toString()];
  const urls = [new URL(target.toString())];
  const alternate = new URL(target.toString());
  alternate.pathname = alternate.pathname.endsWith('.json') ? alternate.pathname.slice(0, -5) : `${alternate.pathname}.json`;
  urls.push(alternate);
  return [...new Set(urls.map(url => url.toString()))];
}
function upstreamHeaders(target, rule) {
  const headers = {
    Accept: rule.accept,
    'User-Agent': target.hostname === 'typhoon.nmc.cn'
      ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0 Safari/537.36'
      : `Storm-Track-Collector/${VERSION}`,
    'Accept-Language': target.hostname === 'www.data.jma.go.jp' ? 'ja,en;q=0.8,zh-HK;q=0.6' : 'zh-CN,zh;q=0.9,zh-HK;q=0.8,en;q=0.7'
  };
  if (target.hostname === 'typhoon.nmc.cn') {
    headers.Referer = 'https://typhoon.nmc.cn/web.html';
    headers['Cache-Control'] = 'no-cache';
    headers.Pragma = 'no-cache';
  }
  return headers;
}
function looksLikeChallenge(text) {
  const sample = String(text || '').slice(0, 1200).toLowerCase();
  return sample.includes('<html') && (
    sample.includes('captcha') || sample.includes('access denied') || sample.includes('forbidden') ||
    sample.includes('challenge') || sample.includes('安全验证') || sample.includes('访问验证')
  );
}
async function fetchAllowedTarget(target, rule) {
  const attempts = [];
  for (const url of candidateUrls(target)) {
    try {
      const response = await fetch(url, {
        method: 'GET', headers: upstreamHeaders(new URL(url), rule), redirect: 'follow',
        cf: { cacheEverything: true, cacheTtl: rule.cacheTtl }
      });
      const body = await response.arrayBuffer();
      const text = new TextDecoder().decode(body);
      attempts.push({ url, status: response.status, preview: truncateText(text, 300) });
      if (!response.ok || looksLikeChallenge(text)) continue;
      if (target.hostname === 'typhoon.nmc.cn' && !text.includes('{') && !text.includes('[')) continue;
      if (target.hostname === 'www.data.jma.go.jp' && !text.trimStart().startsWith('<')) continue;
      return { ok: true, url, response, body, text, attempts };
    } catch (error) {
      attempts.push({ url, status: 0, preview: String(error?.message || error) });
    }
  }
  return { ok: false, attempts };
}
function parseWrappedJson(text) {
  const trimmed = String(text || '').replace(/^\uFEFF/, '').trim();
  const candidates = [trimmed];
  const firstParen = trimmed.indexOf('(');
  const lastParen = trimmed.lastIndexOf(')');
  if (firstParen !== -1 && lastParen > firstParen) {
    let inner = trimmed.slice(firstParen + 1, lastParen).trim();
    candidates.push(inner);
    while (inner.startsWith('(') && inner.endsWith(')')) {
      inner = inner.slice(1, -1).trim();
      candidates.push(inner);
    }
  }
  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd > objectStart) candidates.push(trimmed.slice(objectStart, objectEnd + 1));
  const arrayStart = trimmed.indexOf('[');
  const arrayEnd = trimmed.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd > arrayStart) candidates.push(trimmed.slice(arrayStart, arrayEnd + 1));
  for (const candidate of [...new Set(candidates)]) {
    try { return JSON.parse(candidate); } catch {}
  }
  throw new Error('Unable to parse JSON/JSONP wrapper');
}

function parseCoordinate(value, axis) {
  if (!value) return null;
  const cleaned = String(value).trim().toUpperCase();
  const number = Number.parseFloat(cleaned.replace(/[^0-9.+-]/g, ''));
  if (!Number.isFinite(number)) return null;
  if ((axis === 'lat' && cleaned.endsWith('S')) || (axis === 'lon' && cleaned.endsWith('W'))) return -number;
  return number;
}
function classifyWindIntensity(value) {
  const wind = finiteNumber(value);
  if (wind == null) return null;
  if (wind >= 51) return 'SuperTY';
  if (wind >= 41.5) return 'STY';
  if (wind >= 32.7) return 'TY';
  if (wind >= 24.5) return 'STS';
  if (wind >= 17.2) return 'TS';
  return 'TD';
}
function intensityLabel(value) {
  const v = String(value || '').trim();
  const lower = v.toLowerCase();
  if (lower === 'superty' || lower.includes('super typhoon') || v.includes('超強') || v.includes('超强') || v.includes('猛烈な')) return '超強颱風';
  if (lower === 'sty' || lower.includes('severe typhoon') || v.includes('強颱風') || v.includes('强台风') || v.includes('非常に強い')) return '強颱風';
  if (lower === 'ty' || lower.includes('typhoon') || v.includes('颱風') || v.includes('台风') || v.includes('台風') || v === '強い') return '颱風';
  if (lower === 'sts' || lower.includes('severe tropical storm') || v.includes('強烈熱帶風暴') || v.includes('强热带风暴')) return '強烈熱帶風暴';
  if (lower === 'ts' || lower.includes('tropical storm') || v.includes('熱帶風暴') || v.includes('热带风暴')) return '熱帶風暴';
  if (lower === 'td' || lower.includes('tropical depression') || v.includes('熱帶低氣壓') || v.includes('热带低压') || v.includes('熱帯低気圧')) return '熱帶低氣壓';
  return v || null;
}
function normalizePoint(point, type, order) {
  const lat = finiteNumber(point.lat);
  const lon = finiteNumber(point.lon);
  const validAt = normalizeIsoTime(point.time, true);
  if (lat == null || lon == null || !validAt) return null;
  const rawIntensity = point.intensity || classifyWindIntensity(point.maximumWind);
  return {
    pointType: type,
    validAt,
    forecastHour: type === 'forecast' && Number.isFinite(Number(point.forecastHour)) ? Number(point.forecastHour) : null,
    latitude: lat,
    longitude: lon,
    pressureHpa: finiteNumber(point.pressure),
    windMs: finiteNumber(point.maximumWind),
    gustMs: finiteNumber(point.maximumGust),
    windAveragingMinutes: Number.isFinite(Number(point.windAveragingMinutes)) ? Number(point.windAveragingMinutes) : null,
    intensityCode: rawIntensity ? String(rawIntensity) : null,
    intensityLabel: intensityLabel(rawIntensity),
    movementDirection: point.movingDirection ? String(point.movingDirection) : null,
    movementSpeedKmh: finiteNumber(point.movingSpeed),
    probabilityRadiusKm: finiteNumber(point.probabilityRadius),
    sourceOrder: order,
    windRadii: asArray(point.windRadii).map(radius => ({
      thresholdCode: String(radius.thresholdCode || radius.level || 'unknown'),
      thresholdMs: finiteNumber(radius.thresholdMs),
      ne: finiteNumber(radius.ne), se: finiteNumber(radius.se),
      sw: finiteNumber(radius.sw), nw: finiteNumber(radius.nw)
    })).filter(radius => radius.thresholdCode)
  };
}
function makeCollectedStorm(data) {
  const analysis = asArray(data.positions).map((point, index) => normalizePoint(point, 'analysis', index)).filter(Boolean);
  const forecast = asArray(data.forecast).map((point, index) => normalizePoint(point, 'forecast', analysis.length + index)).filter(Boolean);
  if (!analysis.length && !forecast.length) return null;
  const issuedAt = normalizeIsoTime(data.bulletinTime || forecast[0]?.validAt || analysis.at(-1)?.validAt, true);
  if (!issuedAt) return null;
  forecast.forEach(point => {
    if (point.forecastHour == null) {
      const hours = Math.round((new Date(point.validAt).getTime() - new Date(issuedAt).getTime()) / 3600000);
      point.forecastHour = Number.isFinite(hours) ? hours : null;
    }
  });
  const year = Number(data.year) || yearFromTime(issuedAt);
  return {
    agency: data.agency,
    sourceId: String(data.sourceId || '').trim() || `${data.agency}-${year}`,
    sourceCode: data.sourceCode || null,
    sourceUrl: data.sourceUrl || null,
    nameEn: String(data.nameEn || '').trim(),
    nameZh: String(data.nameZh || data.nameTc || '').trim(),
    year,
    internationalNumber: normalizeInternationalNumber(data.internationalNumber, year),
    issuedAt,
    points: [...analysis, ...forecast],
    rawText: data.rawText || '',
    rawContentType: data.rawContentType || 'text/plain; charset=utf-8',
    rawExtension: data.rawExtension || 'txt'
  };
}

function parseCycloneList(xmlText) {
  return xmlBlocks(xmlText, 'TropicalCyclone').map(block => ({
    id: xmlTextValue(block, 'TropicalCycloneID'),
    nameZh: xmlTextValue(block, 'TropicalCycloneChineseName'),
    nameEn: xmlTextValue(block, 'TropicalCycloneEnglishName'),
    url: xmlTextValue(block, 'TropicalCycloneURL')
  })).filter(item => item.url);
}
function xmlTextValue(xml, localName) { return xmlText(xml, localName); }
function normalizeHkoUrl(rawUrl) {
  const url = new URL(rawUrl, HKO_LIST_URL);
  url.protocol = 'https:';
  if (!new Set(['www.weather.gov.hk', 'www.hko.gov.hk', 'data.weather.gov.hk']).has(url.hostname)) throw new Error('HKO URL not allowed');
  if (!/^\/wxinfo\/currwx\/hko_tctrack_\d{4}\.xml$/i.test(url.pathname)) throw new Error('Unexpected HKO track URL');
  url.search = '';
  url.hash = '';
  return url.toString();
}
function parseHkoPoint(block) {
  const lat = parseCoordinate(xmlText(block, 'Latitude'), 'lat');
  const lon = parseCoordinate(xmlText(block, 'Longitude'), 'lon');
  if (lat == null || lon == null) return null;
  return {
    lat, lon,
    time: xmlText(block, 'Time'),
    intensity: xmlText(block, 'Intensity') || null,
    maximumWind: xmlText(block, 'MaximumWind') || null,
    pressure: xmlText(block, 'CentralPressure') || null
  };
}
function inferInternationalNumber(sourceId, year) {
  const digits = String(sourceId || '').replace(/\D/g, '');
  if (digits.length >= 6 && Number(digits.slice(0, 4)) === Number(year)) return digits.slice(-2);
  if (digits.length === 4 && Number(`20${digits.slice(0,2)}`) === Number(year)) return digits.slice(-2);
  return null;
}
function parseHkoTrackXml(xmlTextValueRaw, reference, sourceUrl) {
  const bulletinTime = xmlText(xmlTextValueRaw, 'BulletinTime');
  const reportName = xmlText(xmlTextValueRaw, 'TropicalCycloneName');
  const past = xmlBlocks(xmlTextValueRaw, 'PastInformation').map(parseHkoPoint).filter(Boolean);
  const analysis = xmlBlocks(xmlTextValueRaw, 'AnalysisInformation').map(parseHkoPoint).filter(Boolean);
  const forecast = xmlBlocks(xmlTextValueRaw, 'ForecastInformation').map(parseHkoPoint).filter(Boolean);
  const year = yearFromTime(normalizeIsoTime(bulletinTime, true));
  return makeCollectedStorm({
    agency: 'HKO', sourceId: reference.id || reportName, sourceCode: reference.id || null,
    sourceUrl, nameZh: reference.nameZh || '', nameEn: reference.nameEn || reportName || '',
    year, internationalNumber: null, bulletinTime,
    positions: [...past, ...analysis], forecast,
    rawText: xmlTextValueRaw, rawContentType: 'application/xml; charset=utf-8', rawExtension: 'xml'
  });
}

function latestForecastContainer(stormInfo) {
  const history = Array.isArray(stormInfo?.[8]) ? stormInfo[8] : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const container = history[index]?.[11];
    if (container && typeof container === 'object' && !Array.isArray(container) && Object.keys(container).length) return { point: history[index], container };
  }
  return { point: null, container: {} };
}
function normalizeNmcTime(value) { return normalizeIsoTime(value, true); }
function parseNmcWindRadii(value) {
  return asArray(value).map(item => {
    if (!Array.isArray(item)) return null;
    return {
      thresholdCode: String(item[0] || 'unknown'), thresholdMs: null,
      ne: finiteNumber(item[1]), se: finiteNumber(item[2]), sw: finiteNumber(item[3]), nw: finiteNumber(item[4])
    };
  }).filter(Boolean);
}
function parseNmcHistoryPoint(point) {
  if (!Array.isArray(point)) return null;
  const lon = finiteNumber(point[4]);
  const lat = finiteNumber(point[5]);
  if (lat == null || lon == null) return null;
  return {
    lat, lon, time: normalizeNmcTime(point[1]), pressure: point[6], maximumWind: point[7],
    intensity: point[3], windRadii: parseNmcWindRadii(point[10])
  };
}
function parseNmcForecastPoint(point) {
  if (!Array.isArray(point)) return null;
  const lon = finiteNumber(point[2]);
  const lat = finiteNumber(point[3]);
  if (lat == null || lon == null) return null;
  const baseTime = normalizeNmcTime(point[1]);
  return {
    forecastHour: Number(point[0]), lat, lon, time: addHoursIso(baseTime, point[0]),
    pressure: point[4], maximumWind: point[5], intensity: point[7]
  };
}
function parseNmcAgencyTrack(detailData, reference, rawText, sourceUrl) {
  const stormInfo = detailData?.typhoon;
  if (!Array.isArray(stormInfo)) return null;
  const history = Array.isArray(stormInfo[8]) ? stormInfo[8] : [];
  const positions = history.map(parseNmcHistoryPoint).filter(Boolean);
  let forecastSource = null;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const container = history[index]?.[11];
    if (!container || typeof container !== 'object' || Array.isArray(container)) continue;
    const key = Object.keys(container).find(item => item.toUpperCase() === 'BABJ');
    if (key && Array.isArray(container[key]) && container[key].length) {
      forecastSource = { basePoint: history[index], points: container[key] };
      break;
    }
  }
  const forecast = asArray(forecastSource?.points).map(parseNmcForecastPoint).filter(Boolean);
  if (!positions.length && !forecast.length) return null;
  const bulletinTime = normalizeNmcTime(forecastSource?.basePoint?.[1] || positions.at(-1)?.time);
  const year = yearFromTime(bulletinTime);
  return makeCollectedStorm({
    agency: 'CMA', sourceId: reference.id, sourceCode: reference.id, sourceUrl,
    nameZh: reference.nameZh, nameEn: reference.nameEn, year,
    internationalNumber: (() => {
      const number = String(stormInfo[3] || stormInfo[4] || '').replace(/\D/g, '');
      return number.length >= 2 ? number.slice(-2) : inferInternationalNumber(reference.id, year);
    })(), bulletinTime,
    positions, forecast, rawText, rawContentType: 'application/javascript; charset=utf-8', rawExtension: 'jsonp'
  });
}

function localizedText(value) {
  const items = asArray(value);
  const preferred = items.find(item => String(item?.lang || '').toLowerCase().startsWith('zh')) || items[0];
  return preferred && typeof preferred === 'object' ? String(preferred.value || '').trim() : String(preferred || '').trim();
}
function parseCwaWindRadii(item) {
  return [['15 m/s', 15, item?.Circle15ms], ['25 m/s', 25, item?.Circle25ms]].map(([code, thresholdMs, circle]) => {
    if (!circle || typeof circle !== 'object') return null;
    const scalar = finiteNumber(circle.Radius) || 0;
    const values = { NE: scalar, SE: scalar, SW: scalar, NW: scalar };
    asArray(circle?.QuadrantRadii?.Radius).forEach(entry => {
      const direction = String(entry?.dir || '').toUpperCase();
      const value = finiteNumber(entry?.value);
      if (direction in values && value != null) values[direction] = value;
    });
    return { thresholdCode: code, thresholdMs, ne: values.NE, se: values.SE, sw: values.SW, nw: values.NW };
  }).filter(Boolean);
}
function parseCwaPoint(item, isForecast) {
  if (!item || typeof item !== 'object') return null;
  const lon = finiteNumber(item.CoordinateLongitude);
  const lat = finiteNumber(item.CoordinateLatitude);
  if (lat == null || lon == null) return null;
  const forecastHour = isForecast ? Number(item.ForecastHour) : null;
  const baseTime = isForecast ? normalizeIsoTime(item.InitialTime, false) : null;
  return {
    lat, lon, baseTime,
    time: isForecast ? addHoursIso(baseTime, forecastHour) : normalizeIsoTime(item.DateTime, false),
    forecastHour,
    maximumWind: item.MaxWindSpeed,
    maximumGust: item.MaxGustSpeed,
    pressure: item.Pressure,
    intensity: classifyWindIntensity(item.MaxWindSpeed),
    movingSpeed: item.MovingSpeed,
    movingDirection: item.MovingDirection,
    probabilityRadius: item.Radius70PercentProbability,
    windRadii: parseCwaWindRadii(item),
    movementPrediction: localizedText(item.MovingPrediction),
    stateTransfer: localizedText(item.StateTransfer)
  };
}
function parseCwaTrack(cyclone, rawText) {
  const positions = asArray(cyclone?.AnalysisData?.Fix).map(item => parseCwaPoint(item, false)).filter(Boolean);
  const forecast = asArray(cyclone?.ForecastData?.Fix).map(item => parseCwaPoint(item, true)).filter(Boolean);
  if (!positions.length && !forecast.length) return null;
  const tdNo = String(cyclone.CwaTdNo || '').trim();
  const tyNo = String(cyclone.CwaTyNo || '').trim();
  const year = Number(cyclone.Year) || yearFromTime(forecast[0]?.time || positions.at(-1)?.time);
  const sourceId = `${year}-${tyNo || `TD${tdNo}` || cyclone.TyphoonName || 'unknown'}`;
  return makeCollectedStorm({
    agency: 'CWA', sourceId, sourceCode: tyNo || tdNo || null, sourceUrl: CWA_API_URL,
    nameZh: String(cyclone.CwaTyphoonName || '').trim() || (tdNo ? `熱帶低氣壓 ${tdNo}` : '未命名熱帶氣旋'),
    nameEn: String(cyclone.TyphoonName || '').trim(), year, internationalNumber: tyNo || null,
    bulletinTime: normalizeIsoTime(cyclone?.ForecastData?.Fix?.[0]?.InitialTime || asArray(cyclone?.ForecastData?.Fix)?.[0]?.InitialTime || positions.at(-1)?.time, false),
    positions, forecast, rawText, rawContentType: 'application/json; charset=utf-8', rawExtension: 'json'
  });
}

function extractJmaFeedCandidates(feedText) {
  const candidates = [];
  const seen = new Set();
  for (const entry of xmlBlocks(feedText, 'entry')) {
    const title = xmlText(entry, 'title');
    const updated = xmlText(entry, 'updated');
    const linkMatch = entry.match(/<(?:(?:[\w.-]+):)?link\b[^>]*href=["']([^"']+)["'][^>]*\/?>(?:<\/(?:(?:[\w.-]+):)?link>)?/i);
    const href = decodeXml(linkMatch?.[1] || '');
    const match = href.match(/_VPTW(6[0-5])_/i);
    if (!href || !match) continue;
    if (!title.includes('台風解析・予報情報') && !href.toUpperCase().includes('VPTW')) continue;
    const code = `VPTW${match[1]}`.toUpperCase();
    if (seen.has(code)) continue;
    seen.add(code);
    candidates.push({ code, title, updated, href });
    if (candidates.length >= 6) break;
  }
  return candidates;
}
function normalizeJmaAreaName(value) {
  return String(value || '').trim()
    .replace(/熱帯低気圧/g, '熱帶低氣壓')
    .replace(/台風第\s*(\d+)\s*号/g, '颱風第$1號');
}
function isJmaAnalysisTimeType(value) { return String(value || '').includes('実況'); }
function parseJmaCoordinate(value, type = '') {
  const raw = String(value || '').trim().replace(/\/$/, '');
  const match = raw.match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const convert = (token, axis) => {
    const sign = token.startsWith('-') ? -1 : 1;
    const body = token.slice(1);
    if (type.includes('度分') && !body.includes('.')) {
      const degreeDigits = axis === 'lat' ? 2 : 3;
      const degrees = Number(body.slice(0, degreeDigits));
      const minutes = Number(body.slice(degreeDigits));
      return sign * (degrees + minutes / 60);
    }
    return sign * Number(body);
  };
  const lat = convert(match[1], 'lat');
  const lon = convert(match[2], 'lon');
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}
function pickJmaNode(nodes) {
  return nodes.find(node => xmlAttr(node.attrs, 'type').includes('中心位置') && !xmlAttr(node.attrs, 'type').includes('度分'))
    || nodes.find(node => !xmlAttr(node.attrs, 'type').includes('度分'))
    || nodes[0]
    || null;
}
function selectJmaCoordinate(infoBlock, timeType) {
  const forecast = !isJmaAnalysisTimeType(timeType);
  if (forecast) {
    const probability = xmlNode(infoBlock, 'ProbabilityCircle');
    const basePoint = probability ? pickJmaNode(xmlNodes(probability.inner, 'BasePoint')) : null;
    if (basePoint) return parseJmaCoordinate(basePoint.text, xmlAttr(basePoint.attrs, 'type'));
  }
  const centerPart = xmlNode(infoBlock, 'CenterPart');
  const coordinate = pickJmaNode(xmlNodes(centerPart?.inner || infoBlock, 'Coordinate'));
  if (coordinate) return parseJmaCoordinate(coordinate.text, xmlAttr(coordinate.attrs, 'type'));
  const fallback = pickJmaNode([...xmlNodes(infoBlock, 'BasePoint'), ...xmlNodes(infoBlock, 'Coordinate')]);
  return fallback ? parseJmaCoordinate(fallback.text, xmlAttr(fallback.attrs, 'type')) : null;
}
function parseJmaMaximumWind(infoBlock) {
  const nodes = xmlNodes(infoBlock, 'WindSpeed');
  const maximum = nodes.find(node => xmlAttr(node.attrs, 'type').includes('最大風速') && /m\/s|メートル毎秒/i.test(xmlAttr(node.attrs, 'unit')))
    || nodes.find(node => xmlAttr(node.attrs, 'type').includes('最大風速'))
    || nodes[0];
  return finiteNumber(maximum?.text);
}
function parseJmaForecastRadius(infoBlock) {
  const circle = xmlNode(infoBlock, 'ProbabilityCircle');
  return finiteNumber(xmlText(circle?.inner || '', 'Radius'));
}
function parseJmaTrackXml(xmlTextValueRaw, candidate) {
  const eventId = xmlText(xmlNode(xmlTextValueRaw, 'Head')?.inner || xmlTextValueRaw, 'EventID') || candidate.code;
  const bulletinTime = xmlText(xmlNode(xmlTextValueRaw, 'Head')?.inner || xmlTextValueRaw, 'ReportDateTime') || candidate.updated;
  const documentNamePart = xmlNode(xmlTextValueRaw, 'TyphoonNamePart');
  let nameEn = xmlText(documentNamePart?.inner || '', 'Name').toUpperCase();
  let number = xmlText(documentNamePart?.inner || '', 'Number');
  let nameZh = '';
  const positions = [];
  const forecast = [];
  for (const info of xmlBlocks(xmlTextValueRaw, 'MeteorologicalInfo')) {
    const dateNode = xmlNode(info, 'DateTime');
    const time = normalizeIsoTime(dateNode?.text, false);
    const timeType = xmlAttr(dateNode?.attrs, 'type');
    const coordinate = selectJmaCoordinate(info, timeType);
    if (!time || !coordinate) continue;
    const namePart = xmlNode(info, 'TyphoonNamePart');
    if (!nameEn) nameEn = xmlText(namePart?.inner || '', 'Name').toUpperCase();
    if (!number) number = xmlText(namePart?.inner || '', 'Number');
    if (!nameZh) nameZh = normalizeJmaAreaName(xmlText(xmlNode(info, 'Area')?.inner || '', 'Name'));
    const maximumWind = parseJmaMaximumWind(info);
    const intensity = xmlText(info, 'IntensityClass') || xmlText(info, 'StormClass') || xmlText(info, 'TropicalCycloneClass') || classifyWindIntensity(maximumWind);
    const point = {
      lat: coordinate.lat, lon: coordinate.lon, time,
      pressure: finiteNumber(xmlText(info, 'Pressure')),
      maximumWind, intensity,
      probabilityRadius: parseJmaForecastRadius(info)
    };
    if (isJmaAnalysisTimeType(timeType)) positions.push(point);
    else forecast.push(point);
  }
  const year = yearFromTime(bulletinTime);
  return makeCollectedStorm({
    agency: 'JMA', sourceId: eventId || number || candidate.code, sourceCode: candidate.code,
    sourceUrl: candidate.href, nameZh, nameEn: nameEn || eventId || candidate.code,
    year, internationalNumber: number || inferInternationalNumber(eventId, year), bulletinTime,
    positions: positions.slice(-1), forecast,
    rawText: xmlTextValueRaw, rawContentType: 'application/xml; charset=utf-8', rawExtension: 'xml'
  });
}

function getCwaAuthorization(env) { return String(env?.CWA_AUTHORIZATION || '').trim(); }
async function fetchCwaData(env) {
  const authorization = getCwaAuthorization(env);
  if (!authorization) throw new Error('CWA_AUTHORIZATION is not configured');
  const response = await fetch(CWA_API_URL, {
    method: 'GET', redirect: 'follow',
    headers: { Authorization: authorization, Accept: 'application/json', 'User-Agent': `Storm-Track-Collector/${VERSION}` },
    cf: { cacheEverything: true, cacheTtl: 180 }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`CWA HTTP ${response.status}: ${truncateText(text, 200)}`);
  const data = JSON.parse(text);
  if (String(data?.success).toLowerCase() === 'false') throw new Error('CWA API reported failure');
  return { text, data, status: response.status, contentType: response.headers.get('content-type') || 'application/json' };
}

async function collectHko() {
  const listTarget = new URL(HKO_LIST_URL);
  const listResult = await fetchAllowedTarget(listTarget, matchRule(listTarget));
  if (!listResult.ok) throw new Error(`HKO list failed: ${JSON.stringify(listResult.attempts)}`);
  const references = parseCycloneList(listResult.text);
  const rawDocuments = [{ agency: 'HKO', sourceId: '_index', issuedAt: nowIso(), url: HKO_LIST_URL, text: listResult.text, contentType: 'application/xml; charset=utf-8', extension: 'xml' }];
  if (!references.length) return { agency: 'HKO', storms: [], rawDocuments };
  const results = await Promise.allSettled(references.map(async reference => {
    const sourceUrl = normalizeHkoUrl(reference.url);
    const target = new URL(sourceUrl);
    const result = await fetchAllowedTarget(target, matchRule(target));
    if (!result.ok) throw new Error(`${reference.id || reference.nameEn}: HKO track failed`);
    return parseHkoTrackXml(result.text, reference, sourceUrl);
  }));
  const storms = results.filter(result => result.status === 'fulfilled' && result.value).map(result => result.value);
  if (!storms.length && results.some(result => result.status === 'rejected')) throw results.find(result => result.status === 'rejected').reason;
  return { agency: 'HKO', storms, rawDocuments };
}

async function collectCma() {
  const listTarget = new URL(NMC_LIST_URL);
  listTarget.searchParams.set('t', String(Date.now()));
  listTarget.searchParams.set('callback', 'typhoon_jsons_list_default');
  const listResult = await fetchAllowedTarget(listTarget, matchRule(listTarget));
  if (!listResult.ok) throw new Error(`CMA list failed: ${JSON.stringify(listResult.attempts)}`);
  const listData = parseWrappedJson(listResult.text);
  const list = Array.isArray(listData?.typhoonList) ? listData.typhoonList : [];
  const active = list.filter(item => ['start', 'active', '1'].includes(String(item?.[7] || '').trim().toLowerCase()));
  const rawDocuments = [{ agency: 'CMA', sourceId: '_index', issuedAt: nowIso(), url: listResult.url, text: listResult.text, contentType: 'application/javascript; charset=utf-8', extension: 'jsonp' }];
  if (!active.length) return { agency: 'CMA', storms: [], rawDocuments };
  const results = await Promise.allSettled(active.map(async item => {
    const id = String(item?.[0] || '').trim();
    if (!id) return null;
    const target = new URL(`https://typhoon.nmc.cn/weatherservice/typhoon/jsons/view_${encodeURIComponent(id)}`);
    target.searchParams.set('t', String(Date.now()));
    target.searchParams.set('callback', `typhoon_jsons_view_${id.replace(/[^A-Za-z0-9_]/g, '_')}`);
    const detail = await fetchAllowedTarget(target, matchRule(target));
    if (!detail.ok) throw new Error(`${id}: CMA detail failed`);
    return parseNmcAgencyTrack(parseWrappedJson(detail.text), {
      id, nameEn: String(item?.[1] || '').trim(), nameZh: String(item?.[2] || '').trim()
    }, detail.text, detail.url);
  }));
  const storms = results.filter(result => result.status === 'fulfilled' && result.value).map(result => result.value);
  if (!storms.length && results.some(result => result.status === 'rejected')) throw results.find(result => result.status === 'rejected').reason;
  return { agency: 'CMA', storms, rawDocuments };
}

async function collectJma() {
  let feedResult = null;
  let candidates = [];
  for (const feedUrl of JMA_FEED_URLS) {
    const target = new URL(feedUrl);
    const result = await fetchAllowedTarget(target, matchRule(target));
    if (!result.ok) continue;
    const found = extractJmaFeedCandidates(result.text);
    feedResult = result;
    candidates = found;
    if (found.length) break;
  }
  if (!feedResult) throw new Error('JMA feed failed');
  const rawDocuments = [{ agency: 'JMA', sourceId: '_index', issuedAt: nowIso(), url: feedResult.url, text: feedResult.text, contentType: 'application/xml; charset=utf-8', extension: 'xml' }];
  if (!candidates.length) return { agency: 'JMA', storms: [], rawDocuments };
  const results = await Promise.allSettled(candidates.map(async candidate => {
    const target = sanitizeTarget(new URL(candidate.href));
    const rule = matchRule(target);
    if (!rule) throw new Error(`${candidate.code}: JMA URL not allowed`);
    const detail = await fetchAllowedTarget(target, rule);
    if (!detail.ok) throw new Error(`${candidate.code}: JMA detail failed`);
    return parseJmaTrackXml(detail.text, { ...candidate, href: detail.url });
  }));
  const bySource = new Map();
  results.filter(result => result.status === 'fulfilled' && result.value).map(result => result.value).forEach(storm => {
    const existing = bySource.get(storm.sourceId);
    if (!existing || new Date(storm.issuedAt) > new Date(existing.issuedAt)) bySource.set(storm.sourceId, storm);
  });
  const storms = [...bySource.values()];
  if (!storms.length && results.some(result => result.status === 'rejected')) throw results.find(result => result.status === 'rejected').reason;
  return { agency: 'JMA', storms, rawDocuments };
}

async function collectCwa(env) {
  const result = await fetchCwaData(env);
  const cyclones = asArray(result.data?.records?.TropicalCyclones?.TropicalCyclone).filter(item => item && typeof item === 'object');
  const storms = cyclones.map(cyclone => parseCwaTrack(cyclone, result.text)).filter(Boolean);
  const rawDocuments = [{ agency: 'CWA', sourceId: '_index', issuedAt: nowIso(), url: CWA_API_URL, text: result.text, contentType: 'application/json; charset=utf-8', extension: 'json' }];
  return { agency: 'CWA', storms, rawDocuments };
}

async function requireDatabase(env) {
  if (!env?.DB) throw new Error('D1 binding DB is not configured');
  return env.DB;
}
async function listDatabaseTables(env) {
  const db = await requireDatabase(env);
  const result = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  return asArray(result?.results).map(row => row.name);
}
async function probeDatabase(env) {
  const databaseBound = Boolean(env?.DB);
  const rawBucketBound = Boolean(env?.RAW_BUCKET);
  const output = {
    version: VERSION,
    databaseBound,
    rawBucketBound,
    adminTokenConfigured: Boolean(String(env?.ADMIN_TOKEN || '').trim()),
    cwaConfigured: Boolean(getCwaAuthorization(env)),
    tablesReady: false,
    missingTables: EXPECTED_TABLES,
    migrationVersion: null,
    counts: null,
    bucketCheck: null,
    error: null
  };
  if (!databaseBound) return output;
  try {
    const tables = await listDatabaseTables(env);
    output.missingTables = EXPECTED_TABLES.filter(table => !tables.includes(table));
    output.tablesReady = output.missingTables.length === 0;
    if (tables.includes('schema_migrations')) {
      const migration = await env.DB.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 1').first();
      output.migrationVersion = migration || null;
    }
    if (output.tablesReady) {
      const statements = [
        env.DB.prepare('SELECT COUNT(*) AS count FROM storms'),
        env.DB.prepare("SELECT COUNT(*) AS count FROM storms WHERE status='merged'"),
        env.DB.prepare("SELECT COUNT(*) AS count FROM advisories WHERE ingest_status='complete'"),
        env.DB.prepare('SELECT COUNT(*) AS count FROM track_points'),
        env.DB.prepare('SELECT COUNT(*) AS count FROM collection_runs'),
        env.DB.prepare('SELECT COUNT(*) AS count FROM identity_merges')
      ];
      const [storms, mergedStorms, advisories, points, runs, identityMerges] = await env.DB.batch(statements);
      output.counts = {
        storms: Number(storms?.results?.[0]?.count || 0),
        mergedStorms: Number(mergedStorms?.results?.[0]?.count || 0),
        advisories: Number(advisories?.results?.[0]?.count || 0),
        trackPoints: Number(points?.results?.[0]?.count || 0),
        collectionRuns: Number(runs?.results?.[0]?.count || 0),
        identityMerges: Number(identityMerges?.results?.[0]?.count || 0)
      };
    }
  } catch (error) {
    output.error = error?.message || String(error);
  }
  if (rawBucketBound) {
    try {
      const listing = await env.RAW_BUCKET.list({ limit: 1 });
      output.bucketCheck = { ok: true, sampleCount: listing.objects?.length || 0, truncated: Boolean(listing.truncated) };
    } catch (error) {
      output.bucketCheck = { ok: false, error: error?.message || String(error) };
    }
  }
  return output;
}

async function storeRawObject(env, document) {
  if (!env?.RAW_BUCKET) return { written: false, key: null, hash: await sha256Hex(document.text), reason: 'RAW_BUCKET not configured' };
  const text = String(document.text || '');
  const hash = await sha256Hex(text);
  const issuedAt = normalizeIsoTime(document.issuedAt, false) || nowIso();
  const year = yearFromTime(issuedAt);
  const extension = safeSegment(document.extension || 'txt');
  const key = `raw/${year}/${safeSegment(document.agency)}/${hash.slice(0, 2)}/${hash}.${extension}`;
  const existing = await env.RAW_BUCKET.head(key);
  if (existing) return { written: false, key, hash, reason: 'exists' };
  await env.RAW_BUCKET.put(key, text, {
    httpMetadata: { contentType: document.contentType || 'text/plain; charset=utf-8' },
    customMetadata: {
      agency: String(document.agency || ''),
      sourceId: String(document.sourceId || ''),
      sourceUrl: String(document.url || '').slice(0, 1024),
      issuedAt
    }
  });
  return { written: true, key, hash };
}

async function resolveCanonicalStormId(db, stormId) {
  let current = String(stormId || '');
  const seen = new Set();
  for (let depth = 0; current && depth < 8 && !seen.has(current); depth += 1) {
    seen.add(current);
    const row = await db.prepare('SELECT merged_into_id FROM storms WHERE id=? LIMIT 1').bind(current).first();
    if (!row?.merged_into_id) return current;
    current = row.merged_into_id;
  }
  return current || String(stormId || '');
}

function preferredName(current, incoming) {
  const existing = String(current || '').trim();
  const next = String(incoming || '').trim();
  if (!next) return existing;
  if (!existing) return next;
  if (isGenericName(existing) && !isGenericName(next)) return next;
  return existing;
}

async function ensureStormRow(db, stormId, storm, seed = null) {
  const now = nowIso();
  const year = Number(storm.year) || yearFromTime(storm.issuedAt);
  const internationalNumber = normalizeInternationalNumber(storm.internationalNumber, year);
  const nameEn = preferredName(seed?.name_en, storm.nameEn);
  const nameZh = preferredName(seed?.name_zh, storm.nameZh);
  const firstSeen = [seed?.first_seen_at, storm.issuedAt].filter(Boolean).sort()[0] || storm.issuedAt;
  const lastSeen = [seed?.last_seen_at, storm.issuedAt].filter(Boolean).sort().at(-1) || storm.issuedAt;
  await db.prepare(`
    INSERT INTO storms(
      id, basin, year, international_number, name_en, name_zh, name_en_norm, name_zh_norm,
      first_seen_at, last_seen_at, status, merged_into_id, created_at, updated_at
    ) VALUES(?, 'WP', ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      international_number=COALESCE(excluded.international_number, storms.international_number),
      name_en=excluded.name_en,
      name_zh=excluded.name_zh,
      name_en_norm=excluded.name_en_norm,
      name_zh_norm=excluded.name_zh_norm,
      first_seen_at=CASE WHEN excluded.first_seen_at<storms.first_seen_at THEN excluded.first_seen_at ELSE storms.first_seen_at END,
      last_seen_at=CASE WHEN excluded.last_seen_at>storms.last_seen_at THEN excluded.last_seen_at ELSE storms.last_seen_at END,
      status='active', merged_into_id=NULL, updated_at=excluded.updated_at
  `).bind(
    stormId, year, internationalNumber, nameEn, nameZh, normalizeName(nameEn), normalizeName(nameZh),
    firstSeen, lastSeen, seed?.created_at || now, now
  ).run();
}

async function deleteAdvisoryTree(db, advisoryId) {
  await db.batch([
    db.prepare('DELETE FROM wind_radii WHERE track_point_id IN (SELECT id FROM track_points WHERE advisory_id=?)').bind(advisoryId),
    db.prepare('DELETE FROM track_points WHERE advisory_id=?').bind(advisoryId),
    db.prepare('DELETE FROM advisories WHERE id=?').bind(advisoryId)
  ]);
}

function advisoryQuality(row) {
  return (row?.ingest_status === 'complete' ? 1000000 : 0) + Number(row?.point_count || 0) * 1000 + new Date(row?.updated_at || 0).getTime() / 1e13;
}

async function recordIdentityMerge(db, fromId, toId, reason, confidence, details = {}) {
  const id = await deterministicId('merge', fromId, toId);
  await db.prepare(`
    INSERT INTO identity_merges(id, from_storm_id, to_storm_id, reason, confidence, details_json, merged_at)
    VALUES(?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(from_storm_id, to_storm_id) DO UPDATE SET
      reason=excluded.reason, confidence=excluded.confidence, details_json=excluded.details_json, merged_at=excluded.merged_at
  `).bind(id, fromId, toId, reason, confidence, JSON.stringify(details), nowIso()).run();
}

async function mergeStormInto(env, fromStormId, toStormId, reason, confidence = 'high', details = {}) {
  const db = await requireDatabase(env);
  const fromId = await resolveCanonicalStormId(db, fromStormId);
  const toId = await resolveCanonicalStormId(db, toStormId);
  if (!fromId || !toId || fromId === toId) return { merged: false, fromId, toId, reason: 'same' };
  const [fromRow, toRow] = await Promise.all([
    db.prepare('SELECT * FROM storms WHERE id=? LIMIT 1').bind(fromId).first(),
    db.prepare('SELECT * FROM storms WHERE id=? LIMIT 1').bind(toId).first()
  ]);
  if (!fromRow || !toRow) return { merged: false, fromId, toId, reason: 'missing-row' };

  const sourceAdvisories = (await db.prepare('SELECT * FROM advisories WHERE storm_id=? ORDER BY issued_at').bind(fromId).all()).results || [];
  let movedAdvisories = 0;
  let removedDuplicates = 0;
  for (const advisory of sourceAdvisories) {
    const existing = await db.prepare('SELECT * FROM advisories WHERE storm_id=? AND agency=? AND issued_at=? LIMIT 1')
      .bind(toId, advisory.agency, advisory.issued_at).first();
    if (!existing) {
      await db.prepare('UPDATE advisories SET storm_id=?, updated_at=? WHERE id=?').bind(toId, nowIso(), advisory.id).run();
      movedAdvisories += 1;
      continue;
    }
    if (advisoryQuality(advisory) > advisoryQuality(existing)) {
      await deleteAdvisoryTree(db, existing.id);
      await db.prepare('UPDATE advisories SET storm_id=?, updated_at=? WHERE id=?').bind(toId, nowIso(), advisory.id).run();
      movedAdvisories += 1;
    } else {
      await deleteAdvisoryTree(db, advisory.id);
    }
    removedDuplicates += 1;
  }

  await db.prepare('UPDATE storm_aliases SET storm_id=?, last_seen_at=CASE WHEN last_seen_at<? THEN ? ELSE last_seen_at END WHERE storm_id=?')
    .bind(toId, toRow.last_seen_at, toRow.last_seen_at, fromId).run();

  const canonicalNumber = normalizeInternationalNumber(toRow.international_number || fromRow.international_number, toRow.year || fromRow.year);
  const nameEn = preferredName(toRow.name_en, fromRow.name_en);
  const nameZh = preferredName(toRow.name_zh, fromRow.name_zh);
  const firstSeen = [toRow.first_seen_at, fromRow.first_seen_at].filter(Boolean).sort()[0];
  const lastSeen = [toRow.last_seen_at, fromRow.last_seen_at].filter(Boolean).sort().at(-1);
  await db.batch([
    db.prepare(`
      UPDATE storms SET international_number=?, name_en=?, name_zh=?, name_en_norm=?, name_zh_norm=?,
        first_seen_at=?, last_seen_at=?, status='active', merged_into_id=NULL, updated_at=? WHERE id=?
    `).bind(canonicalNumber, nameEn, nameZh, normalizeName(nameEn), normalizeName(nameZh), firstSeen, lastSeen, nowIso(), toId),
    db.prepare(`
      UPDATE storms SET international_number=NULL, status='merged', merged_into_id=?, updated_at=? WHERE id=?
    `).bind(toId, nowIso(), fromId)
  ]);
  await recordIdentityMerge(db, fromId, toId, reason, confidence, { ...details, movedAdvisories, removedDuplicates });
  return { merged: true, fromId, toId, movedAdvisories, removedDuplicates };
}

async function promoteStormToCanonical(env, existingId, desiredId, storm, reason) {
  const db = await requireDatabase(env);
  const canonicalExisting = await db.prepare('SELECT * FROM storms WHERE id=? LIMIT 1').bind(desiredId).first();
  const source = await db.prepare('SELECT * FROM storms WHERE id=? LIMIT 1').bind(existingId).first();
  if (!source) return desiredId;
  if (!canonicalExisting) {
    await db.prepare('UPDATE storms SET international_number=NULL, updated_at=? WHERE id=?').bind(nowIso(), existingId).run();
    await ensureStormRow(db, desiredId, storm, source);
  }
  await mergeStormInto(env, existingId, desiredId, reason, 'high', {
    incomingAgency: storm.agency,
    incomingSourceId: storm.sourceId,
    normalizedNumber: normalizeInternationalNumber(storm.internationalNumber, storm.year)
  });
  return desiredId;
}

async function candidateLatestAnalysis(db, stormId) {
  return db.prepare(`
    SELECT p.latitude, p.longitude, p.valid_at
    FROM track_points p
    JOIN advisories a ON a.id=p.advisory_id
    WHERE a.storm_id=? AND a.ingest_status='complete' AND p.point_type='analysis'
    ORDER BY p.valid_at DESC LIMIT 1
  `).bind(stormId).first();
}

async function compatibleNameCandidate(db, storm) {
  const year = Number(storm.year) || yearFromTime(storm.issuedAt);
  const enNorm = normalizeName(storm.nameEn);
  const zhNorm = normalizeName(storm.nameZh);
  if ((!enNorm || isGenericName(enNorm)) && (!zhNorm || isGenericName(zhNorm))) return null;
  const result = await db.prepare(`
    SELECT * FROM storms
    WHERE year=? AND status<>'merged' AND (
      (?<>'' AND name_en_norm=?) OR (?<>'' AND name_zh_norm=?)
    ) ORDER BY last_seen_at DESC LIMIT 10
  `).bind(year, enNorm, enNorm, zhNorm, zhNorm).all();
  const incomingPoint = storm.points.filter(point => point.pointType === 'analysis').at(-1) || storm.points[0];
  for (const candidate of result.results || []) {
    const candidateNumber = normalizeInternationalNumber(candidate.international_number, year);
    const incomingNumber = normalizeInternationalNumber(storm.internationalNumber, year);
    if (candidateNumber && incomingNumber && candidateNumber !== incomingNumber) continue;
    if (!incomingPoint) return candidate;
    const candidatePoint = await candidateLatestAnalysis(db, candidate.id);
    if (!candidatePoint) return candidate;
    const hours = Math.abs(new Date(incomingPoint.validAt).getTime() - new Date(candidatePoint.valid_at).getTime()) / 3600000;
    const distance = haversineKm(incomingPoint.latitude, incomingPoint.longitude, candidatePoint.latitude, candidatePoint.longitude);
    if (hours <= 48 && (distance == null || distance <= 800)) return candidate;
  }
  return null;
}

async function compatibleUnnamedCandidate(db, storm) {
  const incomingPoint = storm.points.filter(point => point.pointType === 'analysis').at(-1) || storm.points[0];
  if (!incomingPoint) return null;
  const fromTime = new Date(new Date(incomingPoint.validAt).getTime() - 12 * 3600000).toISOString();
  const toTime = new Date(new Date(incomingPoint.validAt).getTime() + 12 * 3600000).toISOString();
  const rows = await db.prepare(`
    SELECT DISTINCT s.* FROM storms s
    JOIN advisories a ON a.storm_id=s.id AND a.ingest_status='complete'
    JOIN track_points p ON p.advisory_id=a.id AND p.point_type='analysis'
    WHERE s.year=? AND s.status<>'merged' AND p.valid_at BETWEEN ? AND ?
    ORDER BY s.last_seen_at DESC LIMIT 20
  `).bind(storm.year, fromTime, toTime).all();
  for (const candidate of rows.results || []) {
    const point = await candidateLatestAnalysis(db, candidate.id);
    const distance = point ? haversineKm(incomingPoint.latitude, incomingPoint.longitude, point.latitude, point.longitude) : null;
    if (distance != null && distance <= 300) return candidate;
  }
  return null;
}

async function chooseStormIdentity(env, storm) {
  const db = await requireDatabase(env);
  const year = Number(storm.year) || yearFromTime(storm.issuedAt);
  const normalizedNumber = normalizeInternationalNumber(storm.internationalNumber, year);
  storm.internationalNumber = normalizedNumber;
  const desiredId = canonicalStormId(year, normalizedNumber);
  const agencyStormId = String(storm.sourceId || '').trim();

  if (agencyStormId) {
    const alias = await db.prepare('SELECT storm_id FROM storm_aliases WHERE agency=? AND agency_storm_id=? LIMIT 1')
      .bind(storm.agency, agencyStormId).first();
    if (alias?.storm_id) {
      const resolved = await resolveCanonicalStormId(db, alias.storm_id);
      if (desiredId && resolved !== desiredId) return promoteStormToCanonical(env, resolved, desiredId, storm, 'alias-promoted-by-official-number');
      return resolved;
    }
  }

  if (normalizedNumber) {
    const byNumber = await db.prepare('SELECT id FROM storms WHERE basin=? AND year=? AND international_number IN (?, ?) AND status<>\'merged\' LIMIT 1')
      .bind('WP', year, normalizedNumber, `${String(year).slice(-2)}${normalizedNumber}`).first();
    if (byNumber?.id) {
      const resolved = await resolveCanonicalStormId(db, byNumber.id);
      if (resolved !== desiredId) return promoteStormToCanonical(env, resolved, desiredId, storm, 'normalized-international-number');
      return desiredId;
    }
    const byName = await compatibleNameCandidate(db, storm);
    if (byName?.id && byName.id !== desiredId) return promoteStormToCanonical(env, byName.id, desiredId, storm, 'name-promoted-by-official-number');
    return desiredId;
  }

  const byName = await compatibleNameCandidate(db, storm);
  if (byName?.id) return resolveCanonicalStormId(db, byName.id);
  const byPosition = await compatibleUnnamedCandidate(db, storm);
  if (byPosition?.id) return resolveCanonicalStormId(db, byPosition.id);

  const firstPoint = storm.points[0] || {};
  const locationSeed = `${Math.round(Number(firstPoint.latitude || 0) * 2) / 2},${Math.round(Number(firstPoint.longitude || 0) * 2) / 2}`;
  const daySeed = String(storm.issuedAt || '').slice(0, 10);
  const hash = await sha256Hex(`${year}|${normalizeName(storm.nameEn)}|${normalizeName(storm.nameZh)}|${daySeed}|${locationSeed}`);
  return `WP-${year}-TEMP-${hash.slice(0, 8).toUpperCase()}`;
}

async function upsertStormAndAlias(env, storm, stormId) {
  const db = await requireDatabase(env);
  const resolvedId = await resolveCanonicalStormId(db, stormId);
  const existing = await db.prepare('SELECT * FROM storms WHERE id=? LIMIT 1').bind(resolvedId).first();
  await ensureStormRow(db, resolvedId, storm, existing);
  await db.prepare(`
    INSERT INTO storm_aliases(storm_id, agency, agency_storm_id, agency_name, first_seen_at, last_seen_at)
    VALUES(?, ?, ?, ?, ?, ?)
    ON CONFLICT(agency, agency_storm_id) DO UPDATE SET
      storm_id=excluded.storm_id,
      agency_name=CASE WHEN excluded.agency_name<>'' THEN excluded.agency_name ELSE storm_aliases.agency_name END,
      last_seen_at=CASE WHEN excluded.last_seen_at>storm_aliases.last_seen_at THEN excluded.last_seen_at ELSE storm_aliases.last_seen_at END
  `).bind(resolvedId, storm.agency, storm.sourceId, storm.nameEn || storm.nameZh || '', storm.issuedAt, storm.issuedAt).run();
  return resolvedId;
}

async function reconcileStormIdentities(env, options = {}) {
  const db = await requireDatabase(env);
  const summary = { version: VERSION, mode: options.mode || 'manual', normalized: 0, merged: 0, skipped: 0, details: [] };
  let rows = (await db.prepare("SELECT * FROM storms WHERE status<>'merged' ORDER BY year, created_at").all()).results || [];

  for (const row of rows) {
    const normalized = normalizeInternationalNumber(row.international_number, row.year);
    if (!normalized) continue;
    const desiredId = canonicalStormId(row.year, normalized);
    if (row.id === desiredId && row.international_number === normalized) continue;
    const syntheticStorm = {
      agency: 'REPAIR', sourceId: row.id, year: row.year, internationalNumber: normalized,
      nameEn: row.name_en || '', nameZh: row.name_zh || '', issuedAt: row.last_seen_at,
      points: []
    };
    if (row.id !== desiredId) {
      await promoteStormToCanonical(env, row.id, desiredId, syntheticStorm, 'repair-normalized-international-number');
      summary.merged += 1;
      summary.details.push({ action: 'merge', from: row.id, to: desiredId, reason: 'normalized-number' });
    } else {
      await db.prepare('UPDATE storms SET international_number=?, updated_at=? WHERE id=?').bind(normalized, nowIso(), row.id).run();
      summary.normalized += 1;
    }
  }

  rows = (await db.prepare("SELECT * FROM storms WHERE status<>'merged' ORDER BY year, created_at").all()).results || [];
  const groups = new Map();
  for (const row of rows) {
    const keyName = row.name_en_norm && !isGenericName(row.name_en_norm) ? `EN:${row.name_en_norm}`
      : (row.name_zh_norm && !isGenericName(row.name_zh_norm) ? `ZH:${row.name_zh_norm}` : null);
    if (!keyName) continue;
    const key = `${row.year}|${keyName}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => {
      const aNumbered = normalizeInternationalNumber(a.international_number, a.year) ? 1 : 0;
      const bNumbered = normalizeInternationalNumber(b.international_number, b.year) ? 1 : 0;
      return bNumbered - aNumbered || new Date(a.created_at) - new Date(b.created_at);
    });
    const target = sorted[0];
    for (const source of sorted.slice(1)) {
      const sourceNumber = normalizeInternationalNumber(source.international_number, source.year);
      const targetNumber = normalizeInternationalNumber(target.international_number, target.year);
      if (sourceNumber && targetNumber && sourceNumber !== targetNumber) {
        summary.skipped += 1;
        summary.details.push({ action: 'skip', from: source.id, to: target.id, reason: 'conflicting-number', key });
        continue;
      }
      const result = await mergeStormInto(env, source.id, target.id, 'repair-duplicate-normalized-name', 'high', { key });
      if (result.merged) {
        summary.merged += 1;
        summary.details.push({ action: 'merge', from: source.id, to: target.id, reason: 'duplicate-name' });
      }
    }
  }
  return summary;
}

async function ingestStormAdvisory(env, storm) {
  const db = await requireDatabase(env);
  let stormId = await chooseStormIdentity(env, storm);
  stormId = await upsertStormAndAlias(env, storm, stormId);

  const raw = await storeRawObject(env, {
    agency: storm.agency, sourceId: storm.sourceId, issuedAt: storm.issuedAt,
    url: storm.sourceUrl, text: storm.rawText, contentType: storm.rawContentType, extension: storm.rawExtension
  });
  const sourceHash = raw.hash || await sha256Hex(storm.rawText || JSON.stringify(storm));
  const advisoryId = await deterministicId('adv', stormId, storm.agency, storm.issuedAt);
  const existing = await db.prepare('SELECT id, source_hash, ingest_status FROM advisories WHERE storm_id=? AND agency=? AND issued_at=? LIMIT 1')
    .bind(stormId, storm.agency, storm.issuedAt).first();
  if (existing?.source_hash === sourceHash && existing?.ingest_status === 'complete') {
    return { outcome: 'duplicate', points: 0, rawWritten: raw.written ? 1 : 0, stormId, advisoryId: existing.id };
  }

  const now = nowIso();
  await db.prepare(`
    INSERT INTO advisories(
      id, storm_id, agency, issued_at, fetched_at, source_code, source_url, source_hash,
      raw_object_key, parser_version, point_count, ingest_status, ingest_error, created_at, updated_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'writing', NULL, ?, ?)
    ON CONFLICT(storm_id, agency, issued_at) DO UPDATE SET
      fetched_at=excluded.fetched_at, source_code=excluded.source_code, source_url=excluded.source_url,
      source_hash=excluded.source_hash, raw_object_key=excluded.raw_object_key,
      parser_version=excluded.parser_version, point_count=0, ingest_status='writing', ingest_error=NULL,
      updated_at=excluded.updated_at
  `).bind(
    advisoryId, stormId, storm.agency, storm.issuedAt, now, storm.sourceCode, storm.sourceUrl,
    sourceHash, raw.key, PARSER_VERSION, now, now
  ).run();

  const actualAdvisory = await db.prepare('SELECT id FROM advisories WHERE storm_id=? AND agency=? AND issued_at=? LIMIT 1')
    .bind(stormId, storm.agency, storm.issuedAt).first();
  const actualAdvisoryId = actualAdvisory?.id || advisoryId;
  try {
    await db.batch([
      db.prepare('DELETE FROM wind_radii WHERE track_point_id IN (SELECT id FROM track_points WHERE advisory_id=?)').bind(actualAdvisoryId),
      db.prepare('DELETE FROM track_points WHERE advisory_id=?').bind(actualAdvisoryId)
    ]);
    const pointStatements = [];
    const radiusStatements = [];
    for (const point of storm.points) {
      const pointId = `${actualAdvisoryId}-p${String(point.sourceOrder).padStart(3, '0')}`;
      pointStatements.push(db.prepare(`
        INSERT INTO track_points(
          id, advisory_id, point_type, valid_at, forecast_hour, latitude, longitude,
          pressure_hpa, wind_ms, gust_ms, wind_averaging_minutes, intensity_code, intensity_label,
          movement_direction, movement_speed_kmh, probability_radius_km, source_order
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        pointId, actualAdvisoryId, point.pointType, point.validAt, point.forecastHour,
        point.latitude, point.longitude, point.pressureHpa, point.windMs, point.gustMs,
        point.windAveragingMinutes, point.intensityCode, point.intensityLabel,
        point.movementDirection, point.movementSpeedKmh, point.probabilityRadiusKm, point.sourceOrder
      ));
      for (let radiusIndex = 0; radiusIndex < point.windRadii.length; radiusIndex += 1) {
        const radius = point.windRadii[radiusIndex];
        const radiusId = `${pointId}-r${String(radiusIndex).padStart(2, '0')}`;
        radiusStatements.push(db.prepare(`
          INSERT INTO wind_radii(
            id, track_point_id, threshold_code, threshold_ms,
            radius_ne_km, radius_se_km, radius_sw_km, radius_nw_km
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(radiusId, pointId, radius.thresholdCode, radius.thresholdMs, radius.ne, radius.se, radius.sw, radius.nw));
      }
    }
    const allStatements = [...pointStatements, ...radiusStatements];
    for (let index = 0; index < allStatements.length; index += 50) {
      await db.batch(allStatements.slice(index, index + 50));
    }
    await db.prepare("UPDATE advisories SET point_count=?, ingest_status='complete', ingest_error=NULL, updated_at=? WHERE id=?")
      .bind(storm.points.length, nowIso(), actualAdvisoryId).run();
    return {
      outcome: existing ? 'updated' : 'inserted', points: storm.points.length,
      rawWritten: raw.written ? 1 : 0, stormId, advisoryId: actualAdvisoryId
    };
  } catch (error) {
    await db.prepare("UPDATE advisories SET ingest_status='failed', ingest_error=?, updated_at=? WHERE id=?")
      .bind(truncateText(error?.message || error, 1000), nowIso(), actualAdvisoryId).run();
    throw error;
  }
}

async function collectAllAgencies(env, triggerType = 'manual') {
  const probe = await probeDatabase(env);
  if (!probe.databaseBound || !probe.tablesReady) {
    throw new Error(`Database is not ready${probe.missingTables?.length ? `; missing: ${probe.missingTables.join(', ')}` : ''}`);
  }
  const db = env.DB;
  const startedAt = nowIso();
  const runId = `run-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await db.prepare('INSERT INTO collection_runs(id, started_at, trigger_type) VALUES(?, ?, ?)')
    .bind(runId, startedAt, triggerType).run();

  const collectors = [
    ['HKO', () => collectHko()],
    ['CMA', () => collectCma()],
    ['JMA', () => collectJma()],
    ['CWA', () => collectCwa(env)]
  ];
  const settled = await Promise.allSettled(collectors.map(([, collector]) => collector()));
  const result = {
    ok: true,
    version: VERSION,
    runId,
    triggerType,
    startedAt,
    completedAt: null,
    agencies: {},
    totals: { inserted: 0, updated: 0, duplicates: 0, points: 0, rawObjectsWritten: 0 },
    errors: []
  };

  for (let index = 0; index < collectors.length; index += 1) {
    const agency = collectors[index][0];
    const item = settled[index];
    const agencyResult = { status: 'error', stormsFetched: 0, inserted: 0, updated: 0, duplicates: 0, points: 0, rawObjectsWritten: 0, errors: [] };
    if (item.status === 'rejected') {
      agencyResult.errors.push(item.reason?.message || String(item.reason));
      result.errors.push(`${agency}: ${agencyResult.errors[0]}`);
      result.agencies[agency] = agencyResult;
      continue;
    }

    const collection = item.value;
    agencyResult.stormsFetched = collection.storms.length;
    agencyResult.status = collection.storms.length ? 'ok' : 'empty';
    for (const document of collection.rawDocuments || []) {
      try {
        const raw = await storeRawObject(env, document);
        if (raw.written) agencyResult.rawObjectsWritten += 1;
      } catch (error) {
        agencyResult.errors.push(`index raw: ${error?.message || error}`);
      }
    }
    for (const storm of collection.storms) {
      try {
        const ingested = await ingestStormAdvisory(env, storm);
        if (ingested.outcome === 'inserted') agencyResult.inserted += 1;
        else if (ingested.outcome === 'updated') agencyResult.updated += 1;
        else agencyResult.duplicates += 1;
        agencyResult.points += ingested.points;
        agencyResult.rawObjectsWritten += ingested.rawWritten;
      } catch (error) {
        agencyResult.status = 'partial';
        agencyResult.errors.push(`${storm.sourceId}: ${error?.message || error}`);
      }
    }
    if (agencyResult.errors.length && !agencyResult.inserted && !agencyResult.updated && !agencyResult.duplicates) agencyResult.status = 'error';
    result.agencies[agency] = agencyResult;
    result.totals.inserted += agencyResult.inserted;
    result.totals.updated += agencyResult.updated;
    result.totals.duplicates += agencyResult.duplicates;
    result.totals.points += agencyResult.points;
    result.totals.rawObjectsWritten += agencyResult.rawObjectsWritten;
    result.errors.push(...agencyResult.errors.map(error => `${agency}: ${error}`));
  }

  try {
    result.identityRepair = await reconcileStormIdentities(env, { mode: 'post-collect' });
  } catch (error) {
    result.identityRepair = { ok: false, error: error?.message || String(error) };
    result.errors.push(`IDENTITY: ${error?.message || error}`);
  }
  result.completedAt = nowIso();
  result.ok = Object.values(result.agencies).some(item => ['ok', 'empty', 'partial'].includes(item.status));
  const status = agency => result.agencies[agency]?.status || 'error';
  await db.prepare(`
    UPDATE collection_runs SET
      completed_at=?, hko_status=?, cma_status=?, jma_status=?, cwa_status=?,
      inserted_advisories=?, updated_advisories=?, duplicate_advisories=?, inserted_points=?,
      raw_objects_written=?, error_summary=?, result_json=?
    WHERE id=?
  `).bind(
    result.completedAt, status('HKO'), status('CMA'), status('JMA'), status('CWA'),
    result.totals.inserted, result.totals.updated, result.totals.duplicates, result.totals.points,
    result.totals.rawObjectsWritten, result.errors.length ? truncateText(result.errors.join(' | '), 4000) : null,
    JSON.stringify(result), runId
  ).run();
  return result;
}

function authorizeAdmin(request, env) {
  const configured = String(env?.ADMIN_TOKEN || '').trim();
  if (!configured) return { ok: false, status: 503, error: 'ADMIN_TOKEN is not configured' };
  const authorization = String(request.headers.get('Authorization') || '');
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || '';
  if (!token || !constantTimeEqual(token, configured)) return { ok: false, status: 401, error: 'Unauthorized' };
  return { ok: true };
}

async function historyStorms(incoming, env) {
  const year = incoming.searchParams.get('year');
  const status = incoming.searchParams.get('status');
  const limit = clampInteger(incoming.searchParams.get('limit'), 1, 100, 30);
  const offset = clampInteger(incoming.searchParams.get('offset'), 0, 100000, 0);
  const includeMerged = incoming.searchParams.get('includeMerged') === '1';
  const conditions = [];
  const bindings = [];
  if (!includeMerged && !status) conditions.push("s.status<>'merged'");
  if (year && /^\d{4}$/.test(year)) { conditions.push('s.year=?'); bindings.push(Number(year)); }
  if (status && ['active', 'dissipated', 'archived', 'merged'].includes(status)) { conditions.push('s.status=?'); bindings.push(status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `
    SELECT s.*,
      (SELECT COUNT(*) FROM advisories a WHERE a.storm_id=s.id AND a.ingest_status='complete') AS advisory_count,
      (SELECT MAX(issued_at) FROM advisories a WHERE a.storm_id=s.id AND a.ingest_status='complete') AS latest_advisory_at
    FROM storms s ${where}
    ORDER BY s.last_seen_at DESC LIMIT ? OFFSET ?
  `;
  const result = await env.DB.prepare(query).bind(...bindings, limit, offset).all();
  return jsonResponse({ version: VERSION, storms: result.results || [], pagination: { limit, offset, count: result.results?.length || 0 } });
}

async function historyStormDetail(stormId, env) {
  const canonicalId = await resolveCanonicalStormId(env.DB, stormId);
  const storm = await env.DB.prepare('SELECT * FROM storms WHERE id=? LIMIT 1').bind(canonicalId).first();
  if (!storm) return jsonResponse({ error: 'Storm not found' }, 404);
  const [aliases, latest] = await env.DB.batch([
    env.DB.prepare('SELECT agency, agency_storm_id, agency_name, first_seen_at, last_seen_at FROM storm_aliases WHERE storm_id=? ORDER BY agency').bind(canonicalId),
    env.DB.prepare(`
      SELECT id, agency, issued_at, fetched_at, source_code, point_count, parser_version
      FROM advisories WHERE storm_id=? AND ingest_status='complete'
      ORDER BY issued_at DESC LIMIT 20
    `).bind(canonicalId)
  ]);
  return jsonResponse({ version: VERSION, storm, aliases: aliases.results || [], latestAdvisories: latest.results || [] });
}

async function historyAdvisories(stormId, incoming, env) {
  stormId = await resolveCanonicalStormId(env.DB, stormId);
  const agency = String(incoming.searchParams.get('agency') || '').toUpperCase();
  const limit = clampInteger(incoming.searchParams.get('limit'), 1, 200, 50);
  const conditions = ["storm_id=?", "ingest_status='complete'"];
  const bindings = [stormId];
  if (['HKO', 'CMA', 'JMA', 'CWA'].includes(agency)) { conditions.push('agency=?'); bindings.push(agency); }
  const result = await env.DB.prepare(`
    SELECT id, storm_id, agency, issued_at, fetched_at, source_code, source_url,
           raw_object_key, parser_version, point_count
    FROM advisories WHERE ${conditions.join(' AND ')}
    ORDER BY issued_at DESC LIMIT ?
  `).bind(...bindings, limit).all();
  return jsonResponse({ version: VERSION, stormId, advisories: result.results || [] });
}

async function historyAdvisoryDetail(advisoryId, env) {
  const advisory = await env.DB.prepare(`
    SELECT id, storm_id, agency, issued_at, fetched_at, source_code, source_url,
           raw_object_key, parser_version, point_count
    FROM advisories WHERE id=? AND ingest_status='complete' LIMIT 1
  `).bind(advisoryId).first();
  if (!advisory) return jsonResponse({ error: 'Advisory not found' }, 404);
  const [pointResult, radiusResult] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM track_points WHERE advisory_id=? ORDER BY source_order').bind(advisoryId),
    env.DB.prepare(`
      SELECT wr.* FROM wind_radii wr
      JOIN track_points tp ON tp.id=wr.track_point_id
      WHERE tp.advisory_id=? ORDER BY tp.source_order, wr.threshold_code
    `).bind(advisoryId)
  ]);
  const radiiByPoint = new Map();
  for (const radius of radiusResult.results || []) {
    if (!radiiByPoint.has(radius.track_point_id)) radiiByPoint.set(radius.track_point_id, []);
    radiiByPoint.get(radius.track_point_id).push(radius);
  }
  const points = (pointResult.results || []).map(point => ({ ...point, windRadii: radiiByPoint.get(point.id) || [] }));
  return jsonResponse({ version: VERSION, advisory, points });
}

async function historyLatest(incoming, env) {
  const agency = String(incoming.searchParams.get('agency') || '').toUpperCase();
  if (!['HKO', 'CMA', 'JMA', 'CWA'].includes(agency)) return jsonResponse({ error: 'agency must be HKO, CMA, JMA or CWA' }, 400);
  const result = await env.DB.prepare(`
    SELECT a.id, a.storm_id, a.agency, a.issued_at, a.point_count,
           s.name_en, s.name_zh, s.international_number, s.year
    FROM advisories a JOIN storms s ON s.id=a.storm_id
    WHERE a.agency=? AND a.ingest_status='complete'
    ORDER BY a.issued_at DESC LIMIT 20
  `).bind(agency).all();
  return jsonResponse({ version: VERSION, agency, advisories: result.results || [] });
}

async function probeNmcDetails() {
  const listTarget = new URL(NMC_LIST_URL);
  listTarget.searchParams.set('t', String(Date.now()));
  listTarget.searchParams.set('callback', 'typhoon_jsons_list_default');
  const listResult = await fetchAllowedTarget(listTarget, matchRule(listTarget));
  if (!listResult.ok) return { ok: false, stage: 'list', listAttempts: listResult.attempts };
  let data;
  try { data = parseWrappedJson(listResult.text); }
  catch (error) { return { ok: false, stage: 'list-parse', error: error.message, listAttempts: listResult.attempts }; }
  const list = Array.isArray(data?.typhoonList) ? data.typhoonList : [];
  const active = list.filter(item => ['start', 'active', '1'].includes(String(item?.[7] || '').trim().toLowerCase()));
  const details = [];
  for (const item of active.slice(0, 5)) {
    const id = String(item?.[0] || '');
    const target = new URL(`https://typhoon.nmc.cn/weatherservice/typhoon/jsons/view_${encodeURIComponent(id)}`);
    target.searchParams.set('t', String(Date.now()));
    target.searchParams.set('callback', `typhoon_jsons_view_${id.replace(/[^A-Za-z0-9_]/g, '_')}`);
    const result = await fetchAllowedTarget(target, matchRule(target));
    let forecastKeys = [];
    let historyCount = 0;
    let parseError = null;
    if (result.ok) {
      try {
        const stormInfo = parseWrappedJson(result.text)?.typhoon;
        historyCount = Array.isArray(stormInfo?.[8]) ? stormInfo[8].length : 0;
        forecastKeys = Object.keys(latestForecastContainer(stormInfo).container);
      } catch (error) { parseError = error.message; }
    }
    details.push({
      id, nameEn: String(item?.[1] || ''), nameZh: String(item?.[2] || ''),
      ok: result.ok && !parseError, historyCount, forecastKeys,
      hasCma: forecastKeys.some(key => key.toUpperCase() === 'BABJ'), parseError,
      attempts: result.attempts
    });
  }
  return { ok: true, stage: 'complete', activeCount: active.length, listAttempts: listResult.attempts, details };
}

async function probeJma() {
  let feedResult = null;
  let candidates = [];
  for (const feedUrl of JMA_FEED_URLS) {
    const target = new URL(feedUrl);
    const result = await fetchAllowedTarget(target, matchRule(target));
    if (!result.ok) continue;
    feedResult = result;
    candidates = extractJmaFeedCandidates(result.text);
    if (candidates.length) break;
  }
  if (!feedResult) return { ok: false, stage: 'feed' };
  if (!candidates.length) return { ok: true, stage: 'no-active-vptw', activeCount: 0, candidates: [] };
  const target = sanitizeTarget(new URL(candidates[0].href));
  const rule = matchRule(target);
  if (!rule) return { ok: false, stage: 'candidate-not-allowed', candidates };
  const sample = await fetchAllowedTarget(target, rule);
  return {
    ok: sample.ok,
    stage: sample.ok ? 'complete' : 'sample',
    activeCount: candidates.length,
    candidates,
    sampleChecks: sample.ok ? {
      meteorologicalInfoCount: xmlBlocks(sample.text, 'MeteorologicalInfo').length,
      coordinateCount: xmlNodes(sample.text, 'Coordinate').length,
      basePointCount: xmlNodes(sample.text, 'BasePoint').length,
      probabilityCircleCount: xmlNodes(sample.text, 'ProbabilityCircle').length,
      hasTyphoonNamePart: Boolean(xmlNode(sample.text, 'TyphoonNamePart')),
      parserProducedStorm: Boolean(parseJmaTrackXml(sample.text, candidates[0]))
    } : null,
    sampleAttempts: sample.attempts
  };
}

async function probeCwa(env) {
  try {
    const result = await fetchCwaData(env);
    const cyclones = asArray(result.data?.records?.TropicalCyclones?.TropicalCyclone);
    return {
      ok: true, configured: true, dataset: CWA_DATASET_ID, upstreamStatus: result.status,
      cycloneCount: cyclones.length,
      parsedStormCount: cyclones.map(cyclone => parseCwaTrack(cyclone, result.text)).filter(Boolean).length,
      recordsKeys: Object.keys(result.data?.records || {})
    };
  } catch (error) {
    return { ok: false, configured: Boolean(getCwaAuthorization(env)), dataset: CWA_DATASET_ID, error: error?.message || String(error) };
  }
}

async function probeIdentity(env) {
  const db = await requireDatabase(env);
  const rows = (await db.prepare('SELECT id, year, international_number, name_en, name_zh, name_en_norm, name_zh_norm, status, merged_into_id FROM storms ORDER BY year DESC, id').all()).results || [];
  const active = rows.filter(row => row.status !== 'merged');
  const mismatchedCanonicalIds = active.map(row => {
    const normalized = normalizeInternationalNumber(row.international_number, row.year);
    const expectedId = canonicalStormId(row.year, normalized);
    return expectedId && row.id !== expectedId ? { id: row.id, internationalNumber: row.international_number, normalized, expectedId } : null;
  }).filter(Boolean);
  const groups = new Map();
  for (const row of active) {
    const norm = row.name_en_norm && !isGenericName(row.name_en_norm) ? row.name_en_norm : null;
    if (!norm) continue;
    const key = `${row.year}|${norm}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: row.id, internationalNumber: row.international_number, nameEn: row.name_en, nameZh: row.name_zh });
  }
  const duplicateNameGroups = [...groups.entries()].filter(([, members]) => members.length > 1).map(([key, members]) => ({ key, members }));
  const recentMerges = (await db.prepare('SELECT from_storm_id, to_storm_id, reason, confidence, merged_at FROM identity_merges ORDER BY merged_at DESC LIMIT 20').all()).results || [];
  return {
    version: VERSION,
    ok: true,
    counts: { total: rows.length, active: active.length, merged: rows.length - active.length },
    mismatchedCanonicalIds,
    duplicateNameGroups,
    recentMerges
  };
}

async function handleRequest(request, env, ctx) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  const incoming = new URL(request.url);

  if (incoming.pathname === '/health' && request.method === 'GET') {
    return jsonResponse({
      ok: true,
      version: VERSION,
      service: 'HKO + CMA + JMA + CWA tropical cyclone proxy and archive collector',
      bindings: { database: Boolean(env?.DB), rawBucket: Boolean(env?.RAW_BUCKET) },
      secrets: { cwaAuthorization: Boolean(getCwaAuthorization(env)), adminToken: Boolean(String(env?.ADMIN_TOKEN || '').trim()) },
      diagnostics: ['/probe/cma', '/probe/jma', '/probe/cwa', '/probe/database', '/probe/identity'],
      historyApi: ['/api/history/storms', '/api/history/latest?agency=JMA'],
      scheduledCollection: true
    });
  }

  if (incoming.pathname === '/probe/database' && request.method === 'GET') {
    const result = await probeDatabase(env);
    return jsonResponse(result, result.databaseBound && !result.error ? 200 : 503);
  }
  if (incoming.pathname === '/probe/identity' && request.method === 'GET') {
    try { return jsonResponse(await probeIdentity(env)); }
    catch (error) { return jsonResponse({ version: VERSION, ok: false, error: error?.message || String(error) }, 500); }
  }
  if ((incoming.pathname === '/probe/cma' || incoming.pathname === '/probe/nmc') && request.method === 'GET') {
    const result = await probeNmcDetails();
    return jsonResponse({ version: VERSION, ...result }, result.ok ? 200 : 502);
  }
  if (incoming.pathname === '/probe/jma' && request.method === 'GET') {
    const result = await probeJma();
    return jsonResponse({ version: VERSION, ...result }, result.ok ? 200 : 502);
  }
  if (incoming.pathname === '/probe/cwa' && request.method === 'GET') {
    const result = await probeCwa(env);
    return jsonResponse({ version: VERSION, ...result }, result.ok ? 200 : (result.configured ? 502 : 503));
  }

  if (incoming.pathname === '/api/admin/repair-identities' && request.method === 'POST') {
    const authorization = authorizeAdmin(request, env);
    if (!authorization.ok) return jsonResponse({ error: authorization.error }, authorization.status, { 'WWW-Authenticate': 'Bearer' });
    try { return jsonResponse({ ok: true, ...(await reconcileStormIdentities(env, { mode: 'manual' })) }); }
    catch (error) { return jsonResponse({ ok: false, version: VERSION, error: error?.message || String(error) }, 500); }
  }

  if (incoming.pathname === '/api/admin/collect' && request.method === 'POST') {
    const authorization = authorizeAdmin(request, env);
    if (!authorization.ok) return jsonResponse({ error: authorization.error }, authorization.status, { 'WWW-Authenticate': 'Bearer' });
    try {
      const result = await collectAllAgencies(env, 'manual');
      return jsonResponse(result, result.ok ? 200 : 502);
    } catch (error) {
      return jsonResponse({ ok: false, version: VERSION, error: error?.message || String(error) }, 500);
    }
  }

  if (incoming.pathname === '/api/history/storms' && request.method === 'GET') return historyStorms(incoming, env);
  const stormDetailMatch = incoming.pathname.match(/^\/api\/history\/storms\/([^/]+)$/);
  if (stormDetailMatch && request.method === 'GET') return historyStormDetail(decodeURIComponent(stormDetailMatch[1]), env);
  const advisoryListMatch = incoming.pathname.match(/^\/api\/history\/storms\/([^/]+)\/advisories$/);
  if (advisoryListMatch && request.method === 'GET') return historyAdvisories(decodeURIComponent(advisoryListMatch[1]), incoming, env);
  const advisoryDetailMatch = incoming.pathname.match(/^\/api\/history\/advisories\/([^/]+)$/);
  if (advisoryDetailMatch && request.method === 'GET') return historyAdvisoryDetail(decodeURIComponent(advisoryDetailMatch[1]), env);
  if (incoming.pathname === '/api/history/latest' && request.method === 'GET') return historyLatest(incoming, env);

  if (incoming.pathname === '/api/cwa' && request.method === 'GET') {
    try {
      const result = await fetchCwaData(env);
      return new Response(JSON.stringify(result.data), {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=180, stale-while-revalidate=600',
          'X-Content-Type-Options': 'nosniff',
          'X-Data-Source': 'Taiwan Central Weather Administration',
          'X-CWA-Dataset': CWA_DATASET_ID,
          'X-Proxy-Version': VERSION
        }
      });
    } catch (error) {
      return jsonResponse({ version: VERSION, error: error?.message || String(error) }, getCwaAuthorization(env) ? 502 : 503);
    }
  }

  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405);
  const rawTarget = incoming.searchParams.get('url');
  if (!rawTarget) {
    return jsonResponse({
      error: 'Missing url parameter',
      examples: [
        '/?url=https%3A%2F%2Fwww.weather.gov.hk%2Fwxinfo%2Fcurrwx%2Ftc_list.xml',
        '/?url=https%3A%2F%2Fwww.data.jma.go.jp%2Fdeveloper%2Fxml%2Ffeed%2Fextra_l.xml',
        '/api/cwa'
      ]
    }, 400);
  }
  let target;
  try { target = sanitizeTarget(new URL(rawTarget)); }
  catch { return jsonResponse({ error: 'Invalid target URL' }, 400); }
  const rule = matchRule(target);
  if (!rule) return jsonResponse({ error: 'Target is not an allowed tropical cyclone data file' }, 403);
  const result = await fetchAllowedTarget(target, rule);
  if (!result.ok) {
    return jsonResponse({
      error: `Failed to fetch ${rule.source}`,
      detail: result.attempts.map(item => `HTTP ${item.status}: ${item.preview}`).join(' | '),
      attempts: result.attempts
    }, 502);
  }
  return new Response(result.body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': rule.contentType,
      'Cache-Control': `public, max-age=${rule.cacheTtl}, stale-while-revalidate=300`,
      'X-Content-Type-Options': 'nosniff',
      'X-Data-Source': rule.source,
      'X-Upstream-URL': result.url,
      'X-Proxy-Version': VERSION
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      console.error('Unhandled fetch error', error);
      return jsonResponse({ ok: false, version: VERSION, error: error?.message || String(error) }, 500);
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const result = await collectAllAgencies(env, 'cron');
        console.log('Scheduled storm collection completed', JSON.stringify(result));
      } catch (error) {
        console.error('Scheduled storm collection failed', error);
      }
    })());
  }
};
