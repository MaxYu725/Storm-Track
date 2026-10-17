# WEB-04B — Full historical advisory replay: readiness stage

Status: DRAFT, not enabled on production.

## Safety boundary

Production Cloudflare Worker: https://storm.max-yu.workers.dev
Production Worker source is NOT currently authoritative in this GitHub repository.
The old backend/worker.js (v3.3.0-alpha.4) must NOT be substituted for the
deployed source. No Worker, D1, R2, evidence, forecasting or Android
modifications are included.

## Current limitation

The web Archive requests only the latest 200 advisories. WEB-04A now warns
users when the capped response may be incomplete. Old repository Worker code
supports a per-storm limit but not advisory cursor/offset paging. The actual
production API could not be reached from this execution environment, so its
current contract remains unverified.

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
