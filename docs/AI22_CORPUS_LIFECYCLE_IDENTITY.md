# AI-22 — Corpus Lifecycle & Identity

Status: **implementation started; schema/repository/builder complete for local and CI validation; remote migration/capture not yet activated**

AI-22 changes forecast-corpus preservation from a one-shot frozen import into an incremental, auditable lifecycle. It does not import truth, persist verification, redesign training thresholds, promote a Champion, or change production weights.

## Why AI-22 exists

AI-19 and AI-21 proved that trusted historical forecast snapshots can be preserved safely, but their canonical builders were designed around a bounded set of preselected cutoffs. That is not enough for an active storm such as `WP-2026-16`, whose archive can continue growing while the storm is still operational.

AI-22 therefore makes the capture window, snapshot identity, duplicate/conflict handling, and external identity review explicit.

## Core rules

### 1. Active storms may append

A storm does not need to be closed before forecast evidence is stored.

Each storm uses an explicit `windowId`. Multiple capture runs may refer to the same window. A later run may contain earlier exact snapshots plus newly available cutoffs.

### 2. Saved snapshots are immutable

AI-22 snapshot IDs are derived from:

- internal `stormKey`; and
- historical cutoff (`as_of`).

They do not depend on capture-run order or positional index.

Before any import, the lifecycle repository checks the independent analysis D1:

- same snapshot ID + same immutable content -> existing exact snapshot;
- different snapshot ID at the same storm/cutoff + same immutable content -> existing legacy/canonical snapshot may be reused;
- same snapshot ID + changed immutable content -> fatal conflict;
- same storm/cutoff + changed immutable content -> fatal conflict;
- no prior snapshot -> append.

The legacy `INSERT OR IGNORE` behavior in the generic backfill repository is therefore never relied upon to decide AI-22 snapshot conflicts.

### 3. Capture lifecycle

Capture windows have three stored states:

- `active` — new snapshots may append;
- `quiescent` — no new evidence is currently arriving, but capture may resume;
- `frozen` — terminal capture state; no new snapshot may append.

`closed` is accepted as an input alias for `frozen` but is stored as `frozen`.

Allowed transitions:

- active -> quiescent;
- active -> frozen;
- quiescent -> active;
- quiescent -> frozen.

A frozen window cannot be reopened. Exact already-saved snapshots may still be recognized without rewriting them.

If a new snapshot arrives for a quiescent window, a successful capture automatically returns that window to `active` and records a lifecycle event.

### 4. Multiple runs for one storm

Migration `0007_corpus_lifecycle.sql` adds:

- `corpus_capture_windows`;
- `corpus_capture_runs`;
- `corpus_capture_run_storms`;
- `corpus_snapshot_memberships`;
- `corpus_lifecycle_events`.

This records which run observed each snapshot without duplicating the immutable snapshot itself.

Exact replay of the same capture run remains idempotent. A retry can also repair lifecycle metadata after a partially completed post-import bookkeeping step.

### 5. Internal key and external identity are separate

Forecast snapshots continue to use the internal `stormKey` as their immutable identity.

AI-22 deliberately keeps external numbers outside forecast snapshot JSON, even when an external number is present in production source metadata. The capture builder emits such values only as **unreviewed identity proposals**.

Migration `0007` adds `storm_identity_bindings` with review states:

- `unreviewed`;
- `reviewed`;
- `rejected`.

Only a `reviewed` binding may be treated as canonical. A reviewed external identity may map to only one storm key.

For the production `storms.international_number` field, AI-22 uses the identity type `production-international-number` by default. This is intentionally distinct from a reviewed finalized identifier such as `jma-rsmc-number`.

### 6. Temporary or ambiguous internal keys

`storm_identity_merges` records reviewed internal key resolution without physically rewriting old snapshots.

A reviewed merge means downstream readers may resolve `from_storm_key` to `to_storm_key`. The original forecast rows remain unchanged for audit/replay.

Guards reject:

- self-merges;
- more than one reviewed destination for the same source key;
- reviewed merge cycles;
- conflicting reviewed external identity bindings.

## Builder

`workers/storm-analysis/scripts/ai22-build-lifecycle-capture.mjs` reuses AI-21's established source-separation and no-future-leakage validation, while changing the lifecycle semantics:

- production source D1 remains pinned to `storm-track-db` / `eb0bf995-3ea7-4bf6-bbca-b425892c4d7e`;
- HKO, CMA, JMA and CWA remain independent;
- missing sources stay missing;
- advisory issue time must be at/before the cutoff;
- forecast valid time must be after the cutoff;
- an explicit lifecycle `windowId` is required;
- snapshot IDs remain stable across incremental runs;
- external identity is removed from immutable snapshots and emitted separately as unreviewed evidence;
- truth/signal rows remain zero;
- no new storm-count learning gate is introduced.

## Repository

`workers/storm-analysis/src/corpus-lifecycle-repository.js` provides:

- capture preview with existing/appended classification;
- append-only capture execution through the existing generic backfill repository only after conflict preflight;
- lifecycle state transitions;
- reviewed/unreviewed external identity decisions;
- reviewed storm-key merge decisions;
- reviewed merge-chain resolution.

When a storm already exists in `historical_storms`, AI-22 preserves the existing storm metadata during a forecast-only incremental run so that a later truth state cannot accidentally be downgraded back to `forecast-only`.

## First operational case

`WP-2026-16` remains the preferred first lifecycle case because the latest read-only candidate inventory found:

- all four independent agencies;
- 252 forecast advisories;
- 1,334 forecast points;
- active updates at the time of inventory.

The correct AI-22 behavior is therefore to open an active capture window, preserve a bounded deterministic set of currently available historical cutoffs, and append later cutoffs to the same window while they appear. It should be frozen only after the forecast stream becomes quiescent and the capture boundary is reviewed.

## Current checkpoint and next step

This checkpoint is code/schema/test preparation only. It does **not** migrate the remote `storm-analysis` D1 or import `WP-2026-16` yet.

Next AI-22 step:

1. run the complete regression + D1 integration suite;
2. run a read-only fresh inventory/extraction for `WP-2026-16`;
3. generate the first AI-22 lifecycle capture request using a stable window ID;
4. inspect append/existing/conflict preview against remote `storm-analysis`;
5. apply migration `0007` and deploy the independent analysis Worker only after the route wiring and deployment diff are reviewed;
6. perform the first bounded WP-2026-16 capture;
7. repeat with a later cutoff to prove true incremental append before freezing the window.

Production `storm-track-db` remains read-only throughout AI-22, and the production Storm Worker is not modified.
