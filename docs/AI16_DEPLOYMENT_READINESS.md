# AI-16 — storm-analysis Deployment Readiness

Status: **repository-only deployment-readiness checkpoint**  
Branch: `feature/ai-analysis-engine`  
Parent checkpoint: AI-15 `02610f0d36c5d8f8d25a3bc186792e530e1e6221`  
Baseline: `b03d16149a33928a49790b0d8308dd31e40b1ed4`

## Scope and hard boundary

AI-16 makes the independent `storm-analysis` Worker ready for a later, explicitly authorized Cloudflare rollout. It does **not** create Cloudflare resources and does **not** deploy anything.

AI-16 does not:

- create the real `ANALYSIS_DB` D1 database;
- apply migrations to a remote D1 database;
- configure real `BACKFILL_TOKEN` or `ANALYSIS_ADMIN_TOKEN` secrets;
- deploy `storm-analysis`;
- modify or redeploy the production Storm Worker;
- modify `main`, the PWA, or GitHub Pages;
- restore any historical production `worker.js` source;
- enable automatic signal-profile promotion or Workers AI.

The production Storm Worker and its D1/R2 resources remain separate and must never be used as `ANALYSIS_DB`.

## AI-16 deliverables

- full `0001 → 0006` migration-chain validation;
- current Wrangler configuration review;
- Workers Vitest / Miniflare / workerd local integration harness with isolated D1;
- a deployment-target interlock for the all-zero D1 placeholder;
- future `ANALYSIS_DB` creation runbook;
- `BACKFILL_TOKEN` / `ANALYSIS_ADMIN_TOKEN` secret checklist;
- pre-deploy and post-deploy smoke-test checklist;
- Worker and D1 rollback runbook.

## Toolchain reviewed for AI-16

The Worker pins the deployment-test toolchain in `workers/storm-analysis/package.json`:

```text
wrangler                         4.124.0
vitest                           4.1.11
@cloudflare/vitest-pool-workers  0.22.0
```

Cloudflare's current Workers testing guidance recommends the Workers Vitest integration for local unit/integration tests. It runs on Miniflare/workerd and supports D1 migrations through `readD1Migrations()` and `applyD1Migrations()`.

Wrangler configuration reference:

- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/d1/reference/migrations/
- https://developers.cloudflare.com/workers/testing/vitest-integration/

## Wrangler configuration review

`workers/storm-analysis/wrangler.jsonc` intentionally contains only the independent D1 binding:

```text
binding       = ANALYSIS_DB
database_name = storm-analysis
migrations    = schema/
```

The `database_id` remains:

```text
00000000-0000-0000-0000-000000000000
```

This is an **AI-16 deployment interlock**, not a usable Cloudflare resource ID. A real deployment must fail readiness checks until this value is replaced with the ID returned by creating a new independent `storm-analysis` D1 database.

The config also:

- declares Wrangler's JSON schema;
- uses compatibility date `2026-08-20`;
- does not keep the now-redundant positive `nodejs_compat` flag for a post-`2026-08-04` compatibility date;
- keeps observability enabled;
- contains no production Storm Worker binding, R2 bucket, cron, route, or secret value.

### Deployment-target guard

Run:

```bash
cd workers/storm-analysis
npm run check:config
```

This validates the repository configuration while allowing the deliberate zero UUID placeholder.

Before a real deployment, run:

```bash
npm run check:deploy-target
```

This command must **fail** while the placeholder remains.

If the operator knows the production Storm Worker D1 ID, supply it as an extra safety comparison:

```bash
PRODUCTION_STORM_DB_ID=<production-db-uuid> npm run check:deploy-target
```

The guard refuses a deployment target whose `ANALYSIS_DB` ID equals `PRODUCTION_STORM_DB_ID`.

## Migration chain

The only valid initial migration order is:

```text
0001_learning.sql
0002_analysis_cache.sql
0003_signal_risk_calibration.sql
0004_signal_training_runs.sql
0005_signal_outcome_curations.sql
0006_signal_profile_promotions.sql
```

The order is not optional. In particular, `0004_signal_training_runs.sql` alters `signal_outcomes`, which is created by `0001_learning.sql`. `0006_signal_profile_promotions.sql` references both the calibration-profile and training-run tables created earlier in the chain.

AI-16 validates a brand-new database rather than applying only the latest migration.

Expected post-`0006` core tables include:

```text
historical_storms
truth_datasets
truth_points
forecast_snapshots
signal_outcomes
verification_results
agency_skill_profiles
adaptive_weight_candidates
model_versions
analysis_cache
signal_calibration_profiles
signal_calibration_training_runs
signal_outcome_curations
signal_calibration_state
signal_profile_promotion_events
```

Expected bootstrap state on an empty database:

```text
signal_calibration_state.state_id = 1
signal_calibration_state.champion_profile_id = NULL
signal_calibration_state.generation = 0
```

`signal_outcomes` must also contain the `official_hko` column introduced in `0004`.

## Local validation

From the repository root, the existing pure-Node suite remains available through the Worker package:

```bash
cd workers/storm-analysis
npm test
```

