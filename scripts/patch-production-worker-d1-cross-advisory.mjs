import fs from 'node:fs';

const inputPath = process.argv[2] || 'backend/worker.js';
const outputPath = process.argv[3] || 'backend/worker.alpha4.js';
let source = fs.readFileSync(inputPath, 'utf8');

function replaceOnce(search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`Missing patch target: ${label}`);
  if (source.indexOf(search, first + search.length) >= 0) throw new Error(`Patch target is not unique: ${label}`);
  source = source.slice(0, first) + replacement + source.slice(first + search.length);
}

function replaceSection(startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing section start: ${label}`);
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`Missing section end: ${label}`);
  source = source.slice(0, start) + replacement.trimEnd() + '\n\n' + source.slice(end);
}

if (source.includes("const VERSION = '3.3.0-alpha.3';")) {
  replaceOnce("const VERSION = '3.3.0-alpha.3';", "const VERSION = '3.3.0-alpha.4';", 'version');
} else if (!source.includes("const VERSION = '3.3.0-alpha.4';")) {
  throw new Error('Expected production Worker v3.3.0-alpha.3 or alpha.4');
}

if (!source.includes('const latestAnalysis = normalizedAnalysis.reduce')) {
  replaceSection(
    'function makeCollectedStorm(data) {',
    'function parseCycloneList(xmlText) {',
    `function makeCollectedStorm(data) {
  const normalizedAnalysis = asArray(data.positions)
    .map((point, index) => normalizePoint(point, 'analysis', index))
    .filter(Boolean);

  // Upstream HKO/CMA/CWA payloads can include the full observed history on
  // every new bulletin. Persist only the latest analysis fix for this
  // advisory; earlier analysis fixes already exist in earlier advisories and
  // can be reconstructed read-only by the history API. This turns the archive
  // from O(n²) repeated analysis storage into O(n) while keeping raw source
  // documents immutable in R2.
  const latestAnalysis = normalizedAnalysis.reduce((latest, point) => {
    if (!latest) return point;
    return new Date(point.validAt).getTime() >= new Date(latest.validAt).getTime() ? point : latest;
  }, null);
  const analysis = latestAnalysis ? [{ ...latestAnalysis, sourceOrder: 0 }] : [];

  const forecast = asArray(data.forecast)
    .map((point, index) => normalizePoint(point, 'forecast', analysis.length + index))
    .filter(Boolean);
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
    sourceId: String(data.sourceId || '').trim() || \`${'${data.agency}'}-${'${year}'}\`,
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
}`,
    'makeCollectedStorm'
  );
}

const oldAdvisoryQuality = `function advisoryQuality(row) {
  return (row?.ingest_status === 'complete' ? 1000000 : 0) + Number(row?.point_count || 0) * 1000 + new Date(row?.updated_at || 0).getTime() / 1e13;
}`;
const newAdvisoryQuality = `function advisoryQuality(row) {
  const currentParser = row?.parser_version === VERSION ? 1 : 0;
  return (row?.ingest_status === 'complete' ? 1000000 : 0) + currentParser * 10000 + new Date(row?.updated_at || 0).getTime() / 1e13;
}`;
if (source.includes(oldAdvisoryQuality)) {
  replaceOnce(oldAdvisoryQuality, newAdvisoryQuality, 'advisoryQuality');
} else if (!source.includes('const currentParser = row?.parser_version === VERSION ? 1 : 0;')) {
  throw new Error('Unexpected advisoryQuality implementation');
}

