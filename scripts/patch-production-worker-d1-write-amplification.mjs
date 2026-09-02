import fs from 'node:fs';

const inputPath = process.argv[2] || 'worker.js';
const outputPath = process.argv[3] || 'worker.d1-fixed.js';
const BT = String.fromCharCode(96);
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

replaceOnce("const VERSION = '3.3.0-alpha.2';", "const VERSION = '3.3.0-alpha.3';", 'version');

replaceSection(
  'async function ensureStormRow(db, stormId, storm, seed = null) {',
  'async function deleteAdvisoryTree(db, advisoryId) {',
  String.raw`async function ensureStormRow(db, stormId, storm, seed = null) {
  const now = nowIso();
  const year = Number(storm.year) || yearFromTime(storm.issuedAt);
  const internationalNumber = normalizeInternationalNumber(storm.internationalNumber, year);
  const nameEn = preferredName(seed?.name_en, storm.nameEn);
  const nameZh = preferredName(seed?.name_zh, storm.nameZh);
  const firstSeen = [seed?.first_seen_at, storm.issuedAt].filter(Boolean).sort()[0] || storm.issuedAt;
  const lastSeen = [seed?.last_seen_at, storm.issuedAt].filter(Boolean).sort().at(-1) || storm.issuedAt;
  const desiredInternationalNumber = internationalNumber ?? seed?.international_number ?? null;
  const nameEnNorm = normalizeName(nameEn);
  const nameZhNorm = normalizeName(nameZh);

  // Most collection cycles see the same advisory again. Avoid a D1 write when
  // this row is already exactly what the incoming advisory would produce.
  if (
    seed?.id === stormId &&
    (seed.international_number ?? null) === desiredInternationalNumber &&
    String(seed.name_en || '') === nameEn &&
    String(seed.name_zh || '') === nameZh &&
    String(seed.name_en_norm || '') === nameEnNorm &&
    String(seed.name_zh_norm || '') === nameZhNorm &&
    String(seed.first_seen_at || '') === String(firstSeen || '') &&
    String(seed.last_seen_at || '') === String(lastSeen || '') &&
    seed.status === 'active' &&
    !seed.merged_into_id
  ) {
    return { written: false };
  }

  await db.prepare(${BT}
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
  ${BT}).bind(
    stormId, year, internationalNumber, nameEn, nameZh, nameEnNorm, nameZhNorm,
    firstSeen, lastSeen, seed?.created_at || now, now
  ).run();
  return { written: true };
}`,
  'ensureStormRow'
);

replaceSection(
  'async function upsertStormAndAlias(env, storm, stormId) {',
  'async function reconcileStormIdentities(env, options = {}) {',
  String.raw`async function upsertStormAndAlias(env, storm, stormId) {
  const db = await requireDatabase(env);
  const resolvedId = await resolveCanonicalStormId(db, stormId);
  const existing = await db.prepare('SELECT * FROM storms WHERE id=? LIMIT 1').bind(resolvedId).first();
  await ensureStormRow(db, resolvedId, storm, existing);

  const aliasName = storm.nameEn || storm.nameZh || '';
  const existingAlias = await db.prepare(${BT}
    SELECT storm_id, agency_name, first_seen_at, last_seen_at
    FROM storm_aliases WHERE agency=? AND agency_storm_id=? LIMIT 1
  ${BT}).bind(storm.agency, storm.sourceId).first();
  const desiredAliasName = aliasName || String(existingAlias?.agency_name || '');
  const desiredLastSeen = [existingAlias?.last_seen_at, storm.issuedAt].filter(Boolean).sort().at(-1) || storm.issuedAt;
  const aliasUnchanged = Boolean(existingAlias) &&
    existingAlias.storm_id === resolvedId &&
    String(existingAlias.agency_name || '') === desiredAliasName &&
    String(existingAlias.last_seen_at || '') === String(desiredLastSeen || '');

  if (!aliasUnchanged) {
    await db.prepare(${BT}
      INSERT INTO storm_aliases(storm_id, agency, agency_storm_id, agency_name, first_seen_at, last_seen_at)
      VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(agency, agency_storm_id) DO UPDATE SET
        storm_id=excluded.storm_id,
        agency_name=CASE WHEN excluded.agency_name<>'' THEN excluded.agency_name ELSE storm_aliases.agency_name END,
        last_seen_at=CASE WHEN excluded.last_seen_at>storm_aliases.last_seen_at THEN excluded.last_seen_at ELSE storm_aliases.last_seen_at END
    ${BT}).bind(resolvedId, storm.agency, storm.sourceId, aliasName, storm.issuedAt, storm.issuedAt).run();
  }
  return resolvedId;
}`,
  'upsertStormAndAlias'
);

