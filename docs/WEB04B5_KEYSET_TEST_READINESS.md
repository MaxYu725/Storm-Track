# WEB-04B-5 — isolated keyset cursor design, index comparison and data-quality gate

Status: **isolated implementation/tests PASS; Production release BLOCKED**.
Scope: browser Archive history advisory replay only. No Android changes.

## WEB-04B-5 aggregate audit HTTP 400 diagnostic/fix (2026-10-17)

The owner reported `WEB-04B-5 aggregate audit blocked: Cloudflare D1 read request HTTP 400`.
The original CLI did not show which query failed, so **the exact failing
statement and Cloudflare error code were not captured**.

Static source review found a **confirmed client-side defect**: the
`formats` statement used a 92-byte `GLOB` pattern while Cloudflare
D1 documents a 50-byte maximum LIKE/GLOB pattern length:
https://developers.cloudflare.com/d1/platform/limits/

Resolution committed on the same feature branch (not on Production):
- Split a 92-byte timestamp shape GLOB into three `substr(issued_at,...)`
  fragments of **42**, **33**, and **17** bytes. The three fragments
  collectively screen the exact same 24-character canonical UTC
  timestamp shape (yyyy-mm-ddThh:mm:ss.sssZ) as before.
- Keep SQL pre-defined, read-only, bounded by the existing 50,000-row
  preflight, at most 8 API requests, and no D1 mutations.
- On HTTP error, safely report `stage=` (e.g. `formats`), numeric
  Cloudflare error codes and a **fixed allowlisted category**.
  No arbitrary API error text, SQL, credentials, UUID or raw advisory
  records are displayed.
- Add regression assertions that all GLOB fragments stay within D1's
  50-byte cap and a mocked HTTP 400 returns sanitized stage and error code.
- Isolated GitHub Actions rerun:
  https://github.com/MaxYu725/Storm-Track/actions/runs/39047088236
  (Node syntax, all synthetic mock tests, keyset replay and SQLite
  indexing fixture passed). This CI **did not query Production D1**.

**User next action:** download the updated
`scripts/audit-web04b5-full-history.mjs` into the existing
`Desktop/Storm-WEB04B` folder (retain
`audit-web04b-d1-readonly.mjs` in the same folder), then rerun with
a D1 Read-only token. If HTTP 400 persists, share ONLY the safe
`stage=`, HTTP status, numeric CF codes and category string from the
new output, not the token or original response.

The HTTP 400 is **likely** the pattern-limit bug, but is not conclusively
attributed until the new Production read-only retry succeeds or exposes
an error category. No Worker/D1/index modifications or deployments.

## Verified starting point (2026-10-17)

- Public Production API probe: `legacy-no-cursor-contract`. First-page
  history is available, but cursor contract is not.
- User-provided /content/v2 export matches GitHub `backend/worker.js`
  except final LF. Traffic-serving Cloudflare Version 17 was reported at
  100%, but source-to-specific-version cryptographic mapping remains
  `NOT_VERIFIED`.
- Owner's real Production D1 read-only audit, against a database reported
  as `storm-track-db`: `advisories(id,storm_id,agency,issued_at,
  ingest_status)` required columns exist, 4 explicitly named indexes and
  2 SQLite autoindexes are present.
- Actual D1 plan summary for proposed stable ordering: base and cursor
  queries require temporary sorting; agency plan did **not** report temp
  sorting. The original audit only sampled 128 un-ordered advisory rows:
  0 malformed/noncanonical timestamps and 32 repeat occurrences of a
  timestamp across the entire sample, **not** necessarily within the
  same storm. Neither a full history audit nor the exact DB binding
  association has been established.

## WEB-04B-5 isolated code (not wired to live UI or Worker)

- `analysis/archive-advisory-keyset-proposal.js`: strict version-1
  positioning tokens, canonical UTC timestamp checks, canonical storm
  identity/agency/limit validation, stable `issued_at DESC, id DESC`
  SQL generation, bounded `limit+1`, page-level validation and
  `hasMore/nextCursor`. Preserves legacy fields in its *candidate*
  response. All SQL values are parameterized. No production API calls.
- `tests/web04b-keyset-proposal.test.cjs`: 7 synthetic scenarios
  including 0, 1, 199, 200, 201 and 748 advisories, 4 agencies,
  same-time ID tie-breakers, cross-storm cursor reuse, forged syntax,
  duplicates and backfill/new bulletin behavior.
- `scripts/web04b5-sqlite-index-fixture.py`: Python standard-library
  SQLite, in-memory only. Seeds 748 complete advisories for one storm,
  5,000 other-storm examples and 25 failed records. Tests every page
  and compares EXPLAIN plans with existing-index replicas and two
  *candidate indexes*. Does not connect to D1 and does not write files.

**Observed GitHub-runner isolated verification:**
https://github.com/MaxYu725/Storm-Track/actions/runs/39046152074

- All 7 cursor tests passed. 748 synthetic complete advisories replayed
  in 4 pages of 200+200+200+148, with no duplicate IDs.
- With synthetic existing-index replicas, base/agency/cursor SQLite plans
  all used a temporary sort.
- Adding only `(storm_id, ingest_status, issued_at DESC, id DESC)`
  removed the temp sort in those synthetic plans.
