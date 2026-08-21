# AI-15 — Manual Signal Calibration Champion Promotion + Rollback

Status: **AI-15 checkpoint implementation**  
Branch: `feature/ai-analysis-engine`  
Parent: AI-14 `68ea08fbff7eab5ef907cb45904a90f26bd00739`

## Purpose

AI-15 adds explicit administrator-controlled promotion and rollback for **HKO signal calibration profiles** only.

Training and promotion remain separate operations:

```text
historical training
      ↓
eligible Challenger
      ↓
manual promotion preview
      ↓
explicit confirmation
      ↓
atomic Champion transition
```

There is no automatic promotion, cron, deployment, production Storm Worker change, or Workers AI change in this checkpoint.

## Admin endpoints

All four endpoints require the existing independent Worker secret:

```text
ANALYSIS_ADMIN_TOKEN
```

Routes:

```text
POST /api/admin/signal-risk/promotion/preview
POST /api/admin/signal-risk/promote
POST /api/admin/signal-risk/rollback/preview
POST /api/admin/signal-risk/rollback
```

The secret remains outside source and Wrangler config.

## Promotion eligibility

Promotion preview requires:

```text
trainingRunId
challengerProfileId
```

The repository verifies that:

- the profile still has `role = challenger`;
- the referenced training run is `completed`;
- `eligible_for_promotion = 1`;
- the training run points to the same Challenger;
- the persisted Champion role agrees with the AI-15 singleton promotion state.

The preview returns:

```text
candidateFingerprint
gateFingerprint
currentChampionProfileId
currentChampionFingerprint
stateGeneration
gate
requiredConfirmation
```

Profile fingerprints cover the immutable calibration content, including profile JSON and metrics JSON, but exclude mutable role/activation timestamps.

## Explicit confirmation and optimistic concurrency

Promotion requires the administrator to copy back all preview guards:

```text
expectedStateGeneration
expectedCandidateFingerprint
expectedChampionFingerprint
expectedGateFingerprint
confirmation
```

The confirmation phrase is deterministic and tied to the reviewed transition:

```text
PROMOTE <challenger> FROM <champion-or-NONE> GENERATION <n>
```

A stale state generation, profile fingerprint, or training-gate fingerprint returns `409 promotion-preview-stale`. The final D1 audit guard also compares the exact Challenger/profile metrics, previous-Champion content, and training `gate_json`, so a change after the HTTP-level recheck aborts the transaction.

The promotion event also requires:

```text
eventId
reason
```

`actorLabel` is optional descriptive audit text; it is not an authenticated identity.

## Atomic D1 transition

Migration:

```text
0006_signal_profile_promotions.sql
```

adds:

```text
signal_calibration_state
signal_profile_promotion_events
```

`signal_calibration_state` contains exactly one logical row:

```text
state_id = 1
champion_profile_id
generation
updated_at
```

The migration bootstraps the state to the sole existing Champion when exactly one exists. If zero or multiple profiles currently have Champion role, the state starts with no Champion; AI-15 refuses a role/state mismatch until it is explicitly resolved.

A promotion D1 batch performs:

1. previous Champion → `retired` when one exists;
2. Challenger → `champion`;
3. compare-and-swap state update using `generation` and expected previous Champion;
4. append immutable promotion audit event.

The audit insert contains NOT NULL / CHECK-backed transition guards. If the state, candidate role/content, eligible training run, or final role transition does not match the reviewed preview, the final audit statement fails and the entire D1 batch rolls back.

Cloudflare D1 documents `batch()` as transactional: statements execute sequentially and a failing statement aborts or rolls back the sequence.

## First Champion

AI-15 supports promotion when no Champion currently exists:

```text
NONE → eligible Challenger
```

The state generation still advances and the event is audited.

A rollback of that first promotion restores the previous state:

```text
Champion → NONE
```

## Rollback

Rollback is deliberately restricted to the promotion event that produced the **current** Champion.

Preview requires:

```text
promotionEventId
```

and returns:

```text
currentChampionFingerprint
restoreChampionProfileId
restoreChampionFingerprint
stateGeneration
requiredConfirmation
```

The confirmation phrase is:

```text
ROLLBACK <promotionEventId> GENERATION <n>
```

Rollback requires a separate `rollbackEventId`, reason, expected generation/fingerprints, and exact confirmation phrase.

The atomic rollback batch:

1. current promoted Champion → `retired`;
2. previous Champion → `champion` when one existed;
3. compare-and-swap singleton Champion state;
4. appends the separate rollback audit event;
5. marks the original promotion event with `rolled_back_by_event_id`.

The rollback audit row is inserted before the original promotion references its `rollbackEventId`, so the self-referencing foreign key always points to an event that already exists within the same transaction.

An old promotion cannot be rolled back after another promotion has replaced its Champion. Rollback is therefore linear and auditable rather than an arbitrary historical role rewrite.

## Idempotence

`eventId` and `rollbackEventId` are idempotency keys.

Retrying the same completed operation returns:

```text
already-promoted
already-rolled-back
writesPerformed = false
```

Reusing an event ID with different content returns `409 promotion-event-id-conflict`.

## Cache semantics

No cache rows are deleted during promotion or rollback.

The existing deterministic analysis cache identity already includes the active signal calibration profile content. Therefore:

```text
Champion changes
→ profile identity changes
→ new analysis cache key
```

Rollback to the exact prior profile may reuse an older cache entry only when all other advisory/model/orchestration fingerprints also match; that result is deterministic for the restored profile.

## Health metadata

After AI-15:

```text
promotionApiEnabled = true
automaticPromotionEnabled = false
signalPromotionVersion = signal-profile-promotion/v1
```

## Validation

Targeted checkpoint validation includes:

```text
node --check signal-promotion-repository.js
node --check index.js
node --check storm-analysis-ai15.test.mjs
node tests/storm-analysis-ai15.test.mjs
```

Migration `0006_signal_profile_promotions.sql` is executed against SQLite with the required profile/training tables.

Tests cover:

- promotion preview and profile fingerprints;
- explicit confirmation phrase;
- eligible training-run gate;
- state/role consistency gate;
- promotion with an existing Champion;
- first-Champion promotion from no Champion;
- idempotent promotion event IDs;
- rollback to a previous Champion;
- rollback of a first Champion back to no Champion;
- stale rollback fingerprints;
- Admin HTTP authentication/routes;
- health metadata;
- automatic promotion remains disabled.

## Not done in AI-15

- no real `ANALYSIS_ADMIN_TOKEN` is configured;
- no remote D1 migration;
- no real promotion or rollback is executed;
- no automatic promotion;
- no scheduled promotion;
- no deployment;
- no production Storm Worker or PWA change;
- no Workers AI narrative.

## Next checkpoint

AI-16 should focus on **deployment readiness for the independent storm-analysis Worker**: full migration ordering/validation, Wrangler configuration review, local/miniflare-style integration where available, admin-secret setup checklist, and a deployment runbook. It should still stop before a real Cloudflare resource creation or deployment unless explicitly authorized.
