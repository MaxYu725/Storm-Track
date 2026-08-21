# AI-20 — Phase B Preparation Result

Status: **preparation complete; live truth remains blocked by JMA finalization**

This checkpoint prepares deterministic truth augmentation and verification-preview infrastructure while the official JMA 2615 post-analysis remains preliminary. It performs no live truth import, no verification-result write, no training, and no promotion.

## Authoritative forecast baseline

AI-20 does not rebuild the four AI-19 historical forecast snapshots from `chan-hom-pilot-input.json`. The authoritative baseline is the exact canonical plan that was actually imported by AI-19:

- AI-19 run ID: `ai19_chanhom_forecast_21b774c59c7773cd`
- AI-19 canonical plan SHA-256: `98a3a2d6c20e5a4704604ef7c58df49a7703b93f9399e2e74962bcd76d74573a`
- snapshot IDs: `ai19_chanhom_01` through `ai19_chanhom_04`

The AI-20 augmentation builder pins that plan SHA and reconstructs prediction cases from the canonical `forecast_snapshots` plan rows. Any baseline-plan drift is rejected before a truth plan can be produced.

This rule was added after a synthetic regression correctly detected that replaying the earlier stable-sorted pilot-input JSON could change the serialized `snapshot_json` byte ordering. The semantic forecast content was equivalent, but the canonical imported row bytes/fingerprint contract must not drift.

## Finalized-truth augmentation contract

`workers/storm-analysis/scripts/ai20-build-truth-augmentation-plan.mjs` now defines the future finalized-JMA augmentation semantics:

- target storm: `WP-2026-15`
- target JMA international number: `2615`
- finalized JMA truth only; preliminary `※` data remains rejected
- maximum finalized truth points: 64
- the run source binds both the finalized truth SHA-256 and the pinned AI-19 plan SHA-256
- all four AI-19 snapshot rows must remain byte-for-byte identical
- the historical storm upgrades from `forecast-only` to `full-walk-forward`
- `agency_skill_eligible` upgrades from `0` to `1` only in the proposed finalized-truth augmentation plan
- exactly one truth dataset is proposed
- truth-point row count must equal the finalized JMA Best Track point count
- no signal outcomes are added
- local plan preview only; no database write occurs in preparation tests

Synthetic finalized-JMA regression verifies finality gating, augmentation semantics, snapshot preservation, canonical-plan tamper rejection, and the 64-point bound.

## Deterministic verification preview

`workers/storm-analysis/scripts/ai20-preview-verification.mjs` prepares a pure in-memory verification preview for a future finalized-truth augmentation plan.

It:

- requires an explicit `verifiedAt` timestamp for deterministic output;
- requires one finalized truth dataset and the exact four forecast snapshots;
- requires proposed `full-walk-forward` / `agency_skill_eligible=1` capability;
- adapts canonical JMA structured wind/pressure values into the existing verification engine input contract;
- adapts stored forecast aliases `windMs` / `pressureHpa` on an immutable copy of each snapshot;
- runs the existing deterministic `forecast-verification/v1` engine;
- produces four deterministic proposed `verification_results` rows and fingerprints;
- does not persist those rows.

The synthetic preview regression requires real forecast/truth overlap and verifies that track, intensity, and pressure comparisons are non-empty. Re-running the exact same plan with the same `verifiedAt` must produce the exact same preview fingerprint and proposed rows.

## Audit evidence

Read-only GitHub Actions workflow run: `32454178120`

Final successful audit job: `96689486397`

Feature checkout tested by that job: `5ad32cf034e6c335572943858e723fc6df4d893b`

The audit passed:

- complete Node checkpoint suite;
- AI-20 JMA finality tests;
- AI-20 truth augmentation tests;
- AI-20 deterministic verification-preview tests;
- historical backfill importer regression;
- Workers Vitest / Miniflare D1 integration: 4/4;
- Wrangler dry-run;
- live JMA finality check;
- SELECT-only remote `storm-analysis` state verification.

The audit explicitly recorded:

- `AI20_TRUTH_WRITE_PERFORMED=false`
- `AI20_VERIFICATION_PERFORMED=false`
- `AI20_TRAINING_PERFORMED=false`
- `AI20_PROMOTION_PERFORMED=false`
- `DIAG_MUTATIONS_PERFORMED=false`

## Live state remains unchanged

At the final audit, JMA 2615 was still not finalized:

- position-table status: `preliminary`
- `bst2026.txt` target published: `false`
- readiness: `false`
- blocking reason: `jma-post-analysis-not-finalized`

`storm-analysis` remained at the AI-19 state:

- `backfill_runs = 1`
- `historical_storms = 1`
- `WP-2026-15.backfill_mode = forecast-only`
- `WP-2026-15.agency_skill_eligible = 0`
- `forecast_snapshots = 4`
- `truth_datasets = 0`
- `truth_points = 0`
- `verification_results = 0`
- `agency_skill_profiles = 0`
- `adaptive_weight_candidates = 0`
- training / curation / promotion rows = `0 / 0 / 0`
- signal calibration generation = `0`
- Signal Champion = `NONE`

## Gate remains closed

`.github/ai20-truth-trigger.txt` must remain `PENDING_AI20` until both official JMA finality conditions pass. No `data/ai20` live truth artifact should be generated before that point.

When JMA 2615 is finalized, Phase B can use the already-tested path:

1. fetch and hash the two official JMA documents;
2. canonicalize finalized truth;
3. build the hash-pinned augmentation plan from the exact imported AI-19 plan;
4. review truth point count and plan hashes;
5. run local/live plan preview without writes;
6. only then consider a separately gated truth import.

Verification persistence, agency-skill training, and Champion promotion remain separate later checkpoints.
