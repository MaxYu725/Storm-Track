# WEB-04B-7B — Immutable Version-17 source evidence and isolated runtime

Status: **Immutable Production Version-17 source MATCHED; local Worker+D1 runtime smoke PASS; staging/release review PENDING.**

Scope: Storm-Track browser Archive only. No `main`, Android, Production
Worker, D1/R2, PWA, route, settings, secrets or schedule changes.

## Owner's immutable Version-17 source verification — PASS (2026-10-18)

Owner-supplied metadata-only report `storm-web04b7b-immutable-source/v1`
was recorded at `2026-10-18T03:37:42.933Z` and returned:

- Script `storm`, deployment `895652c2-06b3-4cd9-afbb-d886cac7f0fe`,
  immutable version `320a390b-315e-494c-a135-eb242adc340d`,
  number **17**, **100% traffic**.
- Version-scoped `include=modules` response had **one** main JavaScript
  module and **zero** extra modules.
- `comparison.status=VERSION_MAIN_MATCH_TRAILING_LF_ONLY`.
  Version module SHA256:
  `333d9405b1c4322ec09815f1d1bb19c8746933dcc18557904dc8f8c913255c80`.
  Pinned repository baseline SHA256:
  `c4de8ea57459d4a72eb58067135ea030f68cf8571517521c6638d89bdaaaace1`.
  The two contents differ by one terminal line-feed only, which is
  **not** a byte-identical file match.
- Pinned Git blob SHA1:
  `8958e6c13a5ea04cf7bcbbbc261ea4689bd8c131`.
  Prior unversioned `/content/v2` extracted-module SHA256 matches the
  **version-specific** module SHA256.
- `versionSourceStatus=MATCHED`,
  `fullWorkerArtifactStatus=SINGLE_MODULE_SOURCE_MATCHED`.
  Three Cloudflare **GET-only** requests; `writesAttempted=0`.

**Decision:** `VERSION_17_IMMUTABLE_SOURCE_GATE=PASS`. This
validates the checked version's original source identity but **does not**
authorize deploying the additive PR #119 backend patch or demonstrate
current/runtime/environment/cron/route parity. The owner report
explicitly retains `BLOCKED_PENDING_ISOLATED_RUNTIME_AND_RELEASE_REVIEW`.
Do not commit the private JSON or any raw Cloudflare source/credentials.

## Discovery: Cloudflare version-specific module retrieval

The existing Workers **Scripts** API only supports an unversioned
`GET /accounts/{account}/workers/scripts/{script}/content/v2` for source
retrieval; it does **not** bind downloaded bytes to a particular traffic
version ID. The `Workers Scripts Versions GET` shows version metadata and
a `resources.script.etag`, but its hash semantics are not a confirmed
SHA256 of the downloaded multipart response.

Cloudflare's **Workers Beta Workers Versions GET** explicitly offers
`include=modules`:

```http
GET /accounts/{account_id}/workers/workers/{worker_id}/versions/{version_id}?include=modules
```

The documented `modules[]` records include `name`, `content_type`,
and `content_base64`; `main_module` identifies the entrypoint.
References:

- https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/get/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/content/methods/get/
- https://developers.cloudflare.com/workers/versions-and-deployments/

This may furnish a **directly version-specific, immutable module byte
reference**, avoiding inference from an ETag. It can still be blocked by
Cloudflare permissions, API support or a nonmatching bundle. Do not
claim success until the owner-run report confirms a match.

## Owner-exported baseline and pinned verification

Earlier, an owner-provided `storm` `/content/v2` archive contained one
`worker.js` module with **96,970 bytes** (SHA256
`333d9405b1c4322ec09815f1d1bb19c8746933dcc18557904dc8f8c913255c80`).
Appending exactly one LF matched `backend/worker.js` on the pinned
`main` commit `f6eb9b42677cfa185914fb268b68ec2d0bc194f5`:
Git blob SHA1 `8958e6c13a5ea04cf7bcbbbc261ea4689bd8c131`.

`scripts/audit-web04b7b-version-source.mjs`:

1. Validates the local source file against the **pinned Git blob SHA1**
   before any Cloudflare request. An unpinned or altered reference
   fails closed. The CLI cannot override the pinned blob.
2. GET active deployment metadata and require the **exact known**
   deployment ID `895652c2-06b3-4cd9-afbb-d886cac7f0fe`,
   Worker Version ID `320a390b-315e-494c-a135-eb242adc340d`,
   and 100% traffic on a single version.
3. GET that exact version's `?include=modules` content and validate
   its ID, sequential number 17, main module, byte encoding and size.
4. Compare the main module bytes to the pinned Git reference.
   Reports **EXACT** or **ONE_TERMINAL_LF_DIFFERENCE** distinctly.
   Multiple runtime modules, missing module names, missing `modules`
   or byte mismatch all result in `NOT_VERIFIED` for the full Worker.
5. GET active deployment again and reject any change during the audit.

