# WEB-04B-7D — Version-17 flags, Zone Routes and Staging isolation (review only)

**State: 20/20 mock/offline regression tests PASSED; owner-run scoped Cloudflare GET evidence PENDING. Production and Staging deployment BOTH BLOCKED.**

Scope: Storm Track web Archive historical advisories only. Keep
PR #118 and PR #119 Draft. This task **does not deploy or create** a Worker,
D1 database, R2 bucket, route, secret, Cron Trigger or rollback.

## Confirmed evidence and remaining uncertainty

- Owner-run exact-version module audit proved Cloudflare Worker `storm`
  Version 17's single JavaScript module corresponds to pinned GitHub
  baseline, apart from one trailing LF.
- Version 17 still had 100% traffic at the most recent owner-run audit,
  with D1 `DB` binding matched to previously examined 2,061 completed
  advisories and R2 `RAW_BUCKET` matched to the locally supplied bucket
  name. `ADMIN_TOKEN` and `CWA_AUTHORIZATION` bindings were present.
- Exact Version 17 compatibility date: **2026-08-05**. The isolated
  workerd/D1 test was rerun at 2026-08-05 and replayed 748 synthetic
  records over four pages without duplicates. This does not prove
  Production runtime behavior or full handler/collector coverage.
- Version 17 `compatibility_flags` field was **unknown or malformed**
  in the original 7C report, while *current* Worker Settings reported
  explicit empty flags `[]`. The Script Version API documents that
  `script_runtime.compatibility_flags` is **optional**; absence does
  not prove that Version 17 explicitly configured an empty array.
- One current Cron Trigger, `*/15 * * * *`, was reported, as was
  `workers.dev` enabled / Preview URLs disabled. A current Cron
  expression does not prove healthy collection or immutable-version
  association. Zone Routes and Custom Domains were **not** checked.

## New immutable-version flags and Zone Routes read-only probe

`scripts/audit-web04b7d-flags-routes.mjs` executes
**four GETs plus one per explicitly supplied Zone ID**, capped at
**eight GETs** (four zones maximum). No writes or background checks.

1. List live deployments and require the **previously confirmed**
   exact deployment and Version-17 UUID with 100% traffic.
2. Read `/workers/scripts/storm/versions/{version_id}` runtime metadata.
3. Independently read `/workers/workers/storm/versions/{version_id}`
   from the immutable Beta Worker Versions API (without
   `include=modules`).
4. Optionally, for each owner-supplied Zone ID, GET
   `/zones/{zone_id}/workers/routes` using a **separate Zone Workers
   Routes Read scoped token**. The report contains only route counts,
   exact script matching counts, hashed route patterns and hashed
   Zone IDs; it omits all raw patterns, Zone IDs and route IDs.
5. Repeat the live deployment GET and reject deployment drift.

If one version API explicitly returns `[]` and the other omits the
optional field, report `VERSION_EXPLICIT_FLAGS_REPORTED` with
`effectiveFlags: []` — supported by version-specific evidence.
If both APIs omit the field, report `NOT_VERIFIED`; if they
disagree, report `CONFLICTING_VERSION_FIELDS`, never PASS.
Missing or malformed runtime dates and unexpected version identity
must not be treated as evidence of compatibility.

If no Zone ID is provided, the script **still checks version flags**
but reports `NOT_CHECKED_NO_ZONE_IDS` for routes. Checking
one or more Zones means **only those Zones were checked**, not
the account's entire deployment surface. Custom Domains, DNS,
other Zones and workers.dev routing are not established by Zone
Routes API results. A truncated/paginated response fails closed.

Official Cloudflare references:

- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/
- https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/get/
- https://developers.cloudflare.com/api/resources/workers/subresources/routes/methods/list/

### Owner-run Windows PowerShell (Node.js 22+)

**Workers read-only token** is required for version metadata.
**Zone Workers Routes Read token** is required only if specifying
a Zone ID. Do not replace either with a broad Admin/Editor token
just to complete a read-only review. Do not paste any token or
raw Cloudflare response in GitHub/chat.

