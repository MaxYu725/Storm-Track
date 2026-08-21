# AI-22 — Corpus Lifecycle & Identity

Status: **completed — runtime activated, first bounded capture and true incremental append proven remotely; live WP-2026-16 window remains active by design**

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

The generic backfill repository's `INSERT OR IGNORE` behavior is never relied upon to decide AI-22 snapshot conflicts.

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

A real operational window is not forced to `quiescent` or `frozen` simply to close a development phase. Freeze occurs only after the source forecast stream becomes quiescent and the capture boundary is reviewed.

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

Guards reject self-merges, multiple reviewed destinations, reviewed merge cycles, and conflicting reviewed external identity bindings.

## Builder and repository

`workers/storm-analysis/scripts/ai22-build-lifecycle-capture.mjs` reuses AI-21's source-separation and no-future-leakage validation while adding stable incremental lifecycle semantics.

Key rules remain:

- production source D1 is pinned to `storm-track-db` / `eb0bf995-3ea7-4bf6-bbca-b425892c4d7e`;
- HKO, CMA, JMA and CWA remain independent;
- missing sources stay missing;
- advisory issue time must be at/before the cutoff;
- forecast valid time must be after the cutoff;
- an explicit lifecycle `windowId` is required;
- snapshot IDs remain stable across incremental runs;
- external identity is removed from immutable snapshots and emitted separately as unreviewed evidence;
- truth/signal rows remain zero;
- no new storm-count, all-agencies, or sample-count learning gate is introduced.

`workers/storm-analysis/src/corpus-lifecycle-repository.js` provides preview classification, append-only capture after conflict preflight, lifecycle transitions, identity review/merge primitives, and merge-chain resolution.

When a storm already exists in `historical_storms`, AI-22 preserves existing storm metadata during a forecast-only incremental run so a later truth state cannot accidentally be downgraded.

## Operational proof: WP-2026-16

AI-22 used `WP-2026-16` as the first live lifecycle case.

### AI-22D — runtime activation

- migration `0007_corpus_lifecycle.sql` applied to remote `storm-analysis`;
- independent `storm-analysis` Worker deployed and smoke-tested;
- authenticated live lifecycle preview succeeded with zero writes;
- production `storm-track-db` remained read-only;
- production Storm Worker was not modified.

### AI-22E — first bounded capture

- four immutable `WP-2026-16` snapshots appended;
- exact replay classified `4 existing / 0 appended / writesPerformed=false`;
- capture window `wp-2026-16-operational-202608` remained `active`;
- production number `18` was stored only as unreviewed identity evidence;
- truth / verification / training / promotion remained zero.

### AI-22F — true incremental append

A later production archive read selected one genuinely new usable cutoff while preserving the original four:

- new cutoff: `2026-08-21T06:45:00.000Z`;
- usable agencies at that cutoff: `CMA / CWA / JMA`;
- incremental classification: `4 existing / 1 appended`;
- exact replay: `5 existing / 0 appended / writesPerformed=false`;
- original four `snapshot_id`, `fingerprint`, and `payload_hash` values remained unchanged;
- remote forecast snapshots became `13` total / `5` for `WP-2026-16`;
- identity evidence for production number `18`: `2 unreviewed / 0 reviewed`;
- identity merges: `0`;
- truth / verification / training / promotion rows: `0`;
- Signal Champion: none, generation `0`.

The new cutoff did not contain HKO. This is valid: AI-22 preserves the actual usable source state and does not invent a new requirement that every incremental cutoff contain all four agencies.

## Lifecycle transition proof

The D1 integration suite proves:

- incremental append and exact replay;
- `active -> quiescent`;
- automatic `quiescent -> active` when new evidence arrives;
- `active/quiescent -> frozen`;
- frozen-window rejection of new appends;
- snapshot ID/cutoff conflict rejection;
- reviewed identity conflict handling and reviewed merge-cycle rejection.

Because `WP-2026-16` was still producing usable new forecast evidence during AI-22F, the live window remains `active`. Remote transition is therefore an operational event driven by real storm state, not an AI-22 completion blocker.

## Completion

AI-22 is complete. The implementation, runtime activation, first capture, incremental append, immutability, idempotent replay, authorization separation and lifecycle-transition semantics have all been demonstrated.

See `AI22_COMPLETION_RESULT.md` for the closeout decision and final state, plus:

- `AI22_RUNTIME_ACTIVATION_RESULT.md`;
- `AI22_WP16_FIRST_CAPTURE_RESULT.md`;
- `AI22_WP16_INCREMENTAL_CAPTURE_RESULT.md`.

There is currently no AI-23 artifact, trigger, workflow, test or committed phase contract in the repository. The next roadmap step should be selected from current project goals and evidence rather than created only to continue phase numbering.
