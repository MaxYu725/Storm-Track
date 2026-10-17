# WEB-01 — HK Signal derived evaluation index capacity fix

## Confirmed production symptom (2026-10-17)

The HK Signal evaluator completes calculation and contract checks, then fails in `Persist derived evaluation state` when trying to push `data/hk-signal-evaluations`:

```
File index.ndjson is 100.03 MB; this exceeds GitHub's file size limit of 100.00 MB
GH001: Large files detected
```

The **existing** `data/hk-signal-evaluations/index.ndjson` blob is **104,852,983 bytes** (only 4,617 bytes below 100 MiB) and should be treated as an immutable historical index. No cleaning, truncation, rewriting, history rewriting or LFS migration is included in this PR.

## New data contract

From this change forward, each NEW evaluation fingerprint gets one immutable JSON file:

```
data/hk-signal-evaluations/
├── index.ndjson                                  # legacy, read-only
├── latest.json                                    # current full derived evaluation
├── cases/<case-id>/...                            # existing per-case data
└── index-shards/YYYY/MM/DD/<64-hex-fingerprint>.json
```

- Date folders are derived from `generatedAt` in **UTC**.
- New shard payloads preserve the exact field projection formerly appended as one compact JSON line to `index.ndjson`.
- A shard is written once with exclusive file creation and a **maximum 8 MiB**; existing identical content is idempotent, conflicting identical-path content fails closed.
- The writer validates a 64-character SHA-256 fingerprint and a parseable UTC date, and refuses missing evaluation/closeout arrays.
- Existing `latest.json` and `cases/` writing semantics stay the same.
- The workflow stages ONLY `latest.json`, `cases/` and `index-shards/`, never `index.ndjson`.
- Historical readers wanting a **complete** derived-evaluation history must combine legacy `index.ndjson` records with `index-shards/**/*.json`, then sort by `generatedAt` and deduplicate on `evaluationFingerprint`. Reading `index.ndjson` alone will only provide history up to the last successful legacy write.

No original prospective records or HKO truth are changed. This is a persistence-format change only; the deterministic V1/V2/Consensus logic, rubrics, truth attribution and scoring contracts are untouched.

## Verification

New test: `node --test tests/hk-signal-evaluation-index-shards.test.cjs`.

Test cases cover projection compatibility, old index/case immutability, idempotent retry, contradictory same-fingerprint data rejection, invalid identifiers and dates, 8-MiB guard, and workflow wiring.

The evaluator's existing regression/contract tests continue to run before writes. Check the first scheduled or manual evaluator run after merge:

1. `Persist derived evaluation state` completes successfully; `HEAD -> data/hk-signal-evaluations` is not rejected.
2. The data branch contains `index-shards/YYYY/MM/DD/<fingerprint>.json` matching `latest.json.evaluationFingerprint`.
3. Existing `index.ndjson` blob SHA (`818947807eb671cd1297d2f80817f87c7b7ba01d`) remains unchanged.
4. Original V1 evidence, HKO truth, and already stored case records remain intact.

**Important:** A passing PR test is not equivalent to verifying the production data branch push. Run a post-merge live evaluation before considering WEB-01 closed.
