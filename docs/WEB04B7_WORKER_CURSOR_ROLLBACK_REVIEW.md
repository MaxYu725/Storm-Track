# WEB-04B-7 — Draft Worker advisory keyset patch and rollback gate

**Status: REVIEW ONLY. NOT DEPLOYED. NOT MERGE APPROVED.**

This is an independent backend review proposal based on `main:backend/worker.js`
(version constant `3.3.0-alpha.4`). Previous owner-exported
`/content/v2` source matched that repository file except its final LF,
and the owner's version-specific immutable module audit has now verified
that the exact 100%-traffic Cloudflare Version 17 contains the same single
JavaScript module, differing only by a terminal LF. **SOURCE GATE: PASS**.
Deployment remains **BLOCKED** pending runtime settings, routing, staging
and rollback readiness review, and separate owner authorization.

## Version-17 source gate resolved — 2026-10-18

The owner independently ran the immutable `include=modules` Worker
version API audit against version 17. The one-module result matches the
pinned GitHub Worker source apart from exactly one terminal line-feed.
The module SHA256 exactly matches the prior unversioned Worker export.
The 100%-traffic deployment ID and version ID are unchanged; 3
GET-only Cloudflare requests and zero writes were reported.

`SOURCE_VERSION_MATCH=PASS`, `BACKEND_PATCH=REVIEW_ONLY`,
`RUNTIME_CONFIG_PARITY=PENDING`, `STAGING_DEPLOYMENT=PENDING`,
`PRODUCTION_DEPLOYMENT=BLOCKED`.

This finding updates source provenance only; no changes are made to
the original immutable deployed version, bindings or Worker runtime.

## Scope and explicit non-goals

- Touch only `backend/worker.js`, integration tests, an existing PR CI
  workflow and this review document.
- Do **not** change the `scheduled()` collector, HKO/CMA/JMA/CWA live
  proxies, analysis engines, D1/R2 bindings, D1 rows/indexes/migrations,
  service worker, web Archive HTML, Android, Cloudflare Secrets or `main`.
- This patch is reviewable source code only; no Worker CI deployment
  action is introduced. A GitHub green test is **not** production approval.
- PR #118 remains a separate Draft with client-side readiness tooling;
  it is not merged/wired by this backend proposal.

## Existing legacy behavior

Unchanged requests such as

    GET /api/history/storms/STC-2026/advisories?limit=200
    GET /api/history/storms/STC-2026/advisories?agency=HKO&limit=50

still execute the original `ORDER BY issued_at DESC LIMIT ?`, still
clamp `limit` to 1..200 with fallback 50, ignore unknown agencies as
before, and return **exactly**

    { "version": "...", "stormId": "...", "advisories": [...] }

No `pagination` property is added to the legacy route and no old
caller is silently upgraded to cursors.

## Explicit opt-in paging contract (candidate)

First page:

    GET /api/history/storms/STC-2026/advisories?paging=cursor&limit=200

Subsequent page:

    GET /api/history/storms/STC-2026/advisories?paging=cursor&limit=200&cursor=v1.OPAQUE

Optional `agency=HKO` (or CMA/JMA/CWA) is supported and must be
repeated unchanged for every cursor request. Case-insensitive agency
input is normalized to uppercase. Canonical storm identity is resolved
before scoping the cursor, so a known merged alias can be used safely.

Additive paginated response:

```json
{
  "version": "3.3.0-alpha.4",
  "stormId": "CANONICAL-STORM-ID",
  "advisories": [],
  "pagination": {
    "contract": "storm-history-advisory-cursor/v1",
    "order": "issued_at_desc,id_desc",
    "limit": 200,
    "count": 0,
    "hasMore": false,
    "nextCursor": null
  }
}
```

- First page with no `cursor` is recognized only when
  `paging=cursor` is present. A bare `?cursor=` is rejected with 400.
- A bounded canonical Base64URL token carries the 1-based version,
  canonical storm ID, normalized agency or null, requested page limit,
  last returned canonical `issued_at` and advisory `id`.
- Server validates token encoding, exact shape, keyset coordinates,
  request context and page size. Malformed, repeated, mismatched or
  cross-storm/cross-agency tokens fail closed with HTTP 400.
- The cursor is **NOT signed**: the public historical API permits
  arbitrary read-only positioning, not secret access. If access control
  is added later, a different authenticated contract is required.
- `issued_at` must have the canonical UTC millisecond representation
  `YYYY-MM-DDTHH:mm:ss.SSSZ`. Advisory IDs are printable ASCII, which
  ensures JS's lexical tie comparison agrees with SQLite BINARY order.
  If the DB violates these source constraints, the opt-in paging
  request fails closed with a generic HTTP 503; legacy requests are
  unaffected.
- D1 SQL stays parameterized, filters `ingest_status='complete'`,
  orders `issued_at DESC, id DESC`, uses a strict keyset predicate
  `issued_at < ? OR (issued_at = ? AND id < ?)` and `LIMIT limit+1`.
  Only `limit` rows are emitted; the extra row signals `hasMore`.
- All SQL and returned fields are existing schema columns.
  **No D1 index or migration is included.**