```powershell
$folder = Join-Path $HOME 'Desktop\Storm-WEB04B'
New-Item -ItemType Directory -Force -Path $folder | Out-Null
$url = 'https://raw.githubusercontent.com/MaxYu725/Storm-Track/feature/web-04b7-worker-cursor-review/scripts/audit-web04b7d-flags-routes.mjs'
Invoke-WebRequest -Uri $url -OutFile (Join-Path $folder 'audit-web04b7d-flags-routes.mjs')

$account = Read-Host 'Cloudflare account ID'
$zone = Read-Host 'Relevant Production Zone ID (blank to audit flags only)'
$workersSecure = Read-Host 'Workers READ-ONLY API token' -AsSecureString
$argsForAudit = @('--account-id', $account, '--script-name', 'storm')
if ($zone) {
    $argsForAudit += @('--zone-id', $zone)
    $routesSecure = Read-Host 'Workers Routes READ token for this Zone' -AsSecureString
}
try {
    $env:CLOUDFLARE_WORKERS_READ_TOKEN = [System.Net.NetworkCredential]::new('', $workersSecure).Password
    if ($zone) {
        $env:CLOUDFLARE_ROUTES_READ_TOKEN = [System.Net.NetworkCredential]::new('', $routesSecure).Password
    }
    node (Join-Path $folder 'audit-web04b7d-flags-routes.mjs') @argsForAudit
} finally {
    Remove-Item Env:\CLOUDFLARE_WORKERS_READ_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:\CLOUDFLARE_ROUTES_READ_TOKEN -ErrorAction SilentlyContinue
    Remove-Variable workersSecure,routesSecure -ErrorAction SilentlyContinue
}
```

The report `version17-flags-routes.private.json` is saved in a private
OS temp directory, not in the checkout. Inspect it before uploading.
A report with no Zones deliberately cannot prove Zone Routes
or all account routing.

## Offline **declaration-only** Staging planning check

`scripts/audit-web04b7d-staging-plan.mjs` reads a *private local JSON*
with planned Production/Staging resource identifiers and refuses
obvious unsafe plans. It performs **zero** network requests and
writes nothing. **Passing the check does not mean Staging has been
provisioned or isolation is enforced.**

Example *schema* below (replace every identifier in your **private
temporary file only**, NOT in GitHub; placeholder UUIDs are fictitious):

```json
{
  "contract": "storm-web04b7d-offline-staging-plan/v1",
  "production": {
    "worker": "storm",
    "d1Uuid": "11111111-1111-4111-8111-111111111111",
    "r2Bucket": "replace-prod-bucket-name"
  },
  "staging": {
    "worker": "storm-cursor-staging",
    "d1Uuid": "22222222-2222-4222-8222-222222222222",
    "r2Bucket": "replace-disposable-staging-bucket",
    "cronTriggers": [],
    "zoneRoutes": [],
    "customDomains": [],
    "useProductionSecrets": false,
    "scheduledCollectorEnabled": false,
    "adminCollectionEnabled": false,
    "liveAgencyCollectionEnabled": false,
    "syntheticRecordsOnly": true
  }
}
```

The checker rejects reusing Production Worker name, exact D1 UUID,
R2 Bucket, scheduled jobs, Zone Routes, custom domains, live
collection, administrative data repair/collection, Production
secrets or non-synthetic input. It refuses extra JSON keys
(including secret values) and outputs only SHA-256 prefixes and
boolean/zero-count summaries:

```powershell
node (Join-Path $folder 'audit-web04b7d-staging-plan.mjs') --private-plan 'C:\private\staging-plan.private.json'
```

**Important limitation:** The candidate Worker code exports
`scheduled()` and collection/admin routes. Merely declaring
`scheduledCollectorEnabled: false` in a manifest does not disable
a Worker handler or prevent an authorized caller from invoking
collection paths. A separate Staging-specific hardening patch,
route/secret restrictions and an independent, explicitly authorized
deployment review are essential **before** any remote test.
The validator asserts only **planned identifiers/policies**,
never Cloudflare resource existence, runtime enforcement or
rollback readiness.

## Verified isolated CI evidence (2026-10-18)

The final one-shot workflow succeeded:
https://github.com/MaxYu725/Storm-Track/actions/runs/39096553971

- 7/7 synthetic Worker version flags + Zone Routes API tests passed;
  confirms source-specific flags, omitted values, route scoping, masked
  patterns, permission errors and deployment-drift handling.
- 6/6 offline **declaration-only** Staging plan tests passed;
  production/staging Worker/D1/R2 collisions, Cron/DNS/custom routes,
  production secrets and collection modes are rejected.
- 7/7 existing actual Worker `fetch()` route + mocked D1 regressions
  passed. No remote Cloudflare API request, production data, admin
  token or deployment actions were used.
- First two failed one-shot attempts were due to test assumptions
  (missing `Bearer` prefix in a header assertion, and a default
  mock `[]` overriding intended optional-field absence); both
  were corrected. The green run is the accepted CI evidence.
- These results **do not** clear `VERSION_FLAGS`,
  `ROUTE_COVERAGE`, `STAGING_ISOLATION` or `ROLLBACK_REHEARSAL`
  release gates without new owner-provided evidence.

