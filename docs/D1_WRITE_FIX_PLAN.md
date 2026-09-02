# D1 write amplification remediation

Issue: #87  
Working branch: `fix/d1-write-amplification-20260901`

## Production source status

The currently deployed Cloudflare Worker source (`Storm Track Worker v3.3.0-alpha.2`) has been recovered directly from production. It is now the only source allowed for this remediation; old Git history must not be used as a substitute.

Because `main` did not previously contain the authoritative production Worker, the first implementation artifact on this branch is a deterministic patcher:

- `scripts/patch-production-worker-d1-write-amplification.mjs`

It accepts the recovered `worker.js` and produces `worker.d1-fixed.js` without requiring a D1 schema migration.

## Confirmed root causes

### 1. Scheduled collection runs the expensive diagnostic probe

`collectAllAgencies()` calls `probeDatabase()` before every collection. `probeDatabase()` executes six table-wide counts, including:

```sql
SELECT COUNT(*) AS count FROM track_points
```

The production D1 metrics showed this query 77 times in 24 hours and about 2.13M rows read. That count is consistent with the scheduled collector invoking the full diagnostic probe repeatedly.

Remediation: scheduled collection now performs only a lightweight table-existence readiness check. `/probe/database` keeps the full counts for explicit diagnostics.

### 2. Raw-document hash is too coarse to decide whether child rows changed

`ingestStormAdvisory()` currently treats an advisory as unchanged only when the raw source SHA-256 is identical. When the hash differs for the same `(storm_id, agency, issued_at)`, it does this:

```text
DELETE wind_radii
DELETE track_points
INSERT all track_points
INSERT all wind_radii
```

This is the direct source of the observed write amplification.

CWA is especially vulnerable because every parsed cyclone currently carries the complete `W-C0034-005` response as `rawText`. A change elsewhere in that shared dataset can therefore change the raw hash for a cyclone whose normalized advisory points did not change.

Remediation: preserve the raw hash and R2 provenance, but when the raw hash changes on an already-complete advisory, compare the normalized incoming points/radii with the persisted child rows. If they are identical, return `duplicate` and perform zero child-row writes. Full child replacement remains available only when the normalized advisory content genuinely changed.

This deliberately avoids a schema migration or a risky per-point diff in the first hotfix.

### 3. Storm and alias UPSERTs write on every poll

`ensureStormRow()` always executes `INSERT ... ON CONFLICT DO UPDATE`, including `updated_at`, even when the resulting row is identical. `storm_aliases` behaves similarly.

Production metrics are consistent with this: `storms` and `storm_aliases` were also producing recurring rows-written usage.

Remediation: compare the existing row with the desired state first. Execute the UPSERT only when an actual field would change.

## Safety properties

The hotfix does not:

- change HKO/CMA/JMA/CWA parsing or agency independence;
- change advisory IDs, track-point IDs, or history API routes;
- rewrite completed historical advisories in bulk;
- change R2 content-addressed raw-object storage;
- add or alter D1 tables/indexes;
- change HK Signal V1/V2, Consensus Track, evaluator, or prospective-recorder semantics.

A genuinely changed advisory with the same issued time is still allowed to replace its child rows. The optimization only suppresses writes when the persisted normalized advisory is identical.

## Expected effect

The 24-hour D1 sample before the fix was approximately:

- `wind_radii` INSERT: 37.14K rows written
- `track_points` INSERT: 25.71K rows written
- `wind_radii` DELETE: 4.88K rows written
- total D1 rows written: ~72K

The first three paths account for the dominant write load. Under similar storm activity, the hotfix target is at least an 80% reduction in repeated child-row writes. The exact reduction must be verified from Cloudflare D1 metrics after deployment.

## Validation plan

Before deployment:

1. Apply the patcher to the recovered production `worker.js`.
2. Verify the output version is `3.3.0-alpha.3`.
3. Syntax-check the generated Worker.
4. Review the diff; only the D1 no-op/readiness changes above are expected.
5. Confirm no secret values are present in the versioned source.

After deployment:

1. Trigger one collection with current upstream data.
2. Trigger the same collection again before a new official cycle; `track_points` / `wind_radii` child writes should be zero for unchanged advisories.
3. Confirm a genuinely new official advisory still appears in Archive and current frontend APIs.
4. Check D1 metrics after several cron cycles, then again after 24 hours.
5. Keep issue #87 open until the 24-hour metric confirms the reduction.