AI-16 adds `tests/storm-analysis-ai16.test.mjs`, which checks migration numbering, dependency markers, Wrangler safety fields, pinned tool versions, ignored secret/state files, the zero-UUID deployment interlock, and required runbook coverage.

### Workers Vitest / Miniflare integration

Install the pinned dev dependencies, then run:

```bash
cd workers/storm-analysis
npm install
npm run test:integration
```

The integration harness:

1. loads the real `wrangler.jsonc`;
2. creates an isolated local `ANALYSIS_DB` through Miniflare/workerd;
3. reads all migrations from `schema/`;
4. applies `0001 → 0006` with Cloudflare's D1 test migration helper;
5. checks the D1 migration history and required tables/columns;
6. calls the actual Worker `/health` route;
7. calls `/api/models/champion` through the actual Worker and D1 binding;
8. verifies write-capable admin routes remain disabled when local secrets are absent.

This is local-only. It must not use `wrangler dev --remote` or any remote D1 database for AI-16 validation.

### Optional local Wrangler flow

For manual local inspection after dependencies are installed:

```bash
npm run migrate:local
npm run dev:local
```

Wrangler local D1 state is written under `.wrangler/`, which is ignored by Git.

### Bundle-only dry run

A bundle/config dry run that does not upload the Worker is available as:

```bash
npm run deploy:dry-run
```

The command explicitly includes:

```text
--dry-run
--experimental-provision=false
```

The second guard prevents Wrangler's experimental resource auto-provisioning path from being used by the readiness command.

## Future ANALYSIS_DB creation runbook

**Do not execute this section as part of AI-16.** It is the procedure for a later authorized deployment checkpoint.

### 1. Confirm Cloudflare account and target

```bash
cd workers/storm-analysis
npx wrangler --version
npx wrangler whoami
npx wrangler d1 list
```

Confirm the account is the intended Storm Track account and identify the existing production Storm Worker database so it can be excluded explicitly.

### 2. Create a new independent D1 database

Storm Track is Hong Kong-focused, so the preferred location hint is APAC:

```bash
npx wrangler d1 create storm-analysis --location apac
```

Record the returned D1 UUID. Do not reuse any existing production Storm Worker D1 UUID.

### 3. Replace only the placeholder ID

Update:

```text
workers/storm-analysis/wrangler.jsonc
```

Replace only:

```text
00000000-0000-0000-0000-000000000000
```

with the newly created independent D1 UUID.

Do not add the production Storm Worker database as a second binding.

### 4. Run the deployment-target guard

```bash
PRODUCTION_STORM_DB_ID=<known-production-db-uuid> npm run check:deploy-target
```

Required result:

```text
ok = true
placeholder = false
binding = ANALYSIS_DB
databaseName = storm-analysis
```

If the production database ID is not known with certainty, stop and resolve that uncertainty before applying remote migrations.

### 5. Inspect migration plan

```bash
npx wrangler d1 migrations list storm-analysis --remote
```

The first remote database must report the six AI migrations as pending, in order.

### 6. Apply remote migrations

Only after the target ID has been independently verified:

```bash
npx wrangler d1 migrations apply storm-analysis --remote
```

Then verify:

```bash
npx wrangler d1 execute storm-analysis --remote --command "SELECT name FROM d1_migrations ORDER BY id;"
npx wrangler d1 execute storm-analysis --remote --command "SELECT state_id, champion_profile_id, generation FROM signal_calibration_state;"
```

Expected migration history: `0001` through `0006` exactly once. Expected initial calibration state on a new empty database: `(1, NULL, 0)`.

Do not deploy Worker code if migration application is incomplete or out of order.

## Secret checklist

Real secret values must never appear in Git, `wrangler.jsonc`, documentation, shell history copied into issues, screenshots, or frontend code.

Required secrets:

```text
BACKFILL_TOKEN
ANALYSIS_ADMIN_TOKEN
```

Requirements:

- generate two independent high-entropy random values;
- do not reuse `ADMIN_TOKEN` or any secret from the production Storm Worker;
- store both values in the operator's password/secret manager;
- do not use the same value for both purposes;
- never commit `.dev.vars`, `.dev.vars.*`, or `.secrets.*` files;
- local development may use throwaway values in `.dev.vars` only when needed;
- rotate either token immediately if it is exposed.

A suitable local generator is:

```bash
openssl rand -hex 32
```

After the Worker service exists in the later deployment checkpoint, set secrets interactively:

```bash
npx wrangler secret put BACKFILL_TOKEN
npx wrangler secret put ANALYSIS_ADMIN_TOKEN
npx wrangler secret list
```

Do not pipe literal secret values from a command that will be retained in shell history.

Until the secrets exist, `/health` must report:

```text
importEnabled = false
analysisAdminEnabled = false
```

After both are configured, those fields should be `true`.

## Pre-deploy checklist

