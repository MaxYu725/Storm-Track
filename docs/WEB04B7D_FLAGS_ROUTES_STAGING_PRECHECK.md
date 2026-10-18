# WEB-04B-7D — Version-17 flags, Zone Routes and Staging isolation (review only)

**State: tools written and offline tests required; owner-run scoped Cloudflare
GET evidence pending. Production and Staging deployment BOTH BLOCKED.**

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
