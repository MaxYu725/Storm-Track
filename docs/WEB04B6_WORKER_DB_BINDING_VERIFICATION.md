# WEB-04B-6 — Production Worker version + D1 Binding proof

**State: Cloudflare owner-run Worker/D1 Binding VERIFIED; deployed-version source association PENDING.**
Scope: Storm-Track web Archive historical advisory cursor, not Android.
Do not deploy Worker, update D1/R2, run schema migrations, change Archive UI,
or enable the new cursor endpoint in this stage.

## WEB-04B-6 — Owner read-only production verification completed (2026-10-18)

The owner uploaded a privately retained
`storm-web04b6-worker-db-binding/v1` JSON report recorded at
`2026-10-18T02:32:10.757Z`. The report itself, credentials, raw
Cloudflare response, account ID and D1 UUID are **not** committed.

**Verified:**
- Live Cloudflare Worker script: `storm`.
- Latest active deployment ID:
  `895652c2-06b3-4cd9-afbb-d886cac7f0fe`.
- Active Worker version:
  `320a390b-315e-494c-a135-eb242adc340d` (version number 17),
  carrying **100%** of traffic.
- `versionDBBinding: {sourceState: 'present', matchesExpected: true}`.
- `currentSettingsDBBinding: {sourceState: 'present', matchesExpected: true}`.
- Result: `TRAFFIC_VERSION_DB_MATCH_CURRENT_SETTINGS_MATCH`.
- The requested database identifier hash prefix matched the prior
  owner-run `storm-track-db` D1 audit. This joins evidence for the
  previously checked 2,061 completed advisories and this traffic-serving
  version's exact `DB` binding.
- Exactly 4 GET-only requests, 0 Worker or D1 mutations reported.

**Not verified (hard release gate remains):**
- `versionSourceMatch: NOT_VERIFIED`: the earlier `/content/v2`
  export matches GitHub `backend/worker.js` except terminal newline,
  but the exported response was not independently bound to the exact
  traffic-serving Version 17 script payload. The 64-character
  `resources.script.etag` is marked as hashed script content by
  Cloudflare, yet is not directly equal to the exported multipart or
  extracted JS SHA-256. Do **not** assume byte-level identity.
- The real `storm` Worker remains deployed without the versioned cursor
  endpoint. PR #118 is still Draft and has no production Worker, DB,
  R2, Archive HTML or Android modifications.
- Passing Binding proof does **not** grant approval to deploy a
  Worker, run index migrations, change Production, or merge PR #118.

**Gate outcome:**
`WEB-04B-6 DB_BINDING_GATE=PASS`,
`WORKER_VERSION_SOURCE_GATE=PENDING`,
`RELEASE_GATE=BLOCKED`.

**WEB-04B-7 review proposal:** locate an independently verifiable
version-specific artifact/source reference, or an approved Cloudflare
version download where available. Then prepare a separate additive
backend patch with strict `issued_at DESC, id DESC` stable cursor
pagination, legacy response compatibility, D1 query plans, and rollback
and live probe criteria. Keep the index optional unless staging
benchmarks justify it. No source or Production change before the
remaining gate is resolved and reviewed.

## Prior verified evidence

- PR #118 branch `feature/web-04b-advisory-cursor-readiness` is Draft.
- 2026-10-17 owner-run Cloudflare Workers read-only export:
  `storm` script code content (96,970 bytes, module) matches
  `main:backend/worker.js` except one terminal line-feed. Script constant
  says `3.3.0-alpha.4`. A 100%-traffic Version 17 was observed.
  Exported content does **not** cryptographically prove it corresponds
  to that specific deployed version. Its script content hash and
  Cloudflare's version `script.etag` are NOT interchangeable.
- 2026-10-17 owner-run D1 read-only aggregate: `storm-track-db`,
  `completeRows=2061`, invalid time shape/ID=0, 159 same-storm
  same-timestamp groups spanning agencies; general/cursor proposed
  order by `issued_at DESC, id DESC` still incurs a temp B-tree
  on existing Production indexes. D1 database UUID was redacted/hashed.
  This result does NOT independently establish the `storm`
  traffic-serving Worker `DB` binding identity.
- WEB-04B-5 offline synthetic tests passed for 0,1,199,200,201,748
  advisories, stable ID tie-breakers and scoped positioning cursors.
  No live Worker/API patch was deployed.

## New read-only metadata inspector

`scripts/audit-web04b6-worker-db-binding.mjs` performs exactly
**four HTTPS GET** requests, with short timeouts and response limits:

1. `GET /accounts/{account}/workers/scripts/{script}/deployments?per_page=1`:
   identify the live, single 100%-traffic deployment.
