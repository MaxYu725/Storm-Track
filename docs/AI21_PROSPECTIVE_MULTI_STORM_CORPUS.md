# AI-21 — Prospective Multi-Storm Forecast Corpus

Status: **AI-21A started; remote corpus import remains locked**

AI-21 decouples forecast-evidence accumulation from the slow JMA post-analysis Best Track finalization schedule. Forecast evidence can be preserved now as `forecast-only`; finalized truth can be attached later under the existing AI-20 truth-finality contract.

## Why AI-21 exists

At the start of AI-21, JMA's finalized 2026 RSMC Best Track publication contains only 2601–2604. The production Storm archive begins materially on 2026-08-05, so those finalized storms do not overlap the available production forecast archive. Waiting for 2615 finalization would stall engineering and would also fail to build a multi-storm corpus for future skill evaluation.

AI-21 therefore treats forecast capture and truth finalization as separate lifecycle events:

1. preserve trusted historical forecast evidence while it exists;
2. keep the storm `forecast-only` and ineligible for agency-skill learning;
3. later attach finalized official truth with an explicit reviewed identity mapping;
4. only after truth is attached may verification become eligible;
5. training and Champion promotion remain separate later gates.

## AI-21A scope

AI-21A is preparation and read-only inventory only.

It may:

- inspect `storm-track-db` using `SELECT` queries;
- inventory forecast-bearing storms and per-agency coverage;
- build deterministic local forecast-corpus plans from reviewed evidence files;
- run local dry-run previews and regression tests;
- preserve HKO, CMA/NMC, JMA and CWA as independent sources;
- retain explicit `missing` state for an unavailable agency.

It must not:

- write production `storm-track-db`;
- modify or deploy the production Storm Worker;
- write remote `storm-analysis` corpus rows;
- fabricate or infer finalized truth;
- substitute one agency for another;
- infer an RSMC international number from an ambiguous production identity field;
- persist verification results;
- train adaptive weights or signal calibration;
- promote or roll back a Champion.

`.github/ai21-corpus-trigger.txt` remains `PENDING_AI21` during AI-21A.

## Generic corpus builder

`workers/storm-analysis/scripts/ai21-build-forecast-corpus.mjs` generalizes the one-storm AI-19 pilot into a bounded multi-storm builder.

Hard guards include:

- production source database name and UUID pinned to `storm-track-db` / `eb0bf995-3ea7-4bf6-bbca-b425892c4d7e`;
- at most 16 storms in one plan;
- at most 8 historical cutoffs per storm;
- default minimum two independent agencies at every cutoff;
- only HKO, CMA, JMA and CWA agency keys are accepted;
- exactly one selected advisory per agency/cutoff;
- selected advisory issue time must be at or before the historical cutoff;
- every forecast point must be strictly after the cutoff;
- every forecast point must belong to the selected advisory of the same agency/cutoff;
- source URL and SHA-256 provenance are required;
- missing agencies remain explicitly missing and are never substituted.

Every generated storm remains:

- `backfill_mode = forecast-only`;
- `agency_skill_eligible = 0`;
- truth rows = 0;
- signal-outcome rows = 0.

The complete corpus run is hash-bound to stable evidence content for deterministic replay and idempotency.

## Identity contract

Production identity fields are not automatically authoritative for JMA Best Track matching. AI-20 inventory already observed values such as short `15`, `17`, and `18`, which cannot be silently treated as finalized RSMC identifiers such as 2615 or 2617.

AI-21 therefore uses the internal canonical `stormKey` as the forecast-corpus identity. An `internationalNumber` is copied into a snapshot only when the evidence explicitly marks the external identity as `reviewed`.

An unreviewed number may remain in source evidence for investigation, but it must not enter the canonical forecast snapshot.

## Cutoff policy

AI-21A does not automatically create arbitrary historical cutoffs. A later extraction checkpoint must choose cutoffs deterministically from production evidence and then freeze them in the reviewed evidence file.

Recommended policy for prospective corpus candidates:

- choose multiple cutoffs across the storm lifecycle rather than many near-duplicate advisories;
- prefer cutoffs with at least two independent agencies and preferably three or four;
- retain only information known at the cutoff;
- allow future forecast valid times, but never future source availability;
- advisory count and point count must never substitute for distinct storm count in learning gates.

## AI-21B gate

Remote forecast-only import is a separate checkpoint. Before AI-21B is activated, require:

1. AI-21A corpus-builder tests pass;
2. a read-only production inventory identifies the exact storm keys to preserve;
3. each candidate's identity status is explicitly recorded;
4. cutoff selection and source hashes are reviewed;
5. the generated plan is dry-run previewed;
6. `storm-analysis` preflight confirms no unexpected conflicting corpus rows;
7. an explicit activation trigger authorizes the bounded remote import.

Even after AI-21B, all imported storms remain `forecast-only` until finalized truth is separately attached.

## Isolation

AI-21 does not change the production frontend, Pages deployment, service worker, production Storm Worker, production D1 schema, or production source data. The production Worker source remains non-authoritative in the repository and must not be reconstructed from historical Git commits.