- Adding the optional second agency index
  `(storm_id, agency, ingest_status, issued_at DESC, id DESC)`
  made agency plans specifically use it, but was not necessary to
  eliminate synthetic temporary sorts.
- IMPORTANT: Synthetic SQLite EXPLAIN results cannot be interpreted as
  Cloudflare Production D1 query plans or latency measurements.
  In particular, Production's previous agency EXPLAIN summary already
  reported no temp sort.

**Cursor policy is not an authentication scheme.** The proposal uses
bounded, versioned, canonical Base64URL positioning tokens *without a
cryptographic signature*. Tokens are bound to the storm, agency, page
size and last row, but a user can manufacture a correctly scoped
cursor to seek within public archive data. That is acceptable ONLY if
reviewers confirm the public historical endpoint has no confidential
or access-controlled material. If integrity against deliberate
rewrites is required, use separately managed signing and rotation;
do not silently add credentials or secrets.

New-bulletin ingestion and backfills are not a transactional snapshot.
A new earlier-position bulletin may be omitted after the first
page; a backfilled older item may appear on later pages. The client
rejects overlap and mis-ordering but cannot prove immutable coverage
under concurrent changes.

## Additional full-history data-quality audit tool

- `scripts/audit-web04b5-full-history.mjs`: not yet executed against
  real Cloudflare. It sends 1 database metadata GET, 1 complete-row-count
  POST preflight and, if complete-row count is at most **50,000**,
  up to 6 additional fixed read-only SQL POSTs. Maximum **8** requests.
  D1's REST query endpoint uses POST even with D1 Read permission.
- Counts full-database canonical UTC format *shape*, invalid SQLite
  timestamps, invalid IDs, same-storm-and-time tie groups, cross-agency
  tie groups, per-agency totals and preserves 3 EXPLAIN plan details.
  No raw advisory values or IDs are returned or written to reports.
- If over 50,000 complete rows, the tool aborts after preflight
  (no full-table aggregations). Each call is bounded by a short
  timeout and response size. It is *read only*, but a grouped query
  may still consume nonzero D1 read capacity; run once, outside
  an ingestion incident, with the owner's permission.
- It uses a D1 **Read**-scoped Cloudflare API token and always keeps
  reports outside the checkout in an OS private temp directory.
  The source is explicitly whitelisted SQL and cannot accept custom
  SQL via CLI.
- `tests/web04b5-full-history.test.mjs` exercises mocked success,
  oversize preflight, DB identity mismatch, failed API, unexpected
  write indicators and inconsistent count behavior. No real network
  is used by GitHub CI.

**Mocked runner verification:**
https://github.com/MaxYu725/Storm-Track/actions/runs/39046417431

## Optional owner-run read-only aggregate check

Only after verifying that the `DB` binding on Worker `storm` points to
the D1 UUID being supplied, run locally (Node.js 22+) from PowerShell.
The account and DB identifiers are collected interactively, not stored
in Git. The token must never be pasted into chat or committed.

```powershell
$folder = Join-Path $HOME 'Desktop\Storm-WEB04B'
New-Item -ItemType Directory -Force -Path $folder | Out-Null
$base = 'https://raw.githubusercontent.com/MaxYu725/Storm-Track/feature/web-04b-advisory-cursor-readiness/scripts/'
Invoke-WebRequest ($base + 'audit-web04b-d1-readonly.mjs') -OutFile (Join-Path $folder 'audit-web04b-d1-readonly.mjs')
Invoke-WebRequest ($base + 'audit-web04b5-full-history.mjs') -OutFile (Join-Path $folder 'audit-web04b5-full-history.mjs')
$account = Read-Host 'Cloudflare account ID'
$db = Read-Host 'Verified D1 UUID bound as DB to Worker storm'
$secure = Read-Host 'Cloudflare D1 Read-only API token' -AsSecureString
try {
  $env:CLOUDFLARE_API_TOKEN = [System.Net.NetworkCredential]::new('', $secure).Password
  node (Join-Path $folder 'audit-web04b5-full-history.mjs') --account-id $account --database-id $db
} finally {
  Remove-Item Env:\CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
  Remove-Variable secure -ErrorAction SilentlyContinue
}
```
The second download is necessary because the standalone aggregate
tool imports the previous D1 identifier validator module. Share only
the redacted `full-history-aggregate.private.json` metadata summary.
It cannot prove that the D1 binding corresponds to the live Worker,
or that a consistent snapshot was observed during concurrent writes.

## WEB-04B-5 gate and decision

- **Preferred synthetic index candidate:** one composite index on
  `(storm_id, ingest_status, issued_at DESC, id DESC)`.
  Do not add either candidate to Production; decide from real D1
  index details, data distribution and separate staging measurements.
- Review whether old clients should continue accepting invalid/empty
  `agency` and clamped `limit`: the existing Worker silently ignores
  unknown agencies and clamps limits. Cursor-bearing requests must
  reject invalid input; do not break legacy queries unintentionally.
- Independently confirm per-version Worker source association and
  deployed D1 `DB` binding identity before a Worker rollout.
- Resolve the full-history data-quality audit, rollback/forward
  compatibility, 0/1/199/200/201/>200 boundary tests and load plan.
- All Worker/database/index changes must occur in a **separate reviewed
  deployment**. No Worker, production D1, R2 or Android changes
  are included in this PR, and Archive cursor UI must remain disabled.

PR #118 stays Draft until these release gates are satisfied.
