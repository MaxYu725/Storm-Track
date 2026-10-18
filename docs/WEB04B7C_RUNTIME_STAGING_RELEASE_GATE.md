# WEB-04B-7C — Production runtime parity and staging/rollback release gate

**State: immutable Version-17 source gate PASS; actual runtime metadata
read-only audit PENDING; isolated Staging deployment NOT APPROVED or executed.**

Scope: Storm-Track **web Archive historical advisory cursor only**.
No Production Worker, D1, R2, routes, scheduled jobs, PWA, Android or
`main` mutations. Draft PR #119 is a backend *candidate*, not deployed.
Draft PR #118's frontend cursor feature remains disabled.

## Verified foundation

On 2026-10-18 the owner's Version-17-specific Cloudflare API report
confirmed the active 100%-traffic `storm` Version 17 had one
JavaScript module (zero extra modules). The immutable module SHA256
matched the owner's older `/content/v2` extraction,
`333d9405b1c4322ec09815f1d1bb19c8746933dcc18557904dc8f8c913255c80`.
GitHub's pinned source differed by **one terminal LF only**, not
byte-identical. The report states `versionSourceStatus=MATCHED`,
`fullWorkerArtifactStatus=SINGLE_MODULE_SOURCE_MATCHED`,
3 GET requests and zero writes.

Earlier Owner D1/Binding audit established Version 17's `DB`
binding matched the audited `storm-track-db`, which contained
2,061 completed advisories (0 malformed timestamp shapes,
159 same-storm/same-time cross-agency pairs at audit time).
Local Miniflare + ephemeral D1 replay of **748 synthetic**
advisories in 4 pages, with no duplicated IDs, passed. This
is NOT production latency, not a full Worker collector/cron test,
and not a real historical D1 replay.

## Separate Worker runtime metadata preflight (read-only)

`scripts/audit-web04b7c-runtime-metadata.mjs` uses exactly **seven
HTTPS GET** calls with timeouts, size limits and no credentials in output:

1. `/workers/scripts/storm/deployments?per_page=1` — pin exact
   existing 100%-traffic deployment + Version 17.
2. `/workers/scripts/storm/versions/{versionId}` — retrieve
   immutable version `resources.script_runtime.compatibility_date`,
   `compatibility_flags`, handlers, and safe summaries of `DB`,
   `RAW_BUCKET`, `ADMIN_TOKEN`, `CWA_AUTHORIZATION` bindings.
3. `/workers/scripts/storm/settings` — **latest settings only**;
   never substitute these for the active version's bindings.
4. `/workers/scripts/storm/script-settings` — read logpush and
   observability metadata only (not secret payloads).
5. `/workers/scripts/storm/schedules` — read current Cron Triggers.
6. `/workers/scripts/storm/subdomain` — read whether workers.dev
   and Preview URLs are enabled.
7. Repeat deployment GET and reject any Version 17/deployment drift.

**Independent proof limits:**
- Script runtime compatibility date and flags are taken from the
  **active Version-17 resource**, not assumed from your local
  Miniflare smoke test's 2026-08-01 compatibility date.
- Version-bound D1 ID is compared to the exact previously audited
  database UUID. R2 bucket name is compared only if the owner supplies
  its **exact expected name** locally; otherwise R2 identity remains
  `MANUAL_REVIEW_REQUIRED`. The report stores only a 16-character
  SHA-256 prefix of the R2 name, never the bucket name.
- Secret values are NEVER printed or saved. Only boolean presence/type
  summaries for two named secret bindings are preserved. No value
  comparison or secret operability is implied.
- Cron expression list is reported for human review.
  `*/15 * * * *` presence is a convenience field, **not proof
  that all scheduled collection is working**.
- `workers.dev` availability and preview capability are not proof
  of Zone Routes, Custom Domains or Staging isolation.
- Zone Routes require an **independent read-only** zone-specific
  `GET /zones/{zone_id}/workers/routes`, its Zone ID and a
  `Workers Routes Read` scoped token. This script does not guess
  Zone ID, request extra scopes or claim routes are verified.
- Any metadata mismatch, missing version runtime or changed deployment
  blocks release. Even a fully passing metadata report retains
  `BLOCKED_PENDING_STAGING_ISOLATION_AND_ROLLBACK_APPROVAL`.

Authoritative endpoint references:

- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/get/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/methods/get/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/schedules/methods/get/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/methods/get/
- https://developers.cloudflare.com/api/resources/workers/subresources/routes/methods/list/

### Owner's Windows PowerShell (Node.js 22+)

Use a token with **Workers read-only / metadata-read** permission,
the same exact D1 UUID as your previous report, and a separately
confirmed R2 bucket name from Cloudflare dashboard. Do not paste
any token, environment variable, private API response, account ID
or raw binding values into GitHub, chat or screenshots.