Maximum three **GET-only** requests, bounded 10 MB total version JSON
and 2 MB per module; no source code, raw response, secrets, account ID
or other binding values are saved or echoed. A private
`version17-source-audit.private.json` metadata-only report is saved
to a temporary OS directory outside the checkout.

A successful **single-runtime-module** match would establish a
stronger Version-17 source lineage than the previous ETag/export
comparison. It does **not** automatically authorize a deployment,
validate Worker configuration or prove that a different future active
version still matches.

### Windows PowerShell — download pinned reference, then read-only audit

Requires Node.js 22+ and a Cloudflare Workers read-only API token
authorized to retrieve version modules (do NOT substitute an
unrestricted admin token). Verify the active deployment remains the
known Version 17 before using the following command:

```powershell
$folder = Join-Path $HOME 'Desktop\Storm-WEB04B'
New-Item -ItemType Directory -Force -Path $folder | Out-Null

$scriptUrl = 'https://raw.githubusercontent.com/MaxYu725/Storm-Track/feature/web-04b7-worker-cursor-review/scripts/audit-web04b7b-version-source.mjs'
$referenceUrl = 'https://raw.githubusercontent.com/MaxYu725/Storm-Track/f6eb9b42677cfa185914fb268b68ec2d0bc194f5/backend/worker.js'
Invoke-WebRequest -Uri $scriptUrl -OutFile (Join-Path $folder 'audit-web04b7b-version-source.mjs')
Invoke-WebRequest -Uri $referenceUrl -OutFile (Join-Path $folder 'worker-v17-candidate-baseline.js')

$account = Read-Host 'Cloudflare account ID'
$secure = Read-Host 'Cloudflare Workers READ-ONLY API Token' -AsSecureString
try {
  $env:CLOUDFLARE_API_TOKEN = [System.Net.NetworkCredential]::new('', $secure).Password
  node (Join-Path $folder 'audit-web04b7b-version-source.mjs') `
    --account-id $account `
    --worker-name storm `
    --deployment-id '895652c2-06b3-4cd9-afbb-d886cac7f0fe' `
    --version-id '320a390b-315e-494c-a135-eb242adc340d' `
    --reference-file (Join-Path $folder 'worker-v17-candidate-baseline.js')
} finally {
  Remove-Item Env:\CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
  Remove-Variable secure -ErrorAction SilentlyContinue
}
```

Share **only** a reviewed metadata-only
`version17-source-audit.private.json`, not Cloudflare account ID,
token, full API response, modules or other credential-bearing data.
If the output says `stage=version-modules HTTP 403` (or 404), the
verification remains BLOCKED; do not elevate privileges automatically.

## Independent runtime + isolated D1 fixture

`tests/web04b7b-miniflare-d1.mjs` runs the PR #119
`backend/worker.js` source with Miniflare/workerd and a completely
local, ephemeral D1 SQLite instance.

- 748 **synthetic** complete advisories seeded to one storm,
  20 to another (no Production copies or Cloudflare tokens).
- Actual API route replays 748 advisories in four pages (200,200,
  200,148) with ordering, no duplicates, strict cursor and agency
  filters. A 200-item legacy request has no new pagination field.
- 8/8 version-source *mock-only* unit tests, 7/7 Worker route mock
  regressions, and local workerd D1 fixture passed at
  https://github.com/MaxYu725/Storm-Track/actions/runs/39093347741
- The available Miniflare runtime supported compatibility date up
  to 2026-08-06, so the isolated fixture used **2026-08-01**.
  This is a strong end-to-end smoke test but **not proof** of byte
  parity with whatever date/flags active Version 17 actually uses.
- The first two CI attempts failed due to emulator setup (unsupported
  future compatibility date; multiline D1 exec). Both were corrected
  and the final test run was green. No Production access occurred.

## Remaining release gates

1. Owner-run immutable Version-17 module report `MATCHED`.
2. Recheck the exact *live* version's compatibility_date,
   compatibility_flags, bindings, cron schedule, D1 and R2 identity,
   and ascertain any additional modules/build artefacts.
3. Rebase/update Draft PR #119 against the definitive source only
   after immutable proof. Review version and patch Diff carefully.
4. Benchmark index behavior in an isolated staging D1; the total
   Production advisory volume was only 2061 at last read-only audit,
   and the proposed new index is optional.
5. Arrange a **separate, explicitly authorized** staging deployment,
   isolated from the Production D1/R2 and scheduled collector.
   Cloudflare **Version URLs** themselves reuse that version's bound
   resources, therefore cannot automatically be treated as isolated
   test environments.
6. Verify 200+ actual history only through approved read-only API
   probes after the backend is deployed, then align PR #118 frontend
   `paging=cursor` probe; preserve rollback by verified immutable
   Worker Version ID, never blind source overwrite.

**Always keep PR #118 and PR #119 Draft, block Production changes,
and never touch Android for this phase.**
