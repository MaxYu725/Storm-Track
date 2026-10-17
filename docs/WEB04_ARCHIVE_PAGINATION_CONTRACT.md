# WEB-04A — Archive coverage and safe pagination

## Scope and production-source constraint

The Storm Track web client currently requests `GET /api/history/storms?limit=100` and
`GET /api/history/storms/{id}/advisories?limit=200` from the independently deployed
production Worker at `https://storm.max-yu.workers.dev`.

**There is no authoritative production Worker source in this repository.** The
legacy `backend/worker.js` (v3.3.0-alpha.4) is *not* a deployment source. It
supports `limit` and `offset` for storm listings but only `limit` for advisory
listings. The live production API could not be queried during this review, so
this patch does **not** assume parity with that legacy file.

## Safe storm-list pagination

- Start with 100 storms at `?limit=100&offset=0`; retain the existing UI for small datasets.
- Show a manual **Load more** control *only if* the first response contains
  `pagination: {limit:100, offset:0}` and returned the full 100 records.
- For subsequent pages, require matching `pagination.limit` and
  `pagination.offset`, plus distinct, non-empty storm IDs. Reject mismatched,
  duplicated, or oversized pages rather than silently corrupting the timeline.
- Continue until a page returns fewer than 100 records.
- If exactly 100 records are returned without authoritative pagination metadata,
  mark the list **possibly incomplete**, rather than pretending it is complete.
- Cache loaded pages in the user's existing IndexedDB/localStorage history cache.
  The old cache structure remains readable.

The backend's offset paging uses a mutable recent-first ordering; if records
shift between requests, duplicate IDs are detected and the user can refresh
the list. This is a fail-closed compromise, **not a stable snapshot cursor**.
A future authoritative Worker revision should add a deterministic order with
unique tiebreaker, preferably cursor-based pagination.

## Historical advisory coverage

The first page still requests `limit=200`. If the response reaches the limit,
or the storm's existing `advisory_count` exceeds the returned list length,
the page explicitly warns that the timeline is incomplete. The UI no longer
implies that all past bulletins are available when only the latest 200 exist
in the response.

**WEB-04A does not implement advisory pagination** because the old backend
does not support it and the actual production contract is unverified.
Attempting `offset=200` blindly could reload the same page and produce
misleading replay results.

## Follow-up WEB-04B (blocked on authoritative API verification)

1. Identify and version the actually deployed production Worker source, without
   restoring historical Worker code to production.
2. Confirm whether `/api/history/storms/{id}/advisories` offers cursor or offset
   paging, including deterministic ordering and `hasMore`/next-cursor semantics.
3. If missing, implement paging in an authoritative Worker source via an
   independent, reviewed rollout. No migration or evidence deletion is necessary.
4. Only after that, stream the additional historical advisory pages into the
   Archive UI with stale-request guards and replay state preservation.
5. Confirm against a storm with more than 200 advisories that the earliest,
   middle, and most recent frames are all available and ordered as issued.

## Validation

- `node tests/archive-pagination.test.cjs`
- `node tests/service-worker-cache-policy.test.cjs`
- HK Signal Beta frontend validation workflow, including browser smoke test.
- Verify the PWA precaches `analysis/archive-pagination.js` at SW version `3.3.15`.
- Check no files under `android-app/`, no scoring changes, no Worker deployment
  or D1 writes.

This PR addresses UI completeness/disclosure; it does **not** claim to recover
historical advisories that are absent from the deployed API.
