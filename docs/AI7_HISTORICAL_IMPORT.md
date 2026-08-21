# AI-7 — Historical Backfill Importer + Learning D1 Schema

Status: **AI-7 checkpoint implementation**  
Branch: `feature/ai-analysis-engine`  
Parent: AI-6 `5825704a019d6df5e5801db695364cf8566ebdd3`

## Purpose

AI-7 creates the repository-side boundary for real historical backfill. It does not write the current production Storm Worker D1 and does not deploy a Worker.

Added:

- `analysis/historical-backfill-importer.js`
- `tests/historical-backfill-importer.test.cjs`
- `workers/storm-analysis/schema/0001_learning.sql`

The SQL schema is for a future **independent** analysis database (`ANALYSIS_DB`). It must not be applied to the existing production `DB` binding until a separate analysis Worker is intentionally created and reviewed.

## Canonical backfill roles

Historical data is split by role:

1. **truth** — later observed/best-track data used only by AI-4 verification;
2. **forecast** — the actual advisory/forecast payload that was available at the historical cutoff;
3. **official signal outcome** — explicit HKO outcome labels supplied from a trusted source.

A best track may be imported as truth. It may not be re-labelled as an old forecast.

## Forecast provenance

Accepted provenance types are:

```text
storm-track-d1
original-official-advisory
auditable-archive
unknown
```

A forecast case is eligible for walk-forward skill only when:

- provenance type is one of the first three;
- `dataRole` is forecast;
- provenance source is explicit;
- the original issue time is explicit;
- original issue time is not after the case `asOf` cutoff;
- the snapshot contains forecast points.

`unknown` provenance is retained for audit but excluded from agency skill.

## Idempotence

The importer creates stable fingerprints and primary keys from canonical content. Re-running the same input creates the same import plan instead of new logical rows.

Truth points are de-duplicated by dataset/time/position. SQL also enforces uniqueness for critical fingerprints.

## Learning D1 schema

`0001_learning.sql` defines isolated tables for:

```text
backfill_runs
historical_storms
truth_datasets
truth_points
forecast_snapshots
signal_outcomes
verification_results
agency_skill_profiles
adaptive_weight_candidates
model_versions
```

Large original upstream payloads can later be stored in an analysis R2 bucket and referenced by hash/URL; AI-7 v1 keeps replay-ready canonical snapshot JSON in D1 because the existing AI-1..AI-5 pipeline consumes those structures directly.

## Backfill capability

Each storm remains classified as:

```text
full-walk-forward
partial-walk-forward
truth-only
forecast-only
unavailable
```

Only a storm with explicit truth plus at least one trusted historical forecast case becomes eligible for agency skill.

## Safety semantics

```text
deterministicPlan = true
idempotentKeys = true
truthSourceExplicit = true
bestTrackMayBeTruthOnly = true
bestTrackMayNotBeForecastProvenance = true
unknownForecastProvenanceExcludedFromSkill = true
productionDatabaseWritten = false
workerDeployed = false
aiGenerated = false
```

## Validation

```bash
node --check analysis/historical-backfill-importer.js
node --check tests/historical-backfill-importer.test.cjs
node tests/historical-backfill-importer.test.cjs
```

The schema should also be parsed against a local SQLite-compatible engine before any D1 migration is run.

## Next checkpoint

AI-8 should implement the independent analysis Worker repository boundary and D1 repository/writer functions around this schema. It should support dry-run import first, use prepared statements/batches, preserve idempotence, and remain isolated from `storm.max-yu.workers.dev`.