const advisoryHelpers = String.raw`
function nullableNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function nullableText(value) {
  if (value == null || value === '') return null;
  return String(value);
}
function normalizedIncomingAdvisoryPoints(storm) {
  return asArray(storm?.points).map(point => ({
    pointType: String(point.pointType || ''),
    validAt: String(point.validAt || ''),
    forecastHour: nullableNumber(point.forecastHour),
    latitude: nullableNumber(point.latitude),
    longitude: nullableNumber(point.longitude),
    pressureHpa: nullableNumber(point.pressureHpa),
    windMs: nullableNumber(point.windMs),
    gustMs: nullableNumber(point.gustMs),
    windAveragingMinutes: nullableNumber(point.windAveragingMinutes),
    intensityCode: nullableText(point.intensityCode),
    intensityLabel: nullableText(point.intensityLabel),
    movementDirection: nullableText(point.movementDirection),
    movementSpeedKmh: nullableNumber(point.movementSpeedKmh),
    probabilityRadiusKm: nullableNumber(point.probabilityRadiusKm),
    sourceOrder: nullableNumber(point.sourceOrder),
    windRadii: asArray(point.windRadii).map(radius => ({
      thresholdCode: String(radius.thresholdCode || ''),
      thresholdMs: nullableNumber(radius.thresholdMs),
      ne: nullableNumber(radius.ne),
      se: nullableNumber(radius.se),
      sw: nullableNumber(radius.sw),
      nw: nullableNumber(radius.nw)
    }))
  }));
}

async function persistedAdvisoryMatches(db, advisoryId, storm) {
  const [pointResult, radiusResult] = await db.batch([
    db.prepare(${BT}
      SELECT id, point_type, valid_at, forecast_hour, latitude, longitude,
             pressure_hpa, wind_ms, gust_ms, wind_averaging_minutes, intensity_code, intensity_label,
             movement_direction, movement_speed_kmh, probability_radius_km, source_order
      FROM track_points WHERE advisory_id=? ORDER BY source_order
    ${BT}).bind(advisoryId),
    db.prepare(${BT}
      SELECT wr.id, wr.track_point_id, wr.threshold_code, wr.threshold_ms,
             wr.radius_ne_km, wr.radius_se_km, wr.radius_sw_km, wr.radius_nw_km
      FROM wind_radii wr
      JOIN track_points tp ON tp.id=wr.track_point_id
      WHERE tp.advisory_id=?
      ORDER BY tp.source_order, wr.id
    ${BT}).bind(advisoryId)
  ]);

  const incoming = normalizedIncomingAdvisoryPoints(storm);
  const points = pointResult.results || [];
  if (points.length !== incoming.length) return false;

  const radiiByPoint = new Map();
  for (const row of radiusResult.results || []) {
    if (!radiiByPoint.has(row.track_point_id)) radiiByPoint.set(row.track_point_id, []);
    radiiByPoint.get(row.track_point_id).push({
      thresholdCode: String(row.threshold_code || ''),
      thresholdMs: nullableNumber(row.threshold_ms),
      ne: nullableNumber(row.radius_ne_km),
      se: nullableNumber(row.radius_se_km),
      sw: nullableNumber(row.radius_sw_km),
      nw: nullableNumber(row.radius_nw_km)
    });
  }

  const persisted = points.map(row => ({
    pointType: String(row.point_type || ''),
    validAt: String(row.valid_at || ''),
    forecastHour: nullableNumber(row.forecast_hour),
    latitude: nullableNumber(row.latitude),
    longitude: nullableNumber(row.longitude),
    pressureHpa: nullableNumber(row.pressure_hpa),
    windMs: nullableNumber(row.wind_ms),
    gustMs: nullableNumber(row.gust_ms),
    windAveragingMinutes: nullableNumber(row.wind_averaging_minutes),
    intensityCode: nullableText(row.intensity_code),
    intensityLabel: nullableText(row.intensity_label),
    movementDirection: nullableText(row.movement_direction),
    movementSpeedKmh: nullableNumber(row.movement_speed_kmh),
    probabilityRadiusKm: nullableNumber(row.probability_radius_km),
    sourceOrder: nullableNumber(row.source_order),
    windRadii: radiiByPoint.get(row.id) || []
  }));

  return JSON.stringify(persisted) === JSON.stringify(incoming);
}
`;

