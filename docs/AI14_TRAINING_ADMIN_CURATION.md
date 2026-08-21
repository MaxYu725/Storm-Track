# AI-14 — Authenticated Training Admin API + Outcome Curation

Status: **AI-14 checkpoint implementation**  
Branch: `feature/ai-analysis-engine`  
Parent: AI-13 `d16aadd72fc1edd90b625d160bb4baf08683423b`

## Purpose

AI-14 exposes the AI-13 historical signal-calibration training pipeline through a deliberately narrow administrator API and adds explicit audit-backed curation for `signal_outcomes.official_hko`.

It does **not** add Champion promotion, scheduled training, deployment, Workers AI, or any production Storm Worker change.

## Separate administrator secret

New administrator routes require:

```text
ANALYSIS_ADMIN_TOKEN
```

This is a separate secret from:

```text
BACKFILL_TOKEN
production Storm Worker ADMIN_TOKEN
```

The value is not stored in source or `wrangler.jsonc`. When the independent Worker is eventually deployed, it should be configured as a Cloudflare Worker secret.

Bearer token comparison hashes both values with SHA-256 and uses Workers `crypto.subtle.timingSafeEqual()` when available, with the existing fixed-length fallback retained for local Node tests.

## Training preview

```text
POST /api/admin/signal-training/preview
```

The endpoint is authenticated and read-only. It loads the same AI-13 historical replay dataset that a training run would use and returns:

```text
datasetFingerprint
coverage
rejectedCases
rejectedOutcomeStorms
storm summaries
current Champion calibration profile id
Champion holdout-independence confirmation
potential walk-forward holdout storms
synchronous run safety limits
inputFingerprint
```

No training-run row or Challenger profile is written.

## Preview-to-run fingerprint confirmation

```text
POST /api/admin/signal-training/run
```

A run requires:

```text
runId
challengerProfileId
expectedDatasetFingerprint
```

`expectedDatasetFingerprint` must be copied from the preview response. If forecast snapshots, curated outcomes, historical model weights, weighted-track options, or other dataset-fingerprint inputs change between preview and run, the request fails with:

```text
409 training-dataset-changed
```

This prevents an administrator from previewing one historical dataset and accidentally training a different one.

The existing AI-13 idempotent training-run fingerprint remains in effect after this confirmation gate.

## Synchronous safety limits

The admin run endpoint is intentionally bounded because AI-14 does not yet introduce Cloudflare Workflows or Queues.

Defaults:

```text
maximumStorms = 250
maximumCases = 5000
```

Preview reports whether the dataset is within these limits. A run exceeding them fails with `413 training-dataset-too-large`; the caller must narrow `datasetOptions` or a future checkpoint must move bulk training to an asynchronous durable workflow.

## Explicit HKO outcome curation

```text
POST /api/admin/signal-outcomes/curate
```

Required request fields:

```text
curationId
outcomeId
expectedFingerprint
officialHko
reason
```

When setting:

```text
officialHko = true
```

an `http(s)` `evidenceUrl` is also mandatory, and the stored outcome must already have:

```text
signal_system_era = modern
supported highest_signal
```

AI-14 still does not infer official status from `source`, URL host, year, storm name, or signal text.

`expectedFingerprint` provides optimistic concurrency protection. If the reviewed outcome changed before submission, the curation is rejected with `409 signal-outcome-changed`.

## Curation audit

Migration:

```text
0005_signal_outcome_curations.sql
```

adds:

```text
signal_outcome_curations
```

Each audit row stores:

```text
curation_id
outcome_id
storm_key
expected_fingerprint
official_hko
evidence_url
reason
actor_label
auth_method
created_at
```

`curationId` is the idempotency key. Reusing the same id with different curation content returns `409 curation-id-conflict`.

The D1 batch writes the audit record from a fingerprint-matched `signal_outcomes` row and then updates `official_hko` using the same fingerprint condition. The repository verifies the audit and final state after the batch.

`actorLabel` is optional descriptive audit text only. It is not treated as an authenticated user identity; authentication is the bearer secret.

## Admin API surface after AI-14

```text
POST /api/admin/signal-training/preview
POST /api/admin/signal-training/run
POST /api/admin/signal-outcomes/curate
```

There remains deliberately no endpoint such as:

```text
POST /api/admin/signal-risk/promote
```

Health metadata explicitly reports:

```text
analysisAdminEnabled
promotionApiEnabled = false
```

## Safety semantics

AI-14 preserves:

```text
training != promotion
curation != automatic provenance inference
preview != write
Challenger role remains challenger
automaticPromotion = false
promotionPerformed = false
productionDatabaseWritten = false
```

## Validation

Checkpoint verification includes:

```text
node --check signal-training-runner.js
node --check outcome-curation-repository.js
node --check index.js
node --check storm-analysis-ai14.test.mjs
node tests/storm-analysis-ai14.test.mjs
```

Migration `0005_signal_outcome_curations.sql` is also executed against SQLite together with the required AI-13-era schema prerequisites.

Targeted tests cover:

- missing/invalid `ANALYSIS_ADMIN_TOKEN`;
- training preview performs no write;
- dataset fingerprint confirmation;
- synchronous dataset limits;
- explicit modern-era HKO curation requirements;
- evidence URL requirement;
- stale outcome fingerprint rejection;
- curation idempotence and conflict detection;
- admin training/curation HTTP routing;
- health metadata;
- absence of a promotion route.

## Not done in AI-14

- no real `ANALYSIS_ADMIN_TOKEN` is configured;
- no remote D1 migration;
- no actual HKO outcome is curated;
- no real historical training is run;
- no Champion promotion endpoint;
- no rollback/promotion transaction;
- no cron, Queue, or Workflow;
- no deployment;
- no Workers AI narrative;
- no production Storm Worker or PWA change.

## Next checkpoint

AI-15 should implement **manual Champion promotion + rollback**, requiring an eligible Challenger, explicit administrator confirmation, atomic role transition/audit, cache invalidation semantics, and a reversible previous-Champion record. Promotion must remain a separate operation from training.
