/**
 * Cloudflare Worker v2.5：HKO + CMA/NMC + JMA + CWA 官方熱帶氣旋資料代理
 *
 * 修正：
 * - NMC 預測資料位於每個歷史點的 point[11]，不是 typhoon[9]
 * - CMA/BABJ 診斷會使用最新一個含預測的歷史點
 * - 保留 JMA Atom feed 與 VPTW60-65 官方台風 XML 代理及 /probe/jma
 * - 新增 CWA W-C0034-005 官方熱帶氣旋路徑 API、/api/cwa 與 /probe/cwa
 * - CWA 授權碼只從 Worker Secret CWA_AUTHORIZATION 讀取，不會回傳至前端
 */

const VERSION = '2.5.0';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
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

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
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
  alternate.pathname = alternate.pathname.endsWith('.json')
    ? alternate.pathname.slice(0, -5)
    : `${alternate.pathname}.json`;
  urls.push(alternate);
  return [...new Set(urls.map(url => url.toString()))];
}

function upstreamHeaders(target, rule) {
  const headers = {
    Accept: rule.accept,
    'User-Agent': target.hostname === 'typhoon.nmc.cn'
      ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
      : 'Storm-Track-Viewer/2.5',
    'Accept-Language': target.hostname === 'www.data.jma.go.jp'
      ? 'ja,en;q=0.8,zh-HK;q=0.6'
      : 'zh-CN,zh;q=0.9,zh-HK;q=0.8,en;q=0.7'
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

async function fetchAllowedTarget(target, rule) {
  const attempts = [];
  for (const url of candidateUrls(target)) {
    try {
      const upstream = await fetch(url, {
        method: 'GET',
        headers: upstreamHeaders(new URL(url), rule),
        redirect: 'follow',
        cf: { cacheEverything: true, cacheTtl: rule.cacheTtl }
      });
      const body = await upstream.arrayBuffer();
      const preview = new TextDecoder().decode(body.slice(0, 2400));
      attempts.push({ url, status: upstream.status, preview: preview.replace(/\s+/g, ' ').slice(0, 300) });
      if (!upstream.ok || looksLikeChallenge(preview)) continue;
      if (!preview.includes('{') && !preview.includes('[') && target.hostname === 'typhoon.nmc.cn') continue;
      if (!preview.trimStart().startsWith('<') && target.hostname === 'www.data.jma.go.jp') continue;
      return { ok: true, url, upstream, body, text: new TextDecoder().decode(body), attempts };
    } catch (error) {
      attempts.push({ url, status: 0, preview: String(error?.message || error) });
    }
  }
  return { ok: false, attempts };
}

function latestForecastContainer(stormInfo) {
  const history = Array.isArray(stormInfo?.[8]) ? stormInfo[8] : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const container = history[index]?.[11];
    if (container && typeof container === 'object' && !Array.isArray(container) && Object.keys(container).length) {
      return { point: history[index], container };
    }
  }
  return { point: null, container: {} };
}

async function probeNmcDetails() {
  const listTarget = new URL('https://typhoon.nmc.cn/weatherservice/typhoon/jsons/list_default');
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
    let forecastBaseTime = null;
    let historyCount = 0;
    let parseError = null;

    if (result.ok) {
      try {
        const detail = parseWrappedJson(result.text);
        const stormInfo = detail?.typhoon;
        historyCount = Array.isArray(stormInfo?.[8]) ? stormInfo[8].length : 0;
        const latest = latestForecastContainer(stormInfo);
        forecastKeys = Object.keys(latest.container);
        forecastBaseTime = latest.point?.[1] || null;
      } catch (error) { parseError = error.message; }
    }

    details.push({
      id,
      nameEn: String(item?.[1] || ''),
      nameZh: String(item?.[2] || ''),
      ok: result.ok && !parseError,
      historyCount,
      forecastBaseTime,
      forecastKeys,
      hasCma: forecastKeys.some(key => key.toUpperCase() === 'BABJ'),
      hasJmaMirror: forecastKeys.some(key => key.toUpperCase() === 'RJTD'),
      parseError,
      attempts: result.attempts
    });
  }
  return { ok: true, stage: 'complete', activeCount: active.length, listAttempts: listResult.attempts, details };
}

