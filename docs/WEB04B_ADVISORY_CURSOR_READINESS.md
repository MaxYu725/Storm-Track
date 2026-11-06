# WEB-04B — Full historical advisory replay: readiness stage

Status: DRAFT, not enabled on production.

## WEB-04B-2 public production API verification — 2026-10-17

A one-shot branch-only GitHub Actions Runner successfully executed
`node scripts/audit-web04b-production-api.mjs` against
`https://storm.max-yu.workers.dev`. The original execution environment
could not resolve this host; the hosted Runner could reach it.

- Evidence: https://github.com/MaxYu725/Storm-Track/actions/runs/39036021074
- Run commit: `3b469c480760ac8b45fd52372436b5fb503fad81`
- Result: `legacy-no-cursor-contract` (the probe itself exited successfully).
- Production history list supplied `reportedCount: 748` for the selected
  storm. This is an API-reported count, **not** a verification of 748 records
  retrieved, or complete 748-frame replay.
- First advisory sample: `firstPageCount: 2` with request `limit=2`.
- `cursorSupported: false` for the proposed contract
  `storm-history-advisory-cursor/v1`.
- Only **2 HTTP GET** requests were made (history list, first advisory page);
  no next-page cursor was guessed and no writes or credentials were used.
- Production API is reachable from GitHub Runner; no verified versioned cursor
  contract is present in the sampled response. This is **not** proof that no
  other pagination mechanism exists, and is not deployment-source verification.
- Deployed Worker script source, deployment/version identity and SHA256
  remain **unverified**. Require user-authorized Cloudflare read-only export
  before proposing any Worker changes. Keep Archive cursor UI disabled and
  PR #118 in Draft.

The temporary, branch-only one-shot workflow is removed after capturing
the completed run in Actions history; nothing new is installed into `main`.

## WEB-04B-3 — deployed Worker provenance capture prepared (NOT executed)

GitHub branch: `feature/web-04b-advisory-cursor-readiness`.

The local-only tool `scripts/audit-web04b-worker-provenance.mjs` has
isolated mocked tests. It cannot execute against Cloudflare without the
account owner's **explicitly provided** read-only token and exact account/script
identity. Neither a production deployment nor an authorized Cloudflare source
export has occurred.

Cloudflare documents these GET APIs:
- [Deployments](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/)
- [Specific version metadata](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/)
- [Worker script content](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/content/methods/get/)

The tool: requires an explicit 32-hex account ID and exact script name (not
guessed from workers.dev), uses only HTTPS GET calls, reads the currently latest
traffic-serving deployment and per-version metadata, downloads script content,
then re-reads the deployment to catch rollouts during capture. The local output
is stored with private file permissions in an **OS temporary directory outside
Git**, never checked in. The capture records the raw-response SHA256 and
Cloudflare's returned per-version script etags *separately*.

**Crucial:** Cloudflare `GET /content/v2` does not, by itself, prove that the
downloaded bytes correspond to each active deployment version. The tool
always emits `deployedVersionSourceMatch: NOT_VERIFIED`; source/version
provenance and secrets inspection remain a **manual hard release gate**.
For weighted deployments, inspect every traffic-serving version separately
through an approved method. Never patch the old repository Worker as if it
were proven production code.

Run locally on Windows PowerShell with Node.js 22+ (not GitHub Actions):
```powershell
$account = Read-Host 'Cloudflare account ID'
$script = Read-Host 'Exact deployed Worker script name'
$secure = Read-Host 'Workers Content Read-Only API token' -AsSecureString
try {
  $env:CLOUDFLARE_API_TOKEN = [System.Net.NetworkCredential]::new('', $secure).Password
  node scripts/audit-web04b-worker-provenance.mjs --account-id $account --script-name $script
} finally {
  Remove-Item Env:\CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
  Remove-Variable secure -ErrorAction SilentlyContinue
}
```
Create the token with minimum Worker content-read permissions and only the
specific account/Worker scope where possible. Do not place the token in Git,
Actions secrets, shell history, chat, or any generated artifact. Never upload
`worker-content.private.bin` before reviewing the source for embedded secrets.
Do not share the private output directory publicly. The manifest only contains
metadata and hashes; check it before sharing.

Next gate:
1. Owner supplies the exact Cloudflare Worker identity and runs the local
   read-only capture (or authorizes an equivalent connected Cloudflare service).
2. Verify production deployment IDs, traffic percentages, content hashes and
   source/version association. If source versions cannot be matched,
   **do not** claim the source is authoritative.
