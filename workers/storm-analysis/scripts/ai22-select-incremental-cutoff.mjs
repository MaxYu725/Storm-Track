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

function normalizeExistingCutoffs(input) {
  const values = Array.isArray(input) ? input : [];
  const cutoffs = values.map((item, index) => iso(
    typeof item === 'string' ? item : (item?.as_of ?? item?.asOf),
    `existingCutoffs[${index}]`
  )).sort();
  assert(cutoffs.length > 0, 'at least one existing cutoff is required');
  assert(cutoffs.length <= 7, 'incremental selector supports at most seven existing cutoffs before one append');
  assert(new Set(cutoffs).size === cutoffs.length, 'existing cutoffs must be unique');
  return cutoffs;
}

export function buildIncrementalLifecycleEvidence(input, options = {}) {
  const storm = input?.storm;
  const stormKey = String(options.stormKey || storm?.id || storm?.storm_key || '').trim();
  assert(stormKey, 'stormKey is required');
  assert(stormKey === String(storm?.id || storm?.storm_key || '').trim(), 'storm metadata must match stormKey');
  assert(storm?.merged_into_id == null, `${stormKey} is merged into another production key`);
  assert(String(storm?.status || '').toLowerCase() !== 'merged', `${stormKey} is marked merged`);

  const existingCutoffs = normalizeExistingCutoffs(input?.existingCutoffs);
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
  for (const list of pointsByAdvisory.values()) {
    list.sort((a, b) => a.valid_at.localeCompare(b.valid_at) || Number(a.source_order ?? 0) - Number(b.source_order ?? 0));
  }

  const advisories = rawAdvisories.map(row => ({
    ...row,
    id: String(row.id),
    storm_id: String(row.storm_id),
    agency: String(row.agency),
    issued_at: iso(row.issued_at, `${row.id} issued_at`),
    fetched_at: row.fetched_at ? iso(row.fetched_at, `${row.id} fetched_at`) : iso(row.issued_at, `${row.id} issued_at`)
  })).filter(row => row.storm_id === stormKey && AGENCIES.includes(row.agency) && pointsByAdvisory.has(row.id));
  assert(advisories.length > 0, `${stormKey} has no supported forecast-bearing advisories`);

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

  const existingStates = existingCutoffs.map(cutoff => stateAt(cutoff));
  for (const state of existingStates) assert(state.agencyCount > 0, `${stormKey} existing cutoff ${state.asOf} no longer has a usable forecast state`);

  const latestExisting = existingCutoffs.at(-1);
  const existingSet = new Set(existingCutoffs);
  const candidateTimes = Array.from(new Set(advisories.map(row => row.issued_at))).sort();
  const newCandidates = candidateTimes
    .filter(asOf => asOf > latestExisting && !existingSet.has(asOf))
    .map(stateAt)
    .filter(state => state.agencyCount > 0);
  assert(newCandidates.length > 0, `${stormKey} has no new usable cutoff after ${latestExisting}`);
  const newState = newCandidates.at(-1);
  assert(!existingSet.has(newState.asOf), 'incremental cutoff must be genuinely new');

  const chosen = [...existingStates, newState].sort((a, b) => a.asOf.localeCompare(b.asOf));
  assert(chosen.length === existingCutoffs.length + 1, 'incremental evidence must add exactly one cutoff');
  assert(chosen.length <= 8, 'incremental evidence exceeds eight cutoffs');

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
  const lifecycle = {
    windowId: String(options.windowId || `wp-${stormKey.replace(/^WP-/, '').toLowerCase()}-operational`).trim(),
    initialState: 'active'
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
      cutoffs: chosen.map(item => item.asOf),
      selectedAdvisories,
      forecastPoints
    }]
  };

  return {
    evidence,
    summary: {
      stormKey,
      lifecycle,
      existingCutoffCount: existingCutoffs.length,
      existingCutoffs,
      newCutoff: { asOf: newState.asOf, agencies: newState.agencies },
      newAgencyCount: newState.agencyCount,
      selectedSnapshotCount: chosen.length,
      selectedAdvisoryCount: selectedAdvisories.length,
      forecastPointCount: forecastPoints.length,
      firstForecastIssueAt: advisories.map(row => row.issued_at).sort()[0],
      lastForecastIssueAt: advisories.map(row => row.issued_at).sort().at(-1),
      generatedAt,
      semantics: {
        preservesExistingCutoffs: true,
        appendsExactlyOneNewCutoff: true,
        newCutoffMustFollowLatestExisting: true,
        noMinimumAgencyGateBeyondOneUsableSource: true
      }
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
  assert(args.storm && args.advisories && args.points && args.existing && args.output,
    'usage: ai22-select-incremental-cutoff.mjs --storm <json> --advisories <json> --points <json> --existing <json> --output <json> [--summary <json>] [--window-id <id>]');
  const result = buildIncrementalLifecycleEvidence({
    storm: JSON.parse(fs.readFileSync(path.resolve(args.storm), 'utf8')),
    advisories: JSON.parse(fs.readFileSync(path.resolve(args.advisories), 'utf8')),
    forecastPoints: JSON.parse(fs.readFileSync(path.resolve(args.points), 'utf8')),
    existingCutoffs: JSON.parse(fs.readFileSync(path.resolve(args.existing), 'utf8'))
  }, { windowId: args['window-id'] });
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
