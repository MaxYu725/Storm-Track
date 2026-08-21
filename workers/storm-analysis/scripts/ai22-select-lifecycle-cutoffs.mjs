import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AGENCIES, SOURCE_DB } from './ai21-build-forecast-corpus.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function iso(value, label) {
  const ms = Date.parse(value);
  assert(Number.isFinite(ms), `${label} must be a valid timestamp`);
  return new Date(ms).toISOString();
}

function lexDesc(left, right) {
  return String(right).localeCompare(String(left));
}

function spread(items, count) {
  if (items.length <= count) return items.slice();
  if (count <= 1) return [items.at(-1)];
  const indices = [];
  for (let index = 0; index < count; index += 1) indices.push(Math.round(index * (items.length - 1) / (count - 1)));
  return Array.from(new Set(indices)).map(index => items[index]);
}

export function buildOperationalLifecycleEvidence(input, options = {}) {
  const storm = input?.storm;
  const stormKey = String(options.stormKey || storm?.id || storm?.storm_key || '').trim();
  assert(stormKey, 'stormKey is required');
  assert(stormKey === String(storm?.id || storm?.storm_key || '').trim(), 'storm metadata must match stormKey');
  assert(storm?.merged_into_id == null, `${stormKey} is merged into another production key`);
  assert(String(storm?.status || '').toLowerCase() !== 'merged', `${stormKey} is marked merged`);

  const rawAdvisories = Array.isArray(input?.advisories) ? input.advisories : [];
  const rawPoints = Array.isArray(input?.forecastPoints) ? input.forecastPoints : [];
  assert(rawAdvisories.length > 0, `${stormKey} has no forecast-bearing advisories`);
  assert(rawPoints.length > 0, `${stormKey} has no forecast points`);

  const pointsByAdvisory = new Map();
  for (const point of rawPoints) {
    const advisoryId = String(point?.advisory_id || '').trim();
    if (!advisoryId) continue;
    const validAt = iso(point.valid_at, `${advisoryId} valid_at`);
    const list = pointsByAdvisory.get(advisoryId) ?? [];
    list.push({ ...point, valid_at: validAt });
    pointsByAdvisory.set(advisoryId, list);
  }
  for (const list of pointsByAdvisory.values()) list.sort((a, b) => a.valid_at.localeCompare(b.valid_at) || Number(a.source_order ?? 0) - Number(b.source_order ?? 0));

  const advisories = rawAdvisories.map(row => ({
    ...row,
    id: String(row.id),
    storm_id: String(row.storm_id),
    agency: String(row.agency),
    issued_at: iso(row.issued_at, `${row.id} issued_at`),
    fetched_at: row.fetched_at ? iso(row.fetched_at, `${row.id} fetched_at`) : iso(row.issued_at, `${row.id} issued_at`)
  })).filter(row => row.storm_id === stormKey && AGENCIES.includes(row.agency) && pointsByAdvisory.has(row.id));
  assert(advisories.length > 0, `${stormKey} has no supported forecast-bearing advisories`);

  const candidateTimes = Array.from(new Set(advisories.map(row => row.issued_at))).sort();
  const stateAt = asOf => {
    const selected = [];
    for (const agency of AGENCIES) {
      const candidates = advisories.filter(row => row.agency === agency && row.issued_at <= asOf)
        .filter(row => (pointsByAdvisory.get(row.id) ?? []).some(point => point.valid_at > asOf))
        .sort((a, b) => b.issued_at.localeCompare(a.issued_at) || lexDesc(a.id, b.id));
      if (candidates[0]) selected.push(candidates[0]);
    }
    return { asOf, selected, agencyCount: selected.length, agencies: selected.map(row => row.agency).sort() };
  };

  const states = candidateTimes.map(stateAt).filter(item => item.agencyCount > 0);
  const maxAgencyCount = Math.max(...states.map(item => item.agencyCount));
  assert(maxAgencyCount >= 1, `${stormKey} has no usable forecast cutoff`);
  const preferred = states.filter(item => item.agencyCount === maxAgencyCount);
  const requestedCount = Math.max(1, Math.min(8, Number(options.snapshotCount ?? 4) || 4));
  const chosen = spread(preferred, requestedCount);
  assert(chosen.length > 0, `${stormKey} has no lifecycle cutoff candidates`);

  const selectedAdvisories = [];
  const forecastPoints = [];
  for (const state of chosen) {
    for (const advisory of state.selected) {
      selectedAdvisories.push({ ...advisory, as_of: state.asOf });
      const futurePoints = (pointsByAdvisory.get(advisory.id) ?? []).filter(point => point.valid_at > state.asOf);
      assert(futurePoints.length > 0, `${advisory.id} has no future point at ${state.asOf}`);
      for (const point of futurePoints) forecastPoints.push({
        ...point,
        storm_id: stormKey,
        agency: advisory.agency,
        as_of: state.asOf,
        advisory_id: advisory.id
      });
    }
  }

  const generatedAt = selectedAdvisories.map(row => row.fetched_at || row.issued_at).sort().at(-1);
  const cutoffs = chosen.map(item => item.asOf);
  const lifecycle = {
    windowId: String(options.windowId || `wp-${stormKey.replace(/^WP-/, '').toLowerCase()}-operational`).trim(),
    initialState: String(options.initialState || 'active').trim().toLowerCase()
  };
  const evidence = {
    sourceDatabase: SOURCE_DB,
    generatedAt,
    minimumAgencies: 1,
    storms: [{
      stormKey,
      nameEn: storm?.name_en ?? null,
      nameTc: storm?.name_zh ?? null,
      season: Number(options.season ?? 2026),
      basin: String(options.basin || 'WNP'),
      lifecycle,
      identity: {
        status: 'unreviewed',
        internationalNumber: storm?.international_number == null ? null : String(storm.international_number),
        source: 'storm-track-db/storms.international_number'
      },
      cutoffs,
      selectedAdvisories,
      forecastPoints
    }]
  };
  return {
    evidence,
    summary: {
      stormKey,
      status: storm?.status ?? null,
      productionInternationalNumber: storm?.international_number ?? null,
      maxAgencyCount,
      preferredCandidateCount: preferred.length,
      requestedSnapshotCount: requestedCount,
      selectedSnapshotCount: cutoffs.length,
      cutoffs: chosen.map(item => ({ asOf: item.asOf, agencies: item.agencies })),
      selectedAdvisoryCount: selectedAdvisories.length,
      forecastPointCount: forecastPoints.length,
      firstForecastIssueAt: advisories.map(row => row.issued_at).sort()[0],
      lastForecastIssueAt: advisories.map(row => row.issued_at).sort().at(-1),
      generatedAt,
      lifecycle
    }
  };
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith('--')) continue;
    const value = argv[index + 1];
    assert(value != null && !value.startsWith('--'), `${token} requires a value`);
    out[token.slice(2)] = value;
    index += 1;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assert(args.storm && args.advisories && args.points && args.output, 'usage: ai22-select-lifecycle-cutoffs.mjs --storm <json> --advisories <json> --points <json> --output <json> [--summary <json>] [--window-id <id>] [--snapshots <1..8>]');
  const result = buildOperationalLifecycleEvidence({
    storm: JSON.parse(fs.readFileSync(path.resolve(args.storm), 'utf8')),
    advisories: JSON.parse(fs.readFileSync(path.resolve(args.advisories), 'utf8')),
    forecastPoints: JSON.parse(fs.readFileSync(path.resolve(args.points), 'utf8'))
  }, {
    windowId: args['window-id'],
    snapshotCount: args.snapshots == null ? undefined : Number(args.snapshots)
  });
  fs.writeFileSync(path.resolve(args.output), `${JSON.stringify(result.evidence, null, 2)}\n`);
  if (args.summary) fs.writeFileSync(path.resolve(args.summary), `${JSON.stringify(result.summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, ...result.summary }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
  });
}