3. Review verified handler, D1 storage and query ordering in a **separate
   implementation stage**, with rollback and no schema or data modifications
   until approved.

## WEB-04B-3 source audit — owner-exported multipart (2026-10-17)

Status: extracted Worker source inspected and matched to GitHub; the source-to-traffic-serving-Version-17 association is NOT yet independently verified.

- Cloudflare `/content/v2` response: multipart/form-data, 97,221 bytes, SHA-256 `b21c11bb2d68449e3766422043fe13aca17797ed726fa6df63a9f7bedfde3d9d`.
- One `worker.js` JavaScript module part: 96,970 bytes; SHA-256 `333d9405b1c4322ec09815f1d1bb19c8746933dcc18557904dc8f8c913255c80`.
- The main-branch `backend/worker.js` is 96,971 bytes. Appending only one terminal newline to the extracted module yields exact Git blob SHA-1 `8958e6c13a5ea04cf7bcbbbc261ea4689bd8c131`. Therefore downloaded script code equals repository code except terminal LF.
- Exported code constant `VERSION = '3.3.0-alpha.4'`; opening header comment still says `alpha.2`, a stale comment. `node --check` passes.
- Limited static secret scan found no hardcoded key, token or private key. It is not a full security audit; secrets stored as bindings are not part of this export.
- Owner metadata identifies a 100%-traffic Version 17 deployment, but the reported Cloudflare `resources.script.etag` does not equal raw-response or extracted JavaScript SHA-256. Its hashing/representation has not been established, so `deployedVersionSourceMatch: NOT_VERIFIED` remains mandatory. Do not claim version-to-source cryptographic proof.

Actual handler `historyAdvisories()` resolves canonical storm ID, optionally filters HKO/CMA/JMA/CWA, requires `ingest_status='complete'`, caps `limit` at 200, and executes `ORDER BY issued_at DESC LIMIT ?`. It returns `{version, stormId, advisories}` without cursor or pagination metadata, matching the observed read-only Production API capability probe.

Proposed additive backend change, **not yet implemented or authorized for rollout**:
1. Stable `ORDER BY issued_at DESC, id DESC`, preserving legacy response fields.
2. Strict bounded versioned opaque cursor, validated against canonical storm identity, agency filter and requested page size; reject malformed or cross-context cursors instead of silently restarting.
3. Parameterized D1 keyset predicate `issued_at < ? OR (issued_at = ? AND id < ?)` with `LIMIT limit+1`; return contract/order/count/hasMore/nextCursor metadata.
4. `normalizeIsoTime` normalizes newly parsed timestamps to UTC, but verify historical/backfilled D1 timestamp formats before lexicographic comparison. Audit actual indexes and query plans read-only.
5. Document concurrency/backfill behavior (keyset alone is not a snapshot). Ensure legacy clients and archived data remain unmodified; UI integration stays disabled until Worker contract verified.

Remaining gates: independently verify exact deployed-Version-17 source association, read-only D1 schema/index inspection, separate reviewed Worker implementation and rollback plan. No Worker, D1, R2, Android or Production modifications occurred.

## Safety boundary

Production Cloudflare Worker: https://storm.max-yu.workers.dev
Production Worker source is NOT currently authoritative in this GitHub repository.
The old backend/worker.js (v3.3.0-alpha.4) must NOT be substituted for the
deployed source. No Worker, D1, R2, evidence, forecasting or Android
modifications are included.

## Current limitation

The web Archive requests only the latest 200 advisories. WEB-04A now warns
users when the capped response may be incomplete. Old repository Worker code
supports a per-storm limit but not advisory cursor/offset paging. The GitHub Actions Runner probed the actual production API on 2026-10-17;
its sampled response lacked the proposed versioned cursor contract. Source
provenance and any other possible pagination mechanisms remain unverified.

## Proposed additive API contract (requires source review)

Initial:
    GET /api/history/storms/{stormId}/advisories?limit=200

Subsequent, only after confirmed versioned capability:
    GET /api/history/storms/{stormId}/advisories?limit=200&cursor=OPAQUE

Response:
    {
      "stormId": "STC-EXAMPLE",
      "advisories": [
        {"id":"newer","storm_id":"STC-EXAMPLE","issued_at":"2026-10-17T12:00:00Z"},
        {"id":"older","storm_id":"STC-EXAMPLE","issued_at":"2026-10-17T06:00:00Z"}
      ],
      "pagination": {
        "contract":"storm-history-advisory-cursor/v1",
        "order":"issued_at_desc,id_desc",
        "limit":200,
        "count":2,
        "hasMore":true,
        "nextCursor":"OPAQUE"
      }
    }