if (!source.includes('const seenAnalysisTimes = new Set();')) {
  replaceSection(
    'async function historyAdvisoryDetail(advisoryId, env) {',
    'async function historyLatest(incoming, env) {',
    `async function historyAdvisoryDetail(advisoryId, env) {
  const advisory = await env.DB.prepare(\`
    SELECT id, storm_id, agency, issued_at, fetched_at, source_code, source_url,
           raw_object_key, parser_version, point_count
    FROM advisories WHERE id=? AND ingest_status='complete' LIMIT 1
  \`).bind(advisoryId).first();
  if (!advisory) return jsonResponse({ error: 'Advisory not found' }, 404);

  const [currentPointResult, currentRadiusResult, analysisPointResult, analysisRadiusResult] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM track_points WHERE advisory_id=? ORDER BY source_order').bind(advisoryId),
    env.DB.prepare(\`
      SELECT wr.* FROM wind_radii wr
      JOIN track_points tp ON tp.id=wr.track_point_id
      WHERE tp.advisory_id=? ORDER BY tp.source_order, wr.threshold_code
    \`).bind(advisoryId),
    env.DB.prepare(\`
      SELECT p.*, a.issued_at AS advisory_issued_at
      FROM track_points p
      JOIN advisories a ON a.id=p.advisory_id
      WHERE a.storm_id=? AND a.agency=? AND a.ingest_status='complete'
        AND a.issued_at<=? AND p.point_type='analysis'
      ORDER BY p.valid_at ASC, a.issued_at DESC, p.source_order DESC
    \`).bind(advisory.storm_id, advisory.agency, advisory.issued_at),
    env.DB.prepare(\`
      SELECT wr.*
      FROM wind_radii wr
      JOIN track_points tp ON tp.id=wr.track_point_id
      JOIN advisories a ON a.id=tp.advisory_id
      WHERE a.storm_id=? AND a.agency=? AND a.ingest_status='complete'
        AND a.issued_at<=? AND tp.point_type='analysis'
      ORDER BY tp.valid_at ASC, a.issued_at DESC, tp.source_order DESC, wr.threshold_code
    \`).bind(advisory.storm_id, advisory.agency, advisory.issued_at)
  ]);

  const currentRadiiByPoint = new Map();
  for (const radius of currentRadiusResult.results || []) {
    if (!currentRadiiByPoint.has(radius.track_point_id)) currentRadiiByPoint.set(radius.track_point_id, []);
    currentRadiiByPoint.get(radius.track_point_id).push(radius);
  }

  const analysisRadiiByPoint = new Map();
  for (const radius of analysisRadiusResult.results || []) {
    if (!analysisRadiiByPoint.has(radius.track_point_id)) analysisRadiiByPoint.set(radius.track_point_id, []);
    analysisRadiiByPoint.get(radius.track_point_id).push(radius);
  }

  // Legacy advisories may contain the same analysis fix repeatedly. For each
  // valid time, keep the newest version that existed at or before the selected
  // bulletin. The issued_at cutoff prevents future leakage during replay.
  const seenAnalysisTimes = new Set();
  const analysisPoints = [];
  for (const point of analysisPointResult.results || []) {
    const key = String(point.valid_at || '');
    if (!key || seenAnalysisTimes.has(key)) continue;
    seenAnalysisTimes.add(key);
    const { advisory_issued_at, ...cleanPoint } = point;
    analysisPoints.push({ ...cleanPoint, windRadii: analysisRadiiByPoint.get(point.id) || [] });
  }

  const forecastPoints = (currentPointResult.results || [])
    .filter(point => point.point_type === 'forecast')
    .map(point => ({ ...point, windRadii: currentRadiiByPoint.get(point.id) || [] }));

  const normalizedAnalysis = analysisPoints.map((point, index) => ({ ...point, source_order: index }));
  const normalizedForecast = forecastPoints.map((point, index) => ({ ...point, source_order: normalizedAnalysis.length + index }));
  const points = [...normalizedAnalysis, ...normalizedForecast];

  return jsonResponse({ version: VERSION, advisory, points });
}`,
    'historyAdvisoryDetail'
  );
}

const requiredChecks = [
  "const VERSION = '3.3.0-alpha.4';",
  'const normalizedAnalysis = asArray(data.positions)',
  'const latestAnalysis = normalizedAnalysis.reduce',
  'const currentParser = row?.parser_version === VERSION ? 1 : 0;',
  'AND a.issued_at<=? AND p.point_type=\'analysis\'',
  'const seenAnalysisTimes = new Set();',
  'const forecastPoints = (currentPointResult.results || [])'
];
for (const check of requiredChecks) {
  if (!source.includes(check)) throw new Error(`Post-patch validation failed: ${check}`);
}

fs.writeFileSync(outputPath, source);
console.log(`Patched ${inputPath} -> ${outputPath}`);