function xmlEntityDecode(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripTags(value) {
  return xmlEntityDecode(String(value || '').replace(/<[^>]+>/g, '')).trim();
}

function extractJmaFeedCandidates(feedText) {
  const entries = String(feedText || '').match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  const candidates = [];
  const seenCodes = new Set();

  for (const entry of entries) {
    const title = stripTags((entry.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
    const updated = stripTags((entry.match(/<updated\b[^>]*>([\s\S]*?)<\/updated>/i) || [])[1]);
    const hrefMatch = entry.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
    const href = xmlEntityDecode(hrefMatch?.[1] || '');
    const codeMatch = href.match(/_VPTW(6[0-5])_/i);
    if (!href || !codeMatch) continue;
    if (!title.includes('台風解析・予報情報') && !href.toUpperCase().includes('VPTW')) continue;
    const code = `VPTW${codeMatch[1]}`.toUpperCase();
    if (seenCodes.has(code)) continue;
    seenCodes.add(code);
    candidates.push({ code, title, updated, href });
    if (candidates.length >= 6) break;
  }
  return candidates;
}

async function probeJma() {
  const feedTarget = new URL('https://www.data.jma.go.jp/developer/xml/feed/extra_l.xml');
  const feedResult = await fetchAllowedTarget(feedTarget, matchRule(feedTarget));
  if (!feedResult.ok) return { ok: false, stage: 'feed', feedAttempts: feedResult.attempts };

  const candidates = extractJmaFeedCandidates(feedResult.text);
  if (candidates.length === 0) {
    return { ok: true, stage: 'no-active-vptw', activeCount: 0, feedAttempts: feedResult.attempts, candidates: [] };
  }

  const sampleTarget = sanitizeTarget(new URL(candidates[0].href));
  const sampleRule = matchRule(sampleTarget);
  if (!sampleRule) {
    return { ok: false, stage: 'candidate-not-allowed', candidates, href: candidates[0].href };
  }

  const sampleResult = await fetchAllowedTarget(sampleTarget, sampleRule);
  const sample = sampleResult.ok ? sampleResult.text : '';
  return {
    ok: sampleResult.ok,
    stage: sampleResult.ok ? 'complete' : 'sample',
    activeCount: candidates.length,
    candidates,
    sampleChecks: sampleResult.ok ? {
      hasReport: /<Report\b/i.test(sample),
      hasMeteorologicalInfos: /<MeteorologicalInfos\b/i.test(sample),
      meteorologicalInfoCount: (sample.match(/<MeteorologicalInfo\b/gi) || []).length,
      dateTimeCount: (sample.match(/<DateTime\b/gi) || []).length,
      coordinateCount: (sample.match(/<(?:[A-Za-z0-9_]+:)?Coordinate\b/gi) || []).length,
      basePointCount: (sample.match(/<(?:[A-Za-z0-9_]+:)?BasePoint\b/gi) || []).length,
      probabilityCircleCount: (sample.match(/<ProbabilityCircle\b/gi) || []).length,
      hasTyphoonNamePart: /<TyphoonNamePart\b/i.test(sample),
      hasName: /<(?:[A-Za-z0-9_]+:)?Name\b/i.test(sample),
      hasNumber: /<(?:[A-Za-z0-9_]+:)?Number\b/i.test(sample),
      // 舊版檢查 TyphoonName，但 JMAXML 實際使用 TyphoonNamePart/Name。
      hasLegacyTyphoonNameTag: /<(?:[A-Za-z0-9_]+:)?TyphoonName\b/i.test(sample)
    } : null,
    feedAttempts: feedResult.attempts,
    sampleAttempts: sampleResult.attempts
  };
}


const CWA_DATASET_ID = 'W-C0034-005';
const CWA_API_URL = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${CWA_DATASET_ID}?format=JSON`;

function getCwaAuthorization(env) {
  const value = String(env?.CWA_AUTHORIZATION || '').trim();
  return value;
}

function truncateText(value, maxLength = 1000) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function collectArrayPaths(value, path = '$', output = [], depth = 0) {
  if (depth > 7 || output.length >= 30 || value == null) return output;
  if (Array.isArray(value)) {
    output.push({ path, length: value.length });
    for (let index = 0; index < Math.min(value.length, 2); index += 1) {
      collectArrayPaths(value[index], `${path}[${index}]`, output, depth + 1);
    }
    return output;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value).slice(0, 40)) {
      collectArrayPaths(child, `${path}.${key}`, output, depth + 1);
      if (output.length >= 30) break;
    }
  }
  return output;
}

function summarizeCwaPayload(data) {
  const records = data?.records;
  const result = data?.result;
  return {
    success: data?.success ?? null,
    topLevelKeys: data && typeof data === 'object' ? Object.keys(data) : [],
    resultKeys: result && typeof result === 'object' ? Object.keys(result) : [],
    recordsType: Array.isArray(records) ? 'array' : (records === null ? 'null' : typeof records),
    recordsKeys: records && typeof records === 'object' && !Array.isArray(records) ? Object.keys(records) : [],
    arrayPaths: collectArrayPaths(data)
  };
}

async function fetchCwaData(env) {
  const authorization = getCwaAuthorization(env);
  if (!authorization) {
    return {
      ok: false,
      configured: false,
      status: 503,
      error: 'Worker Secret CWA_AUTHORIZATION is not configured'
    };
  }

  try {
    const response = await fetch(CWA_API_URL, {
      method: 'GET',
      headers: {
        Authorization: authorization,
        Accept: 'application/json',
        'User-Agent': 'Storm-Track-Viewer/2.5'
      },
      redirect: 'follow',
      cf: { cacheEverything: true, cacheTtl: 180 }
    });

    const text = await response.text();
    let data = null;
    let parseError = null;
    try { data = JSON.parse(text); }
    catch (error) { parseError = error?.message || String(error); }

    const apiSuccess = data?.success;
    const ok = response.ok && !parseError && apiSuccess !== false && apiSuccess !== 'false';

    return {
      ok,
      configured: true,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      etag: response.headers.get('etag') || null,
      data,
      text,
      parseError,
      summary: data ? summarizeCwaPayload(data) : null
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      status: 0,
      error: error?.message || String(error)
    };
  }
}

async function probeCwa(env) {
  const result = await fetchCwaData(env);
  return {
    ok: result.ok,
    configured: result.configured,
    dataset: CWA_DATASET_ID,
    upstreamStatus: result.status,
    contentType: result.contentType || null,
    etag: result.etag || null,
    parseError: result.parseError || null,
    error: result.error || null,
    summary: result.summary || null,
    preview: truncateText(result.text || result.error || '', 1200)
  };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405);

    const incoming = new URL(request.url);
    if (incoming.pathname === '/health') {
      return jsonResponse({
        ok: true,
        version: VERSION,
        service: 'HKO + CMA + JMA + CWA tropical cyclone data proxy',
        allowed_sources: [
          'Hong Kong Observatory official XML',
          'China NMC JSONP (BABJ/CMA)',
          'Japan Meteorological Agency official Atom/VPTW XML',
          'Taiwan Central Weather Administration W-C0034-005 official API'
        ],
        diagnostics: ['/probe/cma', '/probe/nmc', '/probe/jma', '/probe/cwa'],
        api: ['/api/cwa'],
        cwa_configured: Boolean(getCwaAuthorization(env))
      });
    }

    if (incoming.pathname === '/probe/cma' || incoming.pathname === '/probe/nmc') {
      const result = await probeNmcDetails();
      return jsonResponse({ version: VERSION, ...result }, result.ok ? 200 : 502);
    }

    if (incoming.pathname === '/probe/jma') {
      const result = await probeJma();
      return jsonResponse({ version: VERSION, ...result }, result.ok ? 200 : 502);
    }

    if (incoming.pathname === '/probe/cwa') {
      const result = await probeCwa(env);
      return jsonResponse({ version: VERSION, ...result }, result.ok ? 200 : (result.configured ? 502 : 503));
    }

    if (incoming.pathname === '/api/cwa') {
      const result = await fetchCwaData(env);
      if (!result.ok) {
        return jsonResponse({
          version: VERSION,
          error: result.error || 'Failed to fetch CWA tropical cyclone track data',
          upstreamStatus: result.status,
          parseError: result.parseError || null,
          preview: truncateText(result.text || '', 500)
        }, result.configured ? 502 : 503);
      }

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
    }

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
};
