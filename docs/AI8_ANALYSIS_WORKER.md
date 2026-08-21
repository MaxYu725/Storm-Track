# AI-8 — Independent Analysis Worker / D1 Repository

Status: **AI-8 checkpoint implementation**  
Branch: `feature/ai-analysis-engine`  
Parent: AI-7 `cc40edc26d0507aadd65f777b895ae07463ea303`

## Boundary

AI-8 creates the code boundary for an independent `storm-analysis` Worker. It does **not** create a Cloudflare D1 database, apply migrations remotely, deploy a Worker, change `storm.max-yu.workers.dev`, or modify the existing production Storm Worker DB.

The only D1 binding name in this Worker is:

```text
ANALYSIS_DB
```

The existing production binding name `DB` is deliberately not used.

## Worker files

```text
workers/storm-analysis/
  package.json
  wrangler.jsonc
  schema/0001_learning.sql   # added in AI-7
  src/index.js
  src/backfill-repository.js
```

`wrangler.jsonc` contains an explicit placeholder database ID. It must not be replaced until a new independent analysis D1 resource is intentionally created.

## API v1

### `GET /health`

Returns service/binding readiness only. It does not query the production Storm Worker.

### `POST /api/backfill/plan`

Accepts an AI-7 `historical-backfill-import/v1` canonical plan and performs validation/dry-run only.

It returns row/table counts and always states:

```text
dryRun = true
writesPerformed = false
```

No D1 binding is required for this route.

### `POST /api/backfill/import`

Imports a validated AI-7 plan into `ANALYSIS_DB` only.

The route is disabled unless a `BACKFILL_TOKEN` secret binding exists and requires `Authorization: Bearer ...`. The secret is not stored in source or Wrangler config.

## Repository safety

The repository accepts only the six raw historical-import tables produced by AI-7:

```text
backfill_runs
historical_storms
truth_datasets
truth_points
forecast_snapshots
signal_outcomes
```

It rejects arbitrary table and column names. It does not allow the backfill endpoint to directly write model/skill/version tables.

All values use D1 prepared statements with bound parameters. `historical_storms` is an intentional upsert; immutable historical rows use `INSERT OR IGNORE` so replaying the same deterministic plan is idempotent.

## Run lifecycle and D1 batch semantics

A run is tracked as:

```text
planned -> importing -> completed
                    \-> failed
```

The importer checks `run_id` and run fingerprint before writes:

- completed same fingerprint -> `already-imported`;
- same `run_id` with different fingerprint -> HTTP 409 conflict;
- failed/partial run -> safe to retry because deterministic primary keys and immutable inserts are idempotent.

D1 `batch()` provides transaction semantics for each submitted batch. AI-8 deliberately does **not** claim that a multi-batch historical run is one global transaction. If a later batch fails, the run is marked `failed`; already committed batches remain and the same plan can be replayed safely.

Default repository batch size is 50 rows and plans are capped at 5,000 rows. HTTP JSON bodies are capped at 1 MiB before parsing.

## Worker practices

The Worker uses:

- current checkpoint compatibility date (`2026-08-21`);
- `nodejs_compat`;
- Workers observability/logging;
- D1 binding access rather than Cloudflare REST calls;
- bounded request-body streaming rather than unbounded `request.json()`;
- structured error logging;
- no request-scoped mutable module globals;
- awaited D1 operations;
- SHA-256 based constant-time bearer comparison for the import secret.

## Validation

Run:

```bash
node --check workers/storm-analysis/src/backfill-repository.js
node --check workers/storm-analysis/src/index.js
node tests/storm-analysis-worker.test.mjs
```

Tests cover dry-run validation, unsupported table/column rejection, prepared statements/batches, deterministic replay, conflicting run IDs, failed-run recovery state, import authorization, and the independent `ANALYSIS_DB` boundary.

## Not yet done

AI-8 does not:

- create or migrate remote D1;
- deploy the Worker;
- ingest JMA/HKO sources directly;
- run AI-5/AI-6 automatically after import;
- call Workers AI;
- expose generated storm narratives.

## Next checkpoint

AI-9 should add the deterministic analysis orchestration API above AI-1 through AI-6 and the first read-only learning queries from `ANALYSIS_DB`. The Workers AI narrative layer should remain after deterministic facts and model-version selection are stable.
