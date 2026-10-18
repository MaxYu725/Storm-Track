# WEB-04B-7E — Free-tier Staging review completion matrix

**State:** Source/version identity PASS; Worker Cursor API local unit and
workerd+D1 integration PASS; local Staging restricted-entry smoke PASS.
**Staging and Production deployment NOT PERFORMED and NOT APPROVED.**

**Scope:** Storm Track web Archive only. No Android, R2 upgrade,
billable external services, additional scheduled Workflows, Production
Worker/DB/route changes, branch merges or Cloudflare deployment.

## Recorded free-tier and routing assumptions

Owner confirmed on 2026-10-18 that the Production `storm` Worker uses
**only workers.dev**, with **no Zone Routes or Custom Domains**, and
the project is intended to stay **entirely on free features**.

- `Zone Routes: NOT_APPLICABLE_BY_OWNER_ATTESTATION`
- `Custom Domains: NOT_APPLICABLE_BY_OWNER_ATTESTATION`
- Do not require a Zone ID or a Workers Routes Read token for
  WEB-04B-7E on the present plan.
- This is **owner-attested**, not a new API-verified account-wide
  route inventory. If the hosting strategy changes, review the
  new routing setup before deployment.
- Any Staging account-level capacity check must be verified **before
  provisioning** because free-tier quota availability depends on
  existing resource usage. Do not assume spare D1 databases,
  Worker allowance or extra paid capacity.

## What has already passed

