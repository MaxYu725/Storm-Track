const preview = (value, limit = 5000) => String(value || '').slice(0, limit);

async function getText(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'Storm-Track-readonly-live-probe/1.0' } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}: ${preview(text, 500)}`);
  return text;
}

function parseJsonp(text) {
  const first = text.indexOf('(');
  const last = text.lastIndexOf(')');
  const raw = first >= 0 && last > first ? text.slice(first + 1, last) : text;
  return JSON.parse(raw.replace(/;\s*$/, ''));
}

console.log('LIVE_SOURCE_SMOKE_AT', new Date().toISOString());

try {
  const hkoList = await getText('https://www.weather.gov.hk/wxinfo/currwx/tc_list.xml');
  console.log('HKO_LIST', preview(hkoList, 8000));
  const urls = [...hkoList.matchAll(/<TropicalCycloneURL>([^<]+)<\/TropicalCycloneURL>/g)].map(match => match[1].replace(/&amp;/g, '&'));
  for (const url of urls.slice(0, 4)) {
    try {
      const track = await getText(url.startsWith('http') ? url : `https://www.weather.gov.hk${url}`);
      console.log('HKO_TRACK_URL', url);
      console.log('HKO_TRACK', preview(track, 12000));
    } catch (error) {
      console.log('HKO_TRACK_ERROR', url, error.message);
    }
  }
} catch (error) {
  console.log('HKO_LIST_ERROR', error.message);
}

try {
  const callback = 'storm_track_probe_list';
  const cmaListText = await getText(`https://typhoon.nmc.cn/weatherservice/typhoon/jsons/list_default?t=${Date.now()}&callback=${callback}`);
  const cmaList = parseJsonp(cmaListText);
  const list = Array.isArray(cmaList?.typhoonList) ? cmaList.typhoonList : [];
  const active = list.filter(item => ['start', 'active', '1'].includes(String(item?.[7] || '').trim().toLowerCase()));
  console.log('CMA_ACTIVE', JSON.stringify(active));
  for (const item of active.slice(0, 4)) {
    const id = String(item?.[0] || '').trim();
    if (!id) continue;
    try {
      const cb = `storm_track_probe_${id.replace(/[^A-Za-z0-9_]/g, '_')}`;
      const detailText = await getText(`https://typhoon.nmc.cn/weatherservice/typhoon/jsons/view_${encodeURIComponent(id)}?t=${Date.now()}&callback=${cb}`);
      console.log('CMA_DETAIL_ID', id);
      console.log('CMA_DETAIL', preview(detailText, 14000));
    } catch (error) {
      console.log('CMA_DETAIL_ERROR', id, error.message);
    }
  }
} catch (error) {
  console.log('CMA_LIST_ERROR', error.message);
}

try {
  const cwaText = await getText('https://storm.max-yu.workers.dev/api/cwa');
  const cwa = JSON.parse(cwaText);
  const raw = cwa?.records?.TropicalCyclones?.TropicalCyclone;
  const cyclones = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const summary = cyclones.map(item => {
    const analysis = item?.AnalysisData?.Fix;
    const forecast = item?.ForecastData?.Fix;
    const analyses = Array.isArray(analysis) ? analysis : analysis ? [analysis] : [];
    const forecasts = Array.isArray(forecast) ? forecast : forecast ? [forecast] : [];
    return {
      year: item?.Year,
      tdNo: item?.CwaTdNo,
      tyNo: item?.CwaTyNo,
      name: item?.TyphoonName,
      nameTc: item?.CwaTyphoonName,
      latestAnalysis: analyses.at(-1) || null,
      firstForecast: forecasts[0] || null,
      lastForecast: forecasts.at(-1) || null,
      forecastCount: forecasts.length
    };
  });
  console.log('CWA_SUMMARY', JSON.stringify(summary));
} catch (error) {
  console.log('CWA_ERROR', error.message);
}