Requirements of the eventual authoritative Worker change:

1. Read only completed advisories for the resolved canonical storm ID.
2. Stable keyset order: issued_at DESC, id DESC (tie-breaker is mandatory).
3. Bound and validate cursor tokens on the server. Use parameterized D1 queries
   based on the last (issued_at, id), querying limit+1 to detect hasMore.
4. Do not accept malformed cursor tokens as a request for the first page.
5. Preserve legacy response fields and all original as-issued data.
6. Address concurrency and historical backfill; keyset avoids offset shifting,
   but by itself is not a transactional snapshot under concurrent backfill.
7. No changes to D1 schema, original archives, V1/V2, Consensus or AI analyses.

## Prepared components — not wired into live HTML

- analysis/archive-advisory-cursor.js: version-verified parser/append helper,
  cross-page identity and order checks, cursor-cycle guard, fails closed.
- tests/archive-advisory-cursor.test.cjs: 235-item synthetic full replay and
  legacy/malformed/overlap/cycle/tie/limit regression cases.
- scripts/audit-web04b-production-api.mjs: read-only capability probe with
  at most three GET requests, 10-second timeouts, 2 advisories/page, bounded
  JSON parsing and no credentials. Reports only metadata and hashed storm ID.
- tests/web04b-production-api-audit.test.mjs: mocked network audit cases.
- Existing frontend Beta validation CI runs synthetic tests only.

## How to run the read-only public API probe

From a Node 22+ checkout:

    node scripts/audit-web04b-production-api.mjs

Optional: choose a known storm with over 200 advisories:

    node scripts/audit-web04b-production-api.mjs --storm-id YOUR_STORM_ID

The automatic choice scans 30 latest storms for the largest advisory_count.
This test is GET-only and does not mutate production.

Outcomes:
- legacy-no-cursor-contract: versioned paging NOT verified; no older-page fetch.
- cursor-contract-first-page-verified: schema matches, but there was no next page.
- cursor-contract-two-pages-verified: version, sorted order and distinct IDs
  passed over two small pages. Not a guarantee that all >200 bulletins exist.
- audit-inconclusive: HTTP/network/response problem, not evidence of no support.

## Recover authoritative deployed Worker source (user action, read-only)

Cloudflare documents GET
/accounts/{account_id}/workers/scripts/{script_name} for raw script download:
https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/get/

Confirm the actual script name and account ID in the Cloudflare dashboard.
Do not guess the script name from its hostname. Obtain a scoped API token
with Workers Content Read-Only (or equivalent script read permissions).

Windows PowerShell:

    $account = Read-Host 'Cloudflare account ID'
    $script = Read-Host 'Exact deployed Worker script name'
    $secureToken = Read-Host 'Read-only Cloudflare API token' -AsSecureString
    $token = [System.Net.NetworkCredential]::new('', $secureToken).Password
    $headers = @{ Authorization = "Bearer $token" }
    $uri = "https://api.cloudflare.com/client/v4/accounts/$account/workers/scripts/$([uri]::EscapeDataString($script))"
    Invoke-WebRequest -Uri $uri -Headers $headers -OutFile '.\storm-production-worker-export.bin'
    Remove-Variable token, headers, secureToken -ErrorAction SilentlyContinue
    Get-FileHash '.\storm-production-worker-export.bin' -Algorithm SHA256

This raw/module response may not be a single JavaScript source file. Preserve
an unmodified private backup. Inspect for embedded credentials before sharing
or committing; NEVER paste tokens or account secrets into chat, GitHub, logs,
or source control. Check deployment/version metadata before treating a raw
download as the actual traffic-serving version, especially in gradual rollouts.

## Release gates

1. Obtain the authoritative production source + SHA256 + deployment identity.
2. Probe the real production API and confirm the exact contract version.
3. If absent, patch the authoritative source only, in a separate reviewed
   Worker rollout with D1 query fixtures, rollback and no D1 migration.
4. Only then wire the Archive to fetch older pages, preserve selected advisory
   ID and playback state, and cache fully verified paginated results.
5. Validate 0/1/199/200/201/>200 advisories, tie-time IDs, concurrent writes,
   invalid cursors, changing storms, offline cache, and intermittent errors.
6. Verify earliest, middle and latest frames for one real >200 advisory storm.

Until stages 1–3 are verified, keep WEB-04B as DRAFT and do not claim a
complete history replay.
