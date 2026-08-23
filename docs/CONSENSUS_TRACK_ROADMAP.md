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

**Status: current implementation work.**

Goals:

- reuse `storm-case-identity/v1` instead of creating a second identity engine;
- keep the same case through generic-name → named-storm transitions;
- persist non-coordinate agency references needed to join back to as-issued guidance;
- preserve the rule that individual-agency point coordinates are not duplicated into the CT prospective dataset.

Persistent source references may include:

- agency;
- source ID;
- bulletin time;
- current analysis time;
- forecast base time;
- first / last forecast valid time;
- analysis / forecast point counts.

Case resolution is stored separately in `case-registry.json` and `case-index.ndjson`. Historical prospective snapshot files remain immutable.

### CT-1B — Verification-readiness audit

**Status: pending CT-1A.**

Before building a skill evaluator, prove that a CT prospective record can reliably join to each agency's **as-issued** forecast in the existing archive / D1 data.

For representative samples, verify:

```text
CT case + source reference
  → agency advisory / forecast cycle
  → same valid time
  → as-issued agency forecast point
```

Measure join coverage separately for HKO, CMA, JMA and CWA. Missing guidance remains missing; no silent substitution.

If archive reconstruction is insufficient, fix the evidence contract before CT-2. Do not fabricate historical agency points from later data.

### CT-1C — Consensus observation UI

**Status: optional after CT-1A / CT-1B.**

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

**Status: blocked until enough completed prospective cases and CT-1B join coverage.**

Evaluate great-circle track error at:

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

**Status: conditional research stage.**

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