```powershell
$folder = Join-Path $HOME 'Desktop\Storm-WEB04B'
New-Item -ItemType Directory -Force -Path $folder | Out-Null
$url = 'https://raw.githubusercontent.com/MaxYu725/Storm-Track/feature/web-04b7-worker-cursor-review/scripts/audit-web04b7c-runtime-metadata.mjs'
Invoke-WebRequest -Uri $url -OutFile (Join-Path $folder 'audit-web04b7c-runtime-metadata.mjs')

$account = Read-Host 'Cloudflare account ID'
$db = Read-Host 'Previously audited production DB binding D1 UUID'
$r2 = Read-Host 'Exact RAW_BUCKET bucket name from Cloudflare (blank = unverified)'
$secure = Read-Host 'Workers READ-ONLY API token' -AsSecureString
$arguments = @('--account-id', $account, '--script-name', 'storm',
               '--database-id', $db)
if ($r2) { $arguments += @('--expected-r2-bucket', $r2) }
try {
    $env:CLOUDFLARE_API_TOKEN = [System.Net.NetworkCredential]::new('', $secure).Password
    node (Join-Path $folder 'audit-web04b7c-runtime-metadata.mjs') @arguments
} finally {
    Remove-Item Env:\CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
    Remove-Variable secure -ErrorAction SilentlyContinue
}
```

The metadata-only report `version17-runtime-metadata.private.json`
is saved to a separate private OS temporary folder. **Review before
sharing**; it contains operational cron strings, compatibility flags
and hashes, but no secret values. A nonzero tool exit means an
incomplete or blocked gate, **not** a production outage and does
not justify a privileged token or any configuration changes.

## Staging plan — proposal only; NO deployment in WEB-04B-7C

Do not use Cloudflare's Version/Preview URL as a substitute for
an isolated environment. Version URLs can use **actual version-bound
Production D1/R2 resources**, so a `scheduled()` or admin path
could write to Production even if the URL looks temporary.

An independent reviewer must verify **all** before authorizing a
separate Staging deployment:

1. Separate Worker script/service name and preview route, no
   overlap with Production hostnames, zones, triggers or cron.
2. A separate disposable D1 database created from **synthetic or
   approved sanitized data**, never the Production D1 UUID.
3. A separate disposable R2 bucket name, never the Production
   `RAW_BUCKET`. Never copy secret token values into source control.
4. Scheduled triggers explicitly **disabled** in Staging; reject
   admin collection/repair calls or use isolated, deliberately
   scoped synthetic fixtures. HKO/CMA/JMA/CWA outbound
   production collection is not permitted from Staging by default.
5. Worker compatibility date and flags **matched intentionally**
   to active Version 17 after the owner-run metadata audit.
6. A verified predeploy source digest, immutable old Version ID,
   D1 binding identity, R2 bucket hash, routes, cron schedule and
   expected legacy health response captured to private evidence.
7. Dedicated staging API baseline: legacy shape, 0/1/199/200/201
   /748 paging, agency-filter, 159 same-time tie pattern,
   canonical aliases, bad cursor HTTP 400, malformed D1 HTTP 503,
   and API response sizes and D1 reads. Confirm latest, middle
   and earliest frames for a real storm >200 advisories only when
   secure sanitized data is available.
8. No automatic GitHub Actions deployment, scheduled upload or
   Worker schema migration; explicit owner approval required.

## Production Go/No-Go and rollback rehearsal (not performed)

- Go only after a reviewer signs off immutable source lineage,
  exact Version-17 runtime parity, Cloudflare route/cron
  inventory, isolated staging, passed contract tests, binding
  continuity, approved deployment mechanics, observability
  and a reversible previous-version redeploy procedure.
- Record the previous **immutable Worker version and deployment ID**
  immediately before the change. Confirm the selected rollback
  version still has necessary bindings and compatibility flags.
- Stage release via a separately approved Worker deployment;
  no production D1 index or schema modification included.
- Postrelease checks: legacy API must keep three top-level
  fields, existing HKO/CMA/JMA/CWA proxy health, scheduled
  collection behavior, new cursor first/middle/last page, D1
  latency/error budget and stable playback. Avoid collecting
  or exposing raw bulletin PII/secrets in logs.
- Roll back immediately on legacy contract regression,
  failed collection/proxies, cursor duplicates/missing rows,
  increased D1 read failures or unacceptable latency.
  Use Cloudflare's supported immutable-version redeploy
  control only after explicit authorization. Never upload
  unverified source as a rollback shortcut.
- Rollback rehearsal must first occur on the **isolated Staging
  Worker**, confirming the legacy endpoint and scripted checks
  recover. No production rollback has occurred.

**WEB-04B-7C expected exit:** metadata preflight completed with
version runtime and D1/R2 identity verified; staging isolation
plan reviewed; remaining route/cron and release authorization
gates listed explicitly. Never report Production readiness
merely from green synthetic tests or metadata GET requests.

PR #118 and PR #119 stay Draft until separate owner approval.
