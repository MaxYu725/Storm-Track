# WEB-04B-7F — Final static review and free-only Staging go/no-go

**Decision: STATIC REVIEW NEAR COMPLETE.**
**CLOUD STAGING GO = NO (not yet authorized or created).**
**PRODUCTION GO = NO.**

Scope: Storm Track web Archive advisory pagination; PR #118 and
PR #119 are Draft. No Cloudflare change, D1/R2 migration, frontend
deployment, Android change, paid upgrade or new recurring workflow
is authorized by this document.

## Consolidated verified results (2026-10-18)

| Check | State | Evidence and limits |
|---|---|---|
| Production immutable Worker v17 module provenance | PASS | Owner version-scoped Cloudflare `include=modules` audit; single JS module, source differs from pinned GitHub only by final LF |
| Production v17 DB and RAW_BUCKET binding identities | PASS | Owner 4-GET and 7-GET metadata audit; no writes |
| Full D1 audit | PASS WITH LIMITS | 2,061 complete advisories, 159 same-storm/time pairs, original read-only aggregation; not a snapshot during later updates |
| Exact Production compatibility date | PASS | `2026-08-05` independently returned by both version APIs |
| Explicit version compatibility flags | NOT VERIFIED | Both version APIs omitted optional flags field; do **not** infer `[]` |
| Zone Routes / Custom Domains | NOT APPLICABLE BY OWNER ATTESTATION | Owner confirms Production uses workers.dev only. This is not API proof of all possible account routes |
| PR #119 Cursor API unit + synthetic route tests | PASS | Opt-in-only `paging=cursor`, stable issued_at/id, GET-only; malformed D1 gives generic 503 |
| PR #119 isolated Miniflare/workerd + D1 | PASS LOCAL | 748 records/four pages at `2026-08-05`; no Production access |
| PR #119 Staging-only entrypoint | PASS LOCAL | Actual local workerd+disposable D1: 205 synthetic rows/three pages, legacy response unchanged, denied admin/repair/probe/non-GET, no exported scheduled handler |
| PR #118 read-only probe and PR #119 API contract | ALIGNED SOURCE-ONLY | PR #118 now explicitly sends `paging=cursor` on both pages; NOT deployed and not part of Archive UI yet |
| Latest PR #118 and PR #119 CI preceding this report | PASS | PR #118 run 39099155661; PR #119 run 39099423999; later changes require fresh CI |
| Production/staging Cloudflare deployment | NOT PERFORMED | Both remain intentionally blocked |

## Offline SQLite query-plan evaluation — review complete, migration deferred

PR #118 already runs `scripts/web04b5-sqlite-index-fixture.py`
in its standard CI. The fixture uses **748 synthetic complete
advisories for one storm**, thousands of competing/failed records
for another and repeated issuance timestamps.

Official run:
https://github.com/MaxYu725/Storm-Track/actions/runs/39099155661

The observed plans and results in **in-memory SQLite** were:

| Index set | Storm/agency/cursor ORDER BY requires TEMP B-TREE? | 748-row replay |
|---|---|---|
| Existing `idx_advisories_storm_time` and agency/status indexes | YES / YES / YES | PASS, four pages |
| Add `(storm_id,ingest_status,issued_at DESC,id DESC)` candidate | NO / NO / NO | PASS, four pages |
| Also add separate `(storm_id,agency,ingest_status,issued_at DESC,id DESC)` candidate | NO / NO / NO | PASS, four pages |

**Interpretation:** existing indexes are correct but may use
temporary sort, including on the tie-break `id`. A candidate
composite index removes the temporary sort in this **synthetic
SQLite planner**. This is neither a real Cloudflare D1 elapsed-time
benchmark, nor a documented quota/cost win, nor approval to add
an index on Production. There were only 2,061 complete advisories
at the last Production audit. Keep current schema unchanged until
isolated staging D1 explains actual latency, read counts and
write/storage trade-offs; approve any migration separately.

## Static backend and Staging entrypoint review

- Candidate `backend/worker.js` adds the explicit opt-in cursor
  without rewriting legacy `ORDER BY issued_at DESC` requests.
  It does NOT introduce a D1 migration or new R2 write.
