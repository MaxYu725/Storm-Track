# AI-20 — Verification Persistence Readiness

Status: **local persistence contract validated; remote verification persistence remains disabled by process**

This checkpoint prepares the D1 repository semantics that will eventually store deterministic `verification_results`. It does not add a live activation workflow, does not deploy Worker code, and does not write remote `storm-analysis` verification rows.

## Repository contract

`workers/storm-analysis/src/verification-result-repository.js` provides:

- strict row validation for `forecast-verification/v1`;
- SHA-256 fingerprint format validation;
- valid JSON validation for result/calibration payloads;
- explicit batch-size bound;
- dry-run preview with `writesPerformed=false`;
- exact replay idempotency;
- `verification_id` conflict rejection;
- fingerprint reuse conflict rejection;
- snapshot + truth dataset + verification version semantic-conflict rejection;
- complete conflict preflight before any batch write;
- D1 batch persistence only after every requested row passes preflight.

The repository is not wired to a live Worker route in this checkpoint.

## Local D1 integration evidence

Read-only CI orchestration run: `32454178120`

Final audit job containing the persistence tests: `96690026040`

Feature checkout tested by that job: `890788596edefb6d36d66f3193067ed87d2f6258`

The Miniflare/D1 suite passed:

- test files: 2 passed
- tests: 10 passed
- existing AI-16 Worker/D1 integration: 4 tests
- verification-result repository integration: 6 tests

The verification repository tests perform writes only to the isolated local Miniflare D1. They verify:

1. preview is no-write;
2. first persist inserts exactly once;
3. exact replay returns already-persisted without another write;
4. same verification ID with different content is rejected;
5. same fingerprint on a different verification row is rejected;
6. same snapshot/truth/version with different evidence is rejected;
7. when a batch contains an earlier novel row and a later conflicting row, the novel row is not partially persisted.

## Remote safety check

The same audit finished with a SELECT-only check against the remote `storm-analysis` database and recorded:

- `truth_datasets = 0`
- `truth_points = 0`
- `verification_results = 0`
- `agency_skill_profiles = 0`
- `adaptive_weight_candidates = 0`
- training / curation / promotion rows = 0
- generation = 0
- Champion = NONE
- `AI20_TRUTH_WRITE_PERFORMED=false`
- `AI20_VERIFICATION_PERFORMED=false`
- `AI20_TRAINING_PERFORMED=false`
- `AI20_PROMOTION_PERFORMED=false`
- `DIAG_MUTATIONS_PERFORMED=false`

JMA 2615 remained preliminary and absent from finalized `bst2026.txt`, so the AI-20 truth gate remains closed.

## Next persistence gate

Do not expose or execute a remote verification-persist action until:

1. JMA 2615 is finalized by both official finality conditions;
2. the finalized truth augmentation plan has been hash-reviewed and imported under a separate explicit gate;
3. the four proposed verification rows have been regenerated from the exact imported truth/snapshot identities and compared with the reviewed preview fingerprints;
4. a remote preflight confirms no unexpected `verification_results` rows already exist.

Training and Champion promotion remain later, independently gated operations.