- [ ] Branch is `feature/ai-analysis-engine` at the approved deployment checkpoint.
- [ ] `main` has not been modified for the deployment.
- [ ] Production Storm Worker source/configuration is not part of the change.
- [ ] `npm test` passes.
- [ ] `npm run test:integration` passes.
- [ ] `npm run deploy:dry-run` passes.
- [ ] Real `ANALYSIS_DB` is newly created and independent.
- [ ] `database_id` is not the all-zero placeholder.
- [ ] `database_id` is not the production Storm Worker D1 ID.
- [ ] `npm run check:deploy-target` passes.
- [ ] Remote D1 shows migrations `0001 → 0006` applied exactly once.
- [ ] `BACKFILL_TOKEN` and `ANALYSIS_ADMIN_TOKEN` are distinct and stored outside Git.
- [ ] No cron trigger, production route, R2 binding, or Workers AI binding has been added unintentionally.
- [ ] The previous Worker version ID is recorded if this is an upgrade rather than the first deployment.

## Future deployment sequence

**Not executed in AI-16.** Once all pre-deploy items are green and deployment is explicitly authorized:

1. run `npm run check:deploy-target`;
2. run `npm run test:integration`;
3. run `npm run deploy:dry-run`;
4. confirm remote D1 migration history;
5. deploy only `storm-analysis`, with Wrangler resource provisioning explicitly disabled;
6. record the resulting Worker version/deployment ID;
7. configure/verify the two independent secrets;
8. run the smoke-test checklist below;
9. stop immediately if any smoke check fails and follow the rollback runbook.

The future deployment command should keep resource auto-provisioning disabled:

```bash
npx wrangler deploy --experimental-provision=false
```

## Smoke-test checklist

Use the newly deployed `storm-analysis` hostname only. Do not run these checks against `storm.max-yu.workers.dev`.

### Read-only health

`GET /health` must return HTTP 200 and:

```text
ok = true
service = storm-analysis
analysisDbBound = true
workersAiEnabled = false
promotionApiEnabled = true
automaticPromotionEnabled = false
productionStormWorkerModified = false
```

Before secrets are configured:

```text
importEnabled = false
analysisAdminEnabled = false
```

After secrets are configured:

```text
importEnabled = true
analysisAdminEnabled = true
```

### Read-only D1 route

`GET /api/models/champion` must return HTTP 200. On a new empty database it should return the deterministic built-in equal-weight Champion with:

```text
modelVersion = builtin-equal-v1
persisted = false
readOnly = true
```

### Signal calibration read route

`GET /api/signal-risk/profiles/champion` must return HTTP 200. A new database may legitimately return:

```text
available = false
profile = null
readOnly = true
```

### Authentication gates

Without an Authorization header, write-capable endpoints must reject the request. Check at least:

```text
POST /api/backfill/import
POST /api/admin/signal-training/preview
POST /api/admin/signal-risk/promotion/preview
```

After secrets are configured, retry with deliberately invalid bearer tokens and require HTTP 401. Do **not** perform a real import, training run, promotion, or rollback as a smoke test.

### Production isolation

Independently confirm:

- production Storm Track PWA still loads normally;
- `https://storm.max-yu.workers.dev/health` remains the existing production Storm Worker, not `storm-analysis`;
- no production D1/R2 schema or data changed;
- no new production cron was added.

## Rollback runbook

### A. Failure before Worker deployment

If D1 creation or migration validation fails before Worker deployment:

1. stop;
2. do not deploy `storm-analysis`;
3. preserve the error output and migration history;
4. do not attempt ad-hoc SQL fixes on the production Storm database;
5. repair the migration/configuration in a new repository checkpoint and retest locally.

Because the first `ANALYSIS_DB` is intended to be a new independent database, recreation may be considered only with explicit authorization and only after confirming it contains no irreplaceable analysis data.

### B. Worker code/config regression after deployment

List recent versions/deployments and identify the known-good version:

```bash
npx wrangler versions list
npx wrangler deployments list
```

Rollback the `storm-analysis` Worker only:

```bash
npx wrangler rollback <KNOWN_GOOD_VERSION_ID> --message "storm-analysis rollback"
```

Cloudflare Worker rollback changes the active Worker version; it does **not** roll back D1 data/schema. Do not assume Worker rollback reverses migrations.

### C. D1 migration/data problem

For AI-16's initial `0001 → 0006` deployment, migrations are applied before Worker deployment. If they fail, the Worker should never be deployed.

For future schema changes after analysis data exists:

1. export/backup the independent `storm-analysis` D1 before migration;
2. apply only reviewed forward migrations;
3. never apply a reverse migration to the production Storm Worker database;
4. if restoration is required, use a separately reviewed D1 recovery procedure and confirm the target database ID first.

A Worker version rollback must not be used as a substitute for database recovery.

### D. Secret exposure

If either token is exposed:

1. rotate only the affected `storm-analysis` secret immediately;
2. verify `/health` and authentication gates;
3. review logs for unauthorized import/admin requests;
4. do not rotate or modify production Storm Worker secrets unless they were separately exposed.

## AI-16 completion criteria

AI-16 is complete when the repository contains and passes the static readiness checks, the complete migration chain has been validated from an empty SQLite/D1-compatible database, the Miniflare/workerd integration harness is present for local execution, and all creation/deploy/rollback procedures are documented while the real Cloudflare resources remain untouched.

The next checkpoint may perform the actual independent Cloudflare provisioning/deployment only after explicit authorization.
