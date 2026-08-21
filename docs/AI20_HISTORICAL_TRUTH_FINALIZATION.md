# AI-20 — Historical Truth Finalization & Verification Readiness

Status: **Phase A — finality gate active; no truth import permitted yet**

AI-20 begins from completed AI-19 forecast-only pilot state. The existing `WP-2026-15` CHAN-HOM snapshots remain unchanged while the system waits for official finalized post-analysis truth.

## External truth authority

The only truth authority for this checkpoint is **JMA RSMC Tokyo Best Track** for international number `2615`.

Two independent official-publication checks must both pass before any truth-import plan may be generated:

1. `https://www.data.jma.go.jp/typhoon/position_table/table2026.html` must list 台風2615号 **without** `※`. JMA defines `※` as preliminary operational analysis; an unmarked entry is the finalized post-analysis value.
2. `https://www.jma.go.jp/jma/jma-eng/jma-center/rsmc-hp-pub-eg/Besttracks/bst2026.txt` must contain a `66666 2615` RSMC Best Track header with a valid revision date and the exact declared number of data lines.

If either check fails, AI-20 remains blocked. Preliminary position-table values are not a substitute for Best Track data, and forecast data must never be used as truth.

## Repository interlock

`.github/ai20-truth-trigger.txt` starts at `PENDING_AI20`.

Allowed lifecycle states:

- `PENDING_AI20` — finalized truth is not yet established; no truth import.
- `TRUTH_READY_AI20` — both official JMA finality checks passed and canonical truth evidence has been reviewed; still no automatic training or promotion.
- `COMPLETED_AI20` — a later controlled truth/verification checkpoint has completed and recorded evidence.

The read-only readiness workflow is allowed to detect that JMA has finalized 2615, but it must not mutate the lifecycle marker automatically and must not write D1.

## Current AI-19 state that must remain unchanged during Phase A

- `backfill_runs = 1`
- `historical_storms = 1`
- `forecast_snapshots = 4`
- `historical_storms.backfill_mode = forecast-only`
- `historical_storms.agency_skill_eligible = 0`
- `truth_datasets = 0`
- `truth_points = 0`
- `verification_results = 0`
- `agency_skill_profiles = 0`
- `adaptive_weight_candidates = 0`
- signal calibration `generation = 0`
- Signal Champion = NONE

## Canonical JMA truth contract

`workers/storm-analysis/scripts/ai20-jma-besttrack.mjs` parses the official RSMC text format and refuses canonical truth generation until both finality checks pass.

When finality is eventually satisfied, canonical truth must include:

- storm key `WP-2026-15`;
- international number `2615`;
- source `JMA RSMC Tokyo Best Track`;
- official source URL and position-table URL;
- JMA revision date as source version;
- explicit retrieval timestamp;
- center position, pressure, 10-minute maximum sustained wind and JMA grade from each Best Track data line;
- deterministic source-point IDs;
- SHA-256 hashes of both official source documents;
- semantics proving preliminary data and forecast data were not used as truth.

The parser validates the header-declared data-line count. A malformed or incomplete JMA block is a hard failure.

## Phase A hard prohibitions

AI-20 Phase A performs **no training** and **no promotion**. It also performs no truth import, verification write, curation, rollback, Worker deployment, secret mutation, production Storm D1 mutation, or Workers AI operation.

The readiness workflow may only:

- run repository regression tests;
- fetch the two official JMA public documents;
- compute finality status and source hashes;
- query `storm-analysis` D1 using SELECT-only checks to confirm AI-19 state remains unchanged.

## Future Phase B gate

Only after JMA 2615 is finalized will a separate reviewed checkpoint be allowed to:

1. generate canonical truth evidence;
2. build a bounded import plan against the existing four AI-19 snapshots;
3. preview the plan with no writes;
4. verify exact truth fingerprints and row counts;
5. explicitly activate a controlled truth import;
6. run forecast verification only after truth import succeeds.

Agency-skill profile generation, adaptive weighting, signal calibration training and any Champion promotion remain outside the automatic truth-import step and require later explicit checkpoints.