## Additional source-level Staging isolation guard (proposed, un-deployed)

The candidate `backend/worker.js` includes an actual
`scheduled()` collector and write-capable `POST /api/admin/collect`
and `POST /api/admin/repair-identities` routes. A declaration of
zero Cron Triggers does **not** remove these capabilities.

For future review, `backend/web04b7-staging-readonly.js` is a
**separate proposed entrypoint**, not deployed in Production or
Staging. It imports the candidate Worker logic but exports **only
`fetch()`**, never `scheduled()`.

The proposed wrapper:

- Accepts exactly two bindings: `DB` and
  `STAGING_REVIEW_MODE=storm-web04b7d-synthetic-readonly`. Any
  additional bindings, including `RAW_BUCKET`,
  `ADMIN_TOKEN`, `CWA_AUTHORIZATION` or unknown values,
  cause HTTP 503 before a database query.
- Allows only `GET /api/history/storms/{id}/advisories` and a
  minimal `GET /__staging__/health`. Rejects every mutating
  HTTP method and all admin, repair, proxy, collector, diagnostics
  and unrelated routes.
- Delegates allowed history GETs to the reviewed candidate Worker
  handler. This restricts exposed entrypoints but cannot establish
  which physical D1 UUID the `DB` object targets or the Worker
  preview/host name. Those must be confirmed against separately
  created disposable resources.
- Does not include `wrangler deploy`, a `wrangler.toml`
  production binding, Cron, a Zone Route or any secret.
- Requires `tests/web04b7d-staging-readonly.test.cjs` to
  verify the export surface, forbidden paths/bindings and allowed
  SELECT-only synthetic history. Passing mocked tests does not
  prove a remote environment is isolated.
- The underlying candidate `backend/worker.js` remains unchanged;
  no consumer or production route points to this wrapper.

### Staging rollback rehearsal: exact prerequisites

A rollback rehearsal is **not conducted** in this phase. For a
future specifically approved staging-only test, an operator must
first capture the immutable staging version/deployment identifiers,
the staging `DB` UUID, the absence of R2/secret bindings, verified
zero Cron, no Zone Routes or Custom Domains, and the synthetic
first/last-page baseline. Deploy only the separate, gated staging
entrypoint using isolated resources and no production access.
After a future replacement, restore the known-good immutable
staging version, recheck the same isolated D1 UUID and zero
Cron/routes, then retest legacy response shape and keyset
ordering; never roll back by changing Production version or
binding. The rehearsal must be observable and approved before a
Production deployment can be considered.

### Metadata tooling limits and conservative statuses

- Cloudflare's Worker Beta version GET defines
  `compatibility_flags` as **optional**. A reported explicit
  flags array without either version-scoped compatibility date
  proving the pinned date is **not a release PASS**.
- When Zone Routes API output lacks a trustworthy
  `result_info.total_count`, the tool now labels route-list
  completeness **NOT_CONFIRMED**. If a list reaches the
  bounded 500-item threshold, completeness is likewise
  unconfirmed. A returned list must never be silently called a
  complete account-wide inventory.
- Even complete results cover only owner-specified Zone IDs.
  Custom Domains, other Zones and workers.dev configuration
  require separate review.

## No-go gates before any Staging deployment

- Real Zone Routes scope (for relevant Zones) and Custom Domain
  inventory reviewed without exposing other-site details.
- Version-17 optional flags either explicitly verified by a
  version-scoped API or left `NOT_VERIFIED` with a documented
  risk decision. Do not silently use latest Settings as proof.
- Staging D1/R2 bindings must be demonstrably separate from
  Production: compare real Cloudflare resource IDs before any
  Worker with `scheduled()` or admin routes is exposed.
- Staging must have no enabled Cron Trigger, no Production
  admin/collection tokens, no Production Zone routes, no
  unapproved external polling, and only synthetic/approved
  sanitized test data. This must be enforced, not just declared.
- Independent test of original HKO/CMA/JMA/CWA proxy behavior,
  versioned cursor, baseline legacy API, D1 query cost and
  graceful rollback to an immutable old staging Worker version.
- A rollback rehearsal for **Staging only** and explicit owner
  authorization are prerequisites. Never reuse Production
  Worker Versions with their existing Production bindings as
  if Version URLs were an isolated environment.

**End state:** WEB-04B-7D creates *only* read-only audit tools,
an offline planning validator, regression tests and documentation.
Production and Staging are both unchanged; PR #118/#119 remain
Draft; `releaseGate=BLOCKED_PENDING_ISOLATED_STAGING_AND_ROLLBACK_REHEARSAL`.