- Concurrent writes and historical backfills are not a transactional
  snapshot. Late newer advisories before the anchor do not reappear in
  later pages, while earlier inserted/backfilled items can appear
  later. Users should refresh to obtain a new archive view.

## Proof inputs and guardrails

- Real D1 read-only aggregate: 2,061 complete advisories,
  invalid timestamp shape=0, noncanonical shape=0, 159
  same-storm/same-timestamp groups, all containing two distinct
  agencies; time tie-break is operationally necessary.
- Worker Version 17's `DB` Binding was confirmed against the exact
  D1 UUID previously audited, using four GET-only Cloudflare requests.
- **Subsequently confirmed:** The owner used Cloudflare's immutable
  version-scoped `include=modules` GET and matched the sole Version-17
  module to the pinned repository source except one trailing LF.
  The module SHA256 also matched the previous `/content/v2` extraction.
  This proves source lineage without assuming script ETag hash semantics.
  Runtime parity, binding/cron/route inventory and Staging rollback
  readiness remain separate release gates.

## Isolated test evidence — 2026-10-18

- GitHub Actions one-shot synthetic route verification:
  https://github.com/MaxYu725/Storm-Track/actions/runs/39092493836
  **Success: all 7 of 7 Worker route tests passed** after the final
  cursor prefix-validation refactor. Node syntax check also passed.
- Covers direct invocation of the actual `backend/worker.js` exported
  `fetch()` with a **mock D1 read-only executor**. Confirms no SQL
  writes, stable 0/1/199/200/201/748-record pagination, same-time
  ordering, canonical storm aliases, scoped agency filters, invalid
  cursors, strict opt-in-only handling, safe generic 503 errors and
  legacy reply shape.
- The synthetic runner is not a real Cloudflare Worker deployment,
  D1 compatibility benchmark, complete collector test or Production
  source proof. Main branch does not include this candidate.
- Reserved `paging` or `cursor` query parameters now activate
  strict opt-in validation; otherwise the legacy response shape and
  SQL query remain unchanged.

## Validation and release preparation

Run in CI with no Cloudflare secrets:

    node --check backend/worker.js
    node tests/web04b7-worker-cursor.test.cjs

Tests import the **actual Worker source**, invoke `fetch()`, and
use an in-memory mock D1 supporting only `SELECT`. Boundary counts
0,1,199,200,201,748, duplicate times, agency, aliases, invalid limits,
cursor mismatches, malformed DB rows, backfill/new items, legacy
responses and zero write methods must all pass.

Before a future production rollout, independent reviewer must also
check:
1. Exact active Worker deployment+version content reference: source
   matching must be verified against immutable/version-specific
   evidence. If unknown, **STOP**.
2. Cloudflare `storm` Worker `DB` Binding and secrets continuity,
   cron schedule, environment variables, routes and R2 bindings.
3. Stage an isolated Worker with a **copy** of the audited D1 data
   or a disposable fixture. Do not point testing at Production DB
   with write privileges. Validate the full original Worker,
   scheduled handler and proxy routes, not just cursors.
4. Staging D1 query plan and relevant latency/cost data for the
   current index. Add an index only if an independent migration
   review establishes a real need.
5. Make an API-read-only compatibility probe that checks
   `paging=cursor` contract on the staging/production endpoint.
   Update PR #118's public probe to send explicit opt-in, only
   **after** the backend is ready. Until then, a legacy response
   correctly reports no cursor support.
6. Validate one **real** storm with >200 completed advisories:
   first, middle, last frame; no duplicate IDs; stable issuance
   order; repeat agency-filtered checks; stale request guards.
7. Document deployment authorization, traffic splitting strategy
   (if supported), monitoring, max rollback decision time and
   operator approval. Do not deploy merely because Draft PR CI
   passed.

## Rollback (plan only — never executed here)

- Capture active deployment ID, immutable Worker Version ID, bindings,
  routes, cron schedule, current source/provenance and observed
  health/legacy baseline immediately before any approved release.
- Confirm that the previous **known-good version** can be
  redeployed under Cloudflare's supported deployment/version APIs
  without deleting D1 or R2 data. Do not roll back by uploading
  `backend/worker.js` blindly when the live version's provenance
  is unresolved.
- Trigger rollback if legacy response changes unexpectedly, the
  collector/proxies degrade, cursor pages overlap/miss records,
  error rate rises or D1 read cost becomes unacceptable.
- Redeploy previous **verified** Worker Version using approved
  Cloudflare controls, keeping D1/R2 unchanged. Recheck existing
  legacy endpoint, health, scheduled collection and agency proxies.
- Since this candidate contains **no schema migration**, there is no
  index or data rollback in this PR. If a separate migration is
  ever approved, it needs its own migration and rollback plan.
- Keep the web frontend on legacy mode until the confirmed live
  backend contract is probed and approved.

**Release status:** SOURCE_VERSION_MATCH=PASS; RUNTIME_PARITY=PENDING; STAGING_RELEASE=BLOCKED;
LEGACY_COMPATIBILITY_TEST=PASS_SYNTHETIC;
BACKEND_DRAFT_ONLY=true; PRODUCTION_DEPLOYMENT=false.