- The Cursor SQL binds all user values and applies complete status,
  storm ID, optional known agency, and stable time/id keyset.
  Page-size upper bound is 200; cursor is context-bound, canonical
  and bounded; public unsigned cursor is a *position token*,
  **not authorization**. A SQL/alias D1 exception is generic 503.
- Last static diff review found alias-resolution D1 failure was
  outside the Cursor error handler; PR #119 now returns its normal
  generic 503. Test added; the run
  https://github.com/MaxYu725/Storm-Track/actions/runs/39099423999
  passed after that fix.
- `backend/web04b7-staging-readonly.js` does **not** export
  `scheduled()`. It accepts only GET advisory-history and
  synthetic health; all admin/collector/repair/probes and methods
  other than GET are denied. It rejects any environment bindings
  beyond its locally declared DB and STAGING_REVIEW_MODE.
- This wrapper is **not** a cryptographic or administrative
  guarantee about a D1 binding's *actual Cloudflare UUID*;
  future staging deployment must prove it belongs to a
  disposable DB. Do not bind live Production D1 and assume
  the wrapper makes writes impossible.
- The local workerd smoke uses a disposable in-memory D1 and a
  separate entrypoint, not a deployed Cloudflare Workers Version
  URL. No actual Staging rollback has been rehearsed.
- Full original `scheduled()` collector, four agency proxies and
  legacy non-archive routes still require regression tests as
  part of a separately authorized Production rollout.

## Hard gates remaining

### Code review / integration
- [x] Exact v17 source and binding evidence
- [x] Synthetic Cursor and local workerd/D1 tests
- [x] Source-only PR #118 read-only probe contract correction
- [x] Offline candidate index-plan assessment
- [ ] Final staging manifest and account-free-capacity evidence
- [ ] PR #118 browser Archive UI integration / full-history state handling
- [ ] Cross-PR final independent review after above changes

### Staging deployment: explicit separate authorization required

**Before any create/deploy:**
- Check **actual Cloudflare free-tier capacity** in the account;
  no paid upgrade or charge authorized.
- Confirm an unused Staging Worker name and disposable D1 UUID
  different from Production; no R2 binding, no Production Secrets,
  no Cron, no Zone Routes, no Custom Domain, no upstream collection.
- Produce a private immutable preflight manifest with both
  intended and actual D1 UUID hashes, a no-Cron/no-R2/no-secrets
  binding report and the Staging Worker module hash. The
  existing offline-only plan checker must not be treated as
  actual resource evidence.
- Separately approve creation of test D1 and Worker before
  doing it. Do **not** point Cloudflare Version/Preview URLs
  at the Production version and call that isolation.

**After separately authorized Staging creation:**
- Confirm production bindings/routes unchanged.
- Run no-write Staging health and legacy/cursor API
  (first/middle/last >200 records; same-time ties; four agencies;
  invalid token 400; simulated DB failure 503).
- Measure isolated D1 reads/latency and confirm no
  cloud collectors, secrets or writes are used by Staging.
- Rehearse rollback of **Staging Worker version only**,
  verify the known-good deployment/version ID and intact
  Staging D1/zero Cron, rerun the legacy endpoint checks.
- Keep findings in a reviewed private report, not raw credentials.

### Production remains separately gated

- Finish browser Archive UI full-history replay and opt-in
  fallback to existing legacy response.
- Review which *original* Production Worker routes, secrets,
  R2 and scheduled collection need postdeploy smoke checks.
- Confirm rollback Version ID, traffic plan, operator,
  rollback threshold, observability and final owner sign-off.
- No merge or deploy until owner explicitly approves a
  Production rollout. No Android changes.

## Minimum next approval choice

**Default: remain Draft and finish code/UI review without creating
new resources.** If the owner wants real Cloudflare Staging later,
obtain a clear, separate approval and demonstrate free-capacity and
isolation checks *before* calling any Worker/D1 create/deploy API.

**Status flags**

`STATIC_SOURCE=PASS_WITH_OPEN_UI_WORK`
`INDEX_PLANNER=REVIEWED_SYNTHETIC`
`ACTUAL_STAGING_BINDINGS=NOT_VERIFIED`
`STAGING_DEPLOYMENT=NOT_APPROVED`
`STAGING_ROLLBACK=NOT_PERFORMED`
`ARCHIVE_UI=NOT_IMPLEMENTED`
`PRODUCTION_RELEASE=BLOCKED`.
