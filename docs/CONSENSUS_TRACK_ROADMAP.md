# Consensus Track roadmap

This document is the versioned development map for Storm Track Consensus Track work. It replaces informal CT-X planning from earlier conversations.

The stages below are **evidence gates, not a mandatory checklist**. A later stage may never be needed if the simpler method already performs well.

## CT-0 — Equal-weight valid-time consensus

**Status: complete / frozen for prospective observation.**

Production Beta currently:

- aligns HKO / CMA / JMA / CWA by valid time;
- samples 0–120h on a 6h grid by default;
- requires at least two agencies for a consensus point;
- uses equal weights;
- records agency count, spread and interpolation provenance;
- uses date-line-safe longitude interpolation and circular longitude mean;
- remains app-computed and separate from official agency tracks;
- is not consumed by frozen HK Signal v1.

Do not tune CT-0 from one live storm.

## CT-1 — Prospective evidence readiness

CT-1 is intentionally split into small correctness / observability tasks.

### CT-1A — Stable case identity and source references

**Status: complete / production active.**

Implemented:

- reuse `storm-case-identity/v1` through a CT adapter instead of creating a second identity engine;
- preserve case continuity through generic-name → named-storm transitions;
- persist non-coordinate agency references needed for archive joins;
- keep individual-agency point coordinates out of the CT prospective dataset;
- store derived case resolution separately in `case-registry.json` and `case-index.ndjson` while historical prospective snapshots remain immutable.

### CT-1B — Verification-readiness audit

**Status: complete as an audit; CT-2 gate is CLOSED by the current evidence.**

The read-only auditor proves that the latest CT v2 source references can identify their D1 storm records, but the existing Archive cannot reconstruct the same as-issued forecast cycles safely enough for skill verification.

Latest production audit on the CT v2 snapshot captured `2026-08-23T07:46:08.509Z`:

- 13 source references audited;
- 13/13 storm identities joined through explicit same-agency `aliases[].agency_storm_id` evidence;
- 0/13 source references had a same-cycle advisory within the fixed 3h tolerance;
- 10/13 had an explicitly stale Archive cycle;
- 3/13 JMA references had an ambiguous advisory stream because one D1 storm record contains multiple JMA EventIDs while advisories store WMO product codes rather than EventID;
- median observed Archive lag among available nearest cycles: 675 minutes;
- 167 valid-time contribution targets were eligible for checking, but 0 were accepted as safely reconstructable from the same as-issued cycle.

The auditor deliberately does **not** widen the time tolerance, score forecasts, rank agencies or treat a stale/ambiguous advisory as the source cycle.

Detailed evidence is recorded in `docs/CONSENSUS_TRACK_VERIFICATION_READINESS.md`.

**Consequence:** do not start CT-2 against the current Archive corpus. First establish a complete prospective as-issued agency-baseline evidence stream or, only after authoritative production Worker source is acquired/reconstructed, correct the Archive ingest path. Do not restore an old Worker implementation from Git history.

### CT-1C — Consensus observation UI

**Status: optional; can proceed independently of the CT-2 data blocker.**

Prefer extending the existing observation surface rather than creating another dashboard.

Read-only fields may include:

- case ID / storm name;
- latest capture / forecast cycle;
- available +24 / +48 / +72 / +96 / +120h consensus points;
- agency count;
- spread;
- interpolation share / provenance;
- supported horizon;
- movement of successive consensus forecasts.

Do not label these as accuracy, probability or calibrated confidence before CT-2 evidence exists.

## CT-2 — Homogeneous forecast-skill verification

**Status: BLOCKED.**

Opening conditions now require both:

1. enough completed independent prospective storm cases; and
2. reliable same-cycle as-issued baseline reconstruction for the compared agencies.

When those conditions are met, evaluate great-circle track error at:

- +24h
- +48h
- +72h
- +96h
- +120h

The core comparison is Consensus Track versus each available official-agency forecast using a **homogeneous paired sample**: same storm case, forecast cycle and valid time, with the same verification truth available.

Never compare averages from different sample populations and call the difference skill.

After the basic evaluator is stable, diagnostics may add:

- along-track error;
- cross-track error;
- agency-count strata;
- spread-versus-error relationship.

CT-2 is verification only. It does not automatically change CT-0 weights.

## CT-3 — Lead-specific agency weighting

**Status: conditional research stage; blocked behind CT-2 evidence.**

Only open CT-3 if multiple independent cases show stable, repeatable lead-specific skill differences.

Any candidate weighting must be lead-specific. A single permanent agency weighting applied to every forecast hour is not the default design.

Example principle:

```text
24h weights != 72h weights != 120h weights
```

A weighted candidate should first run in shadow comparison against frozen equal-weight CT-0. If equal-weight remains competitive, CT-3 may be closed without deployment.

## CT-4 — ECMWF model-family comparison

**Status: deferred research.**

IFS / AIFS should not be inserted as a simple fifth agency vote. Official agencies may already use overlapping NWP guidance, so direct equal voting risks correlated double-counting.

Study them first as a separate family:

```text
Official-agency consensus
        versus
Raw model family
  ├─ IFS
  └─ AIFS
```

Only consider fusion after independent verification.

## CT-X — Advanced / ML methods

**Status: research backlog, not active roadmap.**

Examples include:

- ML weighting;
- calibrated spread-to-probability mapping;
- probability cones;
- self-trained AI track models;
- own NWP / physics models.

These require substantially more independent cases and a demonstrated failure mode that simpler statistical methods cannot solve. Do not build them merely because they were previously mentioned.

## Permanent constraints

1. Official agency tracks remain independent and visible.
2. Missing agency data is not silently substituted.
3. Forecast evidence and verification truth remain separated.
4. No single live storm is used to tune weights or thresholds.
5. CT output does not enter frozen HK Signal v1 during its prospective validation.
6. Correctness, identity, time alignment and evidence-integrity bugs may be fixed immediately.
7. Prefer small reversible PRs.
8. A later CT stage begins only when its evidence gate is actually met.