replaceOnce(
  'async function ingestStormAdvisory(env, storm) {',
  advisoryHelpers.trimStart() + '\nasync function ingestStormAdvisory(env, storm) {',
  'advisory semantic helpers'
);

replaceOnce(
  "  const existing = await db.prepare('SELECT id, source_hash, ingest_status FROM advisories WHERE storm_id=? AND agency=? AND issued_at=? LIMIT 1')\n    .bind(stormId, storm.agency, storm.issuedAt).first();\n  if (existing?.source_hash === sourceHash && existing?.ingest_status === 'complete') {\n    return { outcome: 'duplicate', points: 0, rawWritten: raw.written ? 1 : 0, stormId, advisoryId: existing.id };\n  }",
  "  const existing = await db.prepare('SELECT id, source_hash, ingest_status, point_count FROM advisories WHERE storm_id=? AND agency=? AND issued_at=? LIMIT 1')\n    .bind(stormId, storm.agency, storm.issuedAt).first();\n  if (existing?.ingest_status === 'complete') {\n    if (existing.source_hash === sourceHash) {\n      return { outcome: 'duplicate', points: 0, rawWritten: raw.written ? 1 : 0, stormId, advisoryId: existing.id };\n    }\n    if (Number(existing.point_count || 0) === storm.points.length && await persistedAdvisoryMatches(db, existing.id, storm)) {\n      return { outcome: 'duplicate', points: 0, rawWritten: raw.written ? 1 : 0, stormId, advisoryId: existing.id };\n    }\n  }",
  'advisory duplicate guard'
);

replaceOnce(
  "async function collectAllAgencies(env, triggerType = 'manual') {\n  const probe = await probeDatabase(env);\n  if (!probe.databaseBound || !probe.tablesReady) {\n    throw new Error(`Database is not ready${probe.missingTables?.length ? `; missing: ${probe.missingTables.join(', ')}` : ''}`);\n  }\n  const db = env.DB;",
  "async function collectAllAgencies(env, triggerType = 'manual') {\n  const db = await requireDatabase(env);\n  const tables = await listDatabaseTables(env);\n  const missingTables = EXPECTED_TABLES.filter(table => !tables.includes(table));\n  if (missingTables.length) {\n    throw new Error(`Database is not ready; missing: ${missingTables.join(', ')}`);\n  }",
  'cron database readiness'
);

const requiredChecks = [
  "const VERSION = '3.3.0-alpha.3';",
  'async function persistedAdvisoryMatches(db, advisoryId, storm)',
  "SELECT id, source_hash, ingest_status, point_count FROM advisories",
  'const missingTables = EXPECTED_TABLES.filter',
  'const aliasUnchanged = Boolean(existingAlias)',
  'return { written: false };'
];
for (const check of requiredChecks) {
  if (!source.includes(check)) throw new Error(`Post-patch validation failed: ${check}`);
}

fs.writeFileSync(outputPath, source);
console.log(`Patched ${inputPath} -> ${outputPath}`);
