# WEB-04B-4 — Production D1 read-only advisory schema / index audit

Status: **TOOL PREPARED; real Production D1 NOT YET AUDITED**.
Scope: Storm-Track browser/archive history only. No Android, AI, HK Signal
models, Worker deployment, D1/R2 writes, migrations, deletes or index creation.

## Why a read-only audit is needed

The owner-exported `storm` Worker source (version constant
`3.3.0-alpha.4`) queries complete advisories using only:
```sql
WHERE storm_id=? AND ingest_status='complete'
ORDER BY issued_at DESC LIMIT ?
```
This is not stable for tied bulletin timestamps and cannot retrieve
records beyond a capped page. Proposed WEB-04B keyset pagination must
be designed against the **real** D1 schema and query plan, not assumed
indexes or historic source files. The exported code's match to GitHub
does not yet prove that its bytes belong to traffic-serving Version 17.

## Exact audit tool

Run `scripts/audit-web04b-d1-readonly.mjs` locally with Node.js 22+.
The tool has no arbitrary SQL option and requires a D1 **Read**-scoped
Cloudflare API token. Cloudflare's D1 query REST endpoint uses **HTTP
POST even for read-only SQL**; it does NOT use GET for SQL inspection:
https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/

Fixed maximum **8** requests on a healthy schema:
- 1 `GET /accounts/{account}/d1/database/{uuid}` verifies the exact database ID.
- 7 `POST /accounts/{account}/d1/database/{uuid}/query`
  carry fixed SQL only: `PRAGMA table_info('advisories')`,
  `PRAGMA index_list('advisories')`, bounded index SQL metadata,
  three `EXPLAIN QUERY PLAN SELECT` cases (base, agency filtered,
  proposed issued_at/id keyset), and a maximum 128-row timestamp
  sample with `SELECT ... WHERE ingest_status='complete' LIMIT 128`.
- Strict response timeouts, 512KB response caps, read-only SQL whitelist
  by construction, early abort on schema mismatch or write indicators.
- No raw sampled IDs, storm IDs, advisory rows or credentials are printed
  or saved. Reports only metadata, plan classification, timestamp counts
  and shortened hashes of account/database IDs.
- The summary is written to a private OS temp directory, not the Git
  checkout. Synthetic tests only are run in GitHub CI, no real
  Cloudflare SQL requests are made from CI.

**Identity prerequisite:** In Cloudflare dashboard, confirm which D1
database UUID is actually bound to production Worker `storm` under
binding name `DB`. The tool can check that the chosen UUID exists
but cannot independently prove which Worker binding uses it. If in
doubt, STOP rather than assuming a similarly named D1 database.

## Windows PowerShell: use your existing Desktop folder

The user does not need a full Git clone. Download the audited script:
```powershell
$folder = Join-Path $HOME 'Desktop\Storm-WEB04B'
New-Item -ItemType Directory -Force -Path $folder | Out-Null
$url = 'https://raw.githubusercontent.com/MaxYu725/Storm-Track/feature/web-04b-advisory-cursor-readiness/scripts/audit-web04b-d1-readonly.mjs'
Invoke-WebRequest -Uri $url -OutFile (Join-Path $folder 'audit-web04b-d1-readonly.mjs')
Test-Path (Join-Path $folder 'audit-web04b-d1-readonly.mjs')
```
The final test must be `True`. Then:
```powershell
$account = Read-Host 'Cloudflare account ID'
$db = Read-Host 'Production D1 UUID bound as DB to Worker storm'
$secure = Read-Host 'Scoped Cloudflare D1 Read API token' -AsSecureString
try {
  $env:CLOUDFLARE_API_TOKEN = [System.Net.NetworkCredential]::new('', $secure).Password
  node (Join-Path $folder 'audit-web04b-d1-readonly.mjs') --account-id $account --database-id $db
} finally {
  Remove-Item Env:\CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
  Remove-Variable secure -ErrorAction SilentlyContinue
}
```
Use the least-privileged D1 Read token for the correct account, ideally
narrowed to the relevant database. Never paste any Cloudflare token,
D1 ID or raw returned advisory rows into GitHub, chat or screenshots.
Share only a reviewed `d1-readonly-audit.private.json` summary, or
paste its non-sensitive `columns`, `indexes`, `indexDDL`,
`plans`, `sample` and `readiness` fields.

## How to interpret results

- `indexSearch: true` + `tempSort: false` for base/agency/cursor
  is *preliminary* evidence an existing index might work. An
  `indexScan` is treated conservatively. `EXPLAIN` never executes
  the planned query and does not establish actual latency or R/W costs.
- `nonCanonicalTime` counts sample timestamps different from exact
  `YYYY-MM-DDTHH:mm:ss.SSSZ` canonical form. Mixed local offsets,
  missing fractions or SQL `DATETIME` strings can invalidate the
  naive lexicographic keyset predicate even if JavaScript parses them.
- The 128-row sample is **not a complete historic timestamp audit**.
  It may miss old or rare malformed rows, ties, backfills and agency
  differences. Do not claim comprehensive integrity from this result.
- A `REVIEW_REQUIRED` status is NOT permission to change indexes.
  `SAMPLED_PLANS_ACCEPTABLE_FULL_REVIEW_REQUIRED` is still NOT
  permission to release a Worker patch.

Possible index candidates for separate review (do **NOT** execute here):
```sql
-- Potential general case (subject to schema, measured plans and data):
-- CREATE INDEX ... ON advisories(storm_id, ingest_status, issued_at DESC, id DESC);
-- Optional agency-specific index may be considered after plan inspection.
```
Index creation changes production schema and is outside WEB-04B-4.

## Exit criteria before WEB-04B-5

1. Verify the actual D1 `DB` binding UUID for the traffic-serving Worker.
2. Save real, reviewed metadata and timestamp sample summary.
3. Review all three query plans for table scans/temp sorting and verify
   the `issued_at` storage canonicalization assumptions.
4. Independently resolve the active Version 17 deployed-source binding
   (Worker source `/content/v2` is not per-version proof).
5. Prepare a separate reviewed and reversible backend implementation;
   keep PR #118 Draft until release gates are met.

No Android code or production Cloudflare resources are modified by this stage.
