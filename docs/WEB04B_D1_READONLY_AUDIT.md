# WEB-04B-4 — Production D1 read-only advisory schema / index audit

Status: **TOOL PREPARED; real Production D1 NOT YET AUDITED**.
Scope: Storm-Track browser/archive history only. No Android, AI, HK Signal
models, Worker deployment, D1/R2 writes, migrations, deletes or index creation.

## Owner-provided Production D1 audit result — 2026-10-17

The owner ran the local read-only D1 audit and supplied its summary
(`contract: storm-web04b-d1-readonly-audit/v1`, recorded at
`2026-10-17T15:29:34.722Z`). **No private audit JSON, raw advisory data,
Cloudflare account ID, database UUID or credentials are committed.**

- API read target: D1 database reported as `storm-track-db`.
  The account hash prefix matches the earlier Worker metadata review;
  this is NOT independent proof of the production Worker `DB` binding.
- `advisories` contains required `id`, `storm_id`, `agency`,
  `issued_at` and `ingest_status` columns. `id` is primary-key text.
- Index inventory: four explicitly named indexes plus two SQLite
  autoindexes (six total). Relevant existing SQL:
  `idx_advisories_storm_time ON advisories(storm_id, issued_at DESC)`,
  `idx_advisories_agency_time ON advisories(agency, issued_at DESC)`,
  and `idx_advisories_status ON advisories(ingest_status)`.
  **No current index explicitly covers** `(storm_id, ingest_status,
  issued_at DESC, id DESC)`.
- `EXPLAIN QUERY PLAN` summaries for proposed stable `issued_at DESC,
  id DESC` sorting:
  - base storm list: index search yes, table scan no, **tempSort yes**;
  - agency filter: index search yes, table scan no, tempSort no;
  - cursor keyset: index search yes, table scan no, **tempSort yes**.
  Agency's lack of temp sort does not prove good selectivity or low latency,
  because the summary does not retain the actual index/plan details.
- Fixed 128-row un-ordered sample: 0 invalid timestamps, 0 non-canonical
  timestamps, 0 invalid advisory IDs, 0 invalid storm IDs.
  Agency counts HKO=18, CMA=34, JMA=59, CWA=17. There were 32
  *repeat occurrences of a timestamp value across all 128 sampled rows*;
  the sample does NOT establish that these were same-storm duplicates.
  No full-table timestamp or tie-frequency assurance is implied.
- `readiness: REVIEW_REQUIRED`, `writesAttempted: 0`,
  `releaseGate: BLOCKED_NO_PRODUCTION_CHANGES`.
  One metadata GET and seven fixed read-only SQL POST calls were reported.

**Review verdict:** WEB-04B-4's bounded production read-only
inspection is complete, but the schema/index release gates are NOT met.
There is a concrete ordering/index mismatch for proposed cursor paging.
Keep PR #118 Draft. Do not add indexes, run migrations, change Worker,
R2 or Archive UI as part of this review.

## WEB-04B-5 proposed next steps (not executed)

1. Independently confirm `storm` Worker production `DB` binding UUID
   and Version-17 source identity; the audit only verified the selected
   D1 UUID exists, not the live Worker binding.
2. Complete a narrowly scoped read-only examination of historical
   timestamp distributions and same-storm/same-time ties across agencies.
   Do not infer complete-data consistency from the 128-row sample.
3. Obtain exact `EXPLAIN QUERY PLAN` detail and representative workload
   profile; bench candidate indexes in isolated local/staging SQLite/D1,
   **never in production**.
4. Start with an isolated candidate such as
   `(storm_id, ingest_status, issued_at DESC, id DESC)`. Compare
   an optional agency-specific index only after agency query selectivity
   and write overhead have been measured. Index statements are
   PROPOSALS, not approved migrations.
5. Design the versioned keyset endpoint with canonical storm/agency
   scoping, bound and validated cursors, deterministic tie breaks,
   paginated `limit+1`, strict fail-closed behavior and compatibility
   with legacy consumers. Test against 0/1/199/200/201/>200 rows,
   same-time ties, backfills and concurrent writes before a separate
   reviewed production rollout.

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