2. `GET /accounts/{account}/workers/scripts/{script}/versions/{id}`:
   inspect that exact *traffic-serving* Worker version number, script
   metadata and its `resources.bindings`.
3. `GET /accounts/{account}/workers/scripts/{script}/settings`:
   separately inspect currently published script-version settings.
4. Repeat deployment-list GET and reject any identity/traffic drift.

Requires explicit account ID, exact script name, **expected D1 UUID**
and expected active version number. Fails closed if the active
deployment changes, if there is any traffic split or if the
expected version number is no longer live.

Worker version binding is evaluated **independently** of current
settings, which may represent a different version than the
traffic-serving version. Outcomes include:

- `TRAFFIC_VERSION_DB_MATCH_CURRENT_SETTINGS_MATCH`: the active
  version and current settings both reference the expected D1 UUID.
- `TRAFFIC_VERSION_DB_MATCH_SETTINGS_DIFFER_OR_ABSENT`: active version
  matches the expected D1, but current settings differ/are absent;
  a deliberate review is required, not an automatic downgrade.
- `CURRENT_SETTINGS_ONLY_NOT_VERSION_VERIFIED`: only current settings
  match; this is **not enough** to establish the traffic-version binding.
- `NOT_VERIFIED_OR_MISMATCH`: the active version binding is missing,
  incomplete or inconsistent with the requested D1 UUID.

The inspector does not serialize secret values, other bindings,
raw API responses, Cloudflare tokens, account/database UUIDs or
any D1 records into its report. Only requested database SHA256 prefix,
script name, deployment/version identity, nonsecret ETag and boolean
match statuses are saved, privately, to the OS temp directory.

API references:
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/get/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/

Permissions: minimally scoped Workers Content Read-Only or
appropriate Workers Scripts Read permission for version/deployment
metadata, plus Workers Metadata Read-Only where needed for settings.
If the existing token lacks settings access, do NOT broaden to
Workers Editor/Admin simply to pass a read-only audit.

## Owner-run Windows PowerShell

This tool uses the same local folder and account/D1 UUID used during
WEB-04B-5, and Node.js 22+; download one new script:

```powershell
$folder = Join-Path $HOME 'Desktop\Storm-WEB04B'
New-Item -ItemType Directory -Force -Path $folder | Out-Null
$url = 'https://raw.githubusercontent.com/MaxYu725/Storm-Track/feature/web-04b-advisory-cursor-readiness/scripts/audit-web04b6-worker-db-binding.mjs'
Invoke-WebRequest -Uri $url -OutFile (Join-Path $folder 'audit-web04b6-worker-db-binding.mjs')

$account = Read-Host 'Cloudflare account ID'
$db = Read-Host 'D1 UUID previously audited (storm-track-db)'
$secure = Read-Host 'Scoped Workers read-only API token' -AsSecureString
try {
  $env:CLOUDFLARE_API_TOKEN = [System.Net.NetworkCredential]::new('', $secure).Password
  node (Join-Path $folder 'audit-web04b6-worker-db-binding.mjs') --account-id $account --script-name storm --database-id $db --expected-version-number 17
} finally {
  Remove-Item Env:\CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
  Remove-Variable secure -ErrorAction SilentlyContinue
}
```

If Cloudflare deployed another version since the previous audit,
the script will stop; do not force `17` as the new answer. Re-review
active version and script provenance before a Worker rollout.

The output file `worker-db-binding.private.json` is created outside
the checkout. Inspect it before sharing. NEVER share token,
raw settings JSON or raw binding arrays; share the JSON report only.
The script makes **zero** Worker writes and **zero** D1 calls.

## Exit gates

1. **Production D1 binding:** Owner-run report must explicitly show
   `versionDBBinding.matchesExpected: true` with single stable
   deployed version, and D1 identity hash equal to prior audited report.
2. **Version/source association:** Still `NOT_VERIFIED`. The
   Cloudflare script ETag cannot be equated to the SHA256 of the
   downloaded multipart response. Additional approved version-specific
   artifact/provenance evidence is needed to claim exact source identity.
3. **Backend patch:** After those gates, prepare an independent reviewed
   Worker rollout diff based on the proven source. Add strict versioned
   cursor support, keep legacy API fields and behavior compatible,
   correct tie sorting and transactional constraints. Rollback must
   be documented and tested before any writes or deployments.
4. **Index:** A single candidate composite index can be benchmarked
   in staging. No Production index/migration is justified by the
   existing `EXPLAIN` summary alone.
5. **Frontend:** Keep cursor Archive wiring disabled until the deployed
   endpoint passes live read-only contract testing, >200 real history
   replay, offline cache and time-frame consistency validation.

No changes to Production Worker, D1, R2, Android, web HTML or `main`.