| Gate | Outcome | Evidence |
|---|---|---|
| Version 17 immutable source | PASS | Owner-run single immutable-version module hash, one trailing LF |
| Production D1 and R2 binding identity | PASS | Owner GET-only version binding audit |
| Owner D1 data aggregate and ordering | PASS WITH LIMITS | 2,061 complete advisories, 159 tie groups; not a snapshot replay |
| Original API backward compatibility | PASS LOCAL | PR #119 Worker `fetch()` route tests |
| Cursor 748-row replay at exact 2026-08-05 | PASS LOCAL | workerd+disposable D1; 4 pages |
| Production live compatibility date | PASS | 2026-08-05 from both version-specific APIs |
| Production explicit compatibility flags | UNVERIFIED OPTIONAL | Two version-specific API endpoints did not return the optional field, current settings indicated `[]` |
| Only workers.dev / no zone or custom routes | OWNER-ATTESTED | No zone/API route review necessary under current owner's intended configuration |
| Stage read-only wrapper unit guards | PASS LOCAL | `tests/web04b7d-staging-readonly.test.cjs` |
| Stage workerd and disposable D1 | PASS LOCAL | Run [#39098917521](https://github.com/MaxYu725/Storm-Track/actions/runs/39098917521) |

### WEB-04B-7E local Staging smoke — 2026-10-18

Using `backend/web04b7-staging-readonly.js` as the **actual**
Miniflare/workerd entrypoint, a separate synthetic SQLite/D1 binding
and compatibility date `2026-08-05`:

- 205 synthetic advisories replayed across 3 cursor pages, no
  duplicated IDs; legacy first-page output unchanged.
- GET admin/collect/repair/proxy/diagnostics denied (404); POST,
  PUT, PATCH and DELETE denied (405).
- Staging health succeeds, invalid cursor 400; no change in D1
  advisory row count observed after requests.
- No R2, CWA credentials, administrator secret, Cron or Production
  Cloudflare resource was bound, and no external API credential was
  used. The entrypoint does **not export** a scheduled handler.
- 4/4 wrapper mock tests passed.
- First attempt failed locally due to Miniflare module-loader
  configuration; fixed by treating the imported
  `backend/worker.js` as ESM. Final one-shot run passed:
  https://github.com/MaxYu725/Storm-Track/actions/runs/39098917521

**Important:** This confirms local runtime isolation restrictions,
not actual Cloudflare account resource isolation or staging rollback.
The wrapper uses a mode binding plus a DB handle; it cannot prove
the latter's real D1 UUID. Declared `NO` permissions are not a
substitute for Cloudflare binding inspection.

## Final backend review finding (2026-10-18)

The PR #119 backend diff review identified a specific error-path
risk: a D1 failure while resolving merged storm IDs occurred
before the Cursor API's main query error handler, potentially
falling through to the Worker's generic HTTP 500 handler. The
candidate `historyAdvisoriesCursor` now catches that alias
lookup failure and returns the same generic 503 contract used
for other D1 paging failures. A targeted regression test
`D1 alias-resolution failure is a generic 503` was added
without exposing raw SQL/driver errors. **Latest CI pending
at the time of this document amendment.**

## Remaining to COMPLETE CODE REVIEW (no production deployment)

1. Complete review of PR #119's candidate `backend/worker.js`
   diff and its Staging wrapper; confirm strict advisory-only GET,
   stable ordering, invalid input and no accidental fallback to
   collector/admin code. Document any unresolved security or
   backwards compatibility regression.
2. **Updated in separate Draft PR #118:** the read-only production
   audit probe now explicitly requests `?paging=cursor` on the first
   and second advisory pages; synthetic tests assert the mode, limit
   and safe legacy fallback. PR #118 is still
   **analysis/scripts/tests/readiness only**, not a deployed web
   Archive UI change. Do not report full Archive UI integration as done.
   Full CI for the new PR #118 head is still pending until verified.
3. Document the optional missing `compatibility_flags` field as a
   **known metadata uncertainty**, not a malformed deployment.
   At matching live compatibility date, local workerd simulations
   have passed; further repeat calls to the same endpoint are
   unlikely to provide stronger evidence.
4. Review D1 keyset plan/latency in **local or disposable Staging D1**
   with a realistic synthetic count. Existing observed D1 query
   plans may use temporary sorting; an index migration is NOT
   automatically necessary and is out of this PR.

## Remaining to AUTHORIZE A STAGING DEPLOYMENT

1. **Separate owner approval** for new disposable free-tier
   Staging Worker + D1. No deployment is authorized by this
   document.
2. Pre-check Cloudflare account's free-tier resource capacity
   without elevating to paid services. Confirm ability to create
   a separate D1 database; otherwise STOP and use local smoke
   tests until capacity is available.
3. Verify actual intended Worker name, exact D1 UUID (must not
   equal audited Production DB), zero R2 binding, zero secrets,
   no Cron, no Zone Routes/Custom Domains; only synthetic data.
4. Stage the read-only entrypoint, not the full collector, and
   verify the published staging `workers.dev` URL has no
   unexpected route. Recheck bindings **before exposing** the
   endpoint. Do not use Cloudflare Version Preview URLs as
   a substitute for an isolated binding set.

## Remaining to AUTHORIZE PRODUCTION (after approved Staging)

1. Cloudflare actual Staging GET-only legacy/keyset first-middle-
   last frame verification with >200 synthetic advisories, agency
   filtering and bad-cursor handling; measure D1 latency and
   query plans, including same-time tie cases.
2. Successful **staging-only rollback rehearsal** to a known-good
   immutable staging Worker version with verified bindings and no
   production resource access.
3. PR #118 frontend cursor opt-in and Archive UI verified against
   the approved backend contract, with feature fallback until
   release and no Android change.
4. Final peer/owner release review of Production Worker legacy
   handlers, `scheduled()`, HKO/CMA/JMA/CWA proxies, Cron, D1/R2,
   source/provenance, rollback checkpoint and observability.
5. Obtain a distinct explicit Production deployment authorization,
   then perform an approved staged release and observe legacy
   health/collector/API behavior. No merge/deploy in WEB-04B-7E.

## Summary: which barriers are fundamental?

**Code review is near the finish line.** The strongest remaining
delivery barriers are not source identity or local Cursor logic:
they are (a) actual Cloudflare isolated staging binding proof,
(b) staging remote API and rollback proof, (c) PR #118 browser
Archive integration, and (d) separate Production go/no-go review.

`CODE_REVIEW=NEAR_COMPLETE`
`STAGING_DEPLOYMENT=NOT_AUTHORIZED`
`STAGING_RUNTIME=LOCAL_ONLY_PASS`
`STAGING_ROLLBACK=NOT_PERFORMED`
`ARCHIVE_UI_INTEGRATION=NOT_IMPLEMENTED`
`PRODUCTION_RELEASE=BLOCKED`

No Production or Staging changes occur in this phase.
