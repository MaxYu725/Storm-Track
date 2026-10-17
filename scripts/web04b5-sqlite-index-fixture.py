#!/usr/bin/env python3
"""WEB-04B-5 offline synthetic SQLite index/planner fixture. Never touches D1."""
import datetime as dt
import json
import sqlite3

STORM = "STC-FIXTURE"
OTHER = "STC-OTHER"
AGENCIES = ("HKO", "CMA", "JMA", "CWA")
BASE_INDEXES = (
    "CREATE INDEX idx_advisories_storm_time ON advisories(storm_id, issued_at DESC)",
    "CREATE INDEX idx_advisories_agency_time ON advisories(agency, issued_at DESC)",
    "CREATE INDEX idx_advisories_status ON advisories(ingest_status)",
    "CREATE INDEX idx_advisories_hash ON advisories(source_hash)",
)
CANDIDATE_BASE = """CREATE INDEX idx_advisories_cursor_candidate
 ON advisories(storm_id, ingest_status, issued_at DESC, id DESC)"""
CANDIDATE_AGENCY = """CREATE INDEX idx_advisories_cursor_agency_candidate
 ON advisories(storm_id, agency, ingest_status, issued_at DESC, id DESC)"""
SQL = {
    "storm": """SELECT id, issued_at FROM advisories
 WHERE storm_id=? AND ingest_status='complete'
 ORDER BY issued_at DESC, id DESC LIMIT ?""",
    "agency": """SELECT id, issued_at FROM advisories
 WHERE storm_id=? AND agency=? AND ingest_status='complete'
 ORDER BY issued_at DESC, id DESC LIMIT ?""",
    "cursor": """SELECT id, issued_at FROM advisories
 WHERE storm_id=? AND ingest_status='complete'
 AND (issued_at < ? OR (issued_at = ? AND id < ?))
 ORDER BY issued_at DESC, id DESC LIMIT ?""",
}
EPOCH = dt.datetime(2026, 10, 16, 18, 0, tzinfo=dt.timezone.utc)


def timestamp(index):
    value = EPOCH - dt.timedelta(minutes=index // 3)
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def new_db(with_base_candidate=False, with_agency_candidate=False):
    db = sqlite3.connect(":memory:")
    db.execute("""CREATE TABLE advisories(
      id TEXT PRIMARY KEY, storm_id TEXT NOT NULL, agency TEXT NOT NULL,
      issued_at TEXT NOT NULL, ingest_status TEXT NOT NULL,
      source_hash TEXT NOT NULL)""")
    rows = []
    for i in range(748):
        rows.append((f"A{i:06d}", STORM, AGENCIES[i % 4], timestamp(i),
                     "complete", f"sha-primary-{i}"))
    for i in range(5000):
        rows.append((f"B{i:06d}", OTHER, AGENCIES[i % 4], timestamp(i // 2),
                     "complete" if i % 11 else "failed", f"sha-other-{i}"))
    for i in range(25):
        rows.append((f"F{i:06d}", STORM, "HKO", timestamp(i), "failed", f"sha-failed-{i}"))
    db.executemany("INSERT INTO advisories VALUES (?,?,?,?,?,?)", rows)
    for ddl in BASE_INDEXES:
        db.execute(ddl)
    if with_base_candidate:
        db.execute(CANDIDATE_BASE)
    if with_agency_candidate:
        db.execute(CANDIDATE_AGENCY)
    db.execute("ANALYZE")
    return db


def query_args():
    anchor = timestamp(100)
    return {
        "storm": (STORM, 201),
        "agency": (STORM, "JMA", 201),
        "cursor": (STORM, anchor, anchor, "A000100", 201),
    }


def plan_summary(db):
    output = {}
    for name, sql in SQL.items():
        records = db.execute("EXPLAIN QUERY PLAN " + sql, query_args()[name]).fetchall()
        details = [str(row[3]) for row in records]
        output[name] = {
            "details": details,
            "tempSort": any("USE TEMP B-TREE" in item for item in details),
            "indexNames": sorted({
                candidate for detail in details
                for candidate in ("idx_advisories_cursor_candidate",
                                  "idx_advisories_cursor_agency_candidate",
                                  "idx_advisories_storm_time",
                                  "idx_advisories_agency_time",
                                  "idx_advisories_status")
                if candidate in detail
            })
        }
    return output


def full_replay(db):
    cursor = None
    seen = set()
    pages = 0
    output = []
    while True:
        sql = SQL["storm"] if cursor is None else SQL["cursor"]
        params = (STORM, 201) if cursor is None else (
            STORM, cursor[0], cursor[0], cursor[1], 201
        )
        fetched = db.execute(sql, params).fetchall()
        assert len(fetched) <= 201
        selected = fetched[:200]
        for item in selected:
            assert item[0] not in seen, "Cross-page duplicate"
            if output:
                prev = output[-1]
                assert prev[1] > item[1] or (prev[1] == item[1] and prev[0] > item[0])
            seen.add(item[0])
            output.append(item)
        pages += 1
        assert pages <= 10, "Unexpected cursor cycle"
        if len(fetched) <= 200:
            break
        cursor = (selected[-1][1], selected[-1][0])
    assert len(output) == 748, "Synthetic replay missing advisories"
    assert pages == 4, "Expected four pages of synthetic 748 advisory replay"
    return {"records": len(output), "pages": pages, "noDuplicateIds": True,
            "tieTimeOrderingVerified": True}


def main():
    modes = (
        ("existing", False, False),
        ("candidate_base", True, False),
        ("candidate_base_plus_agency", True, True),
    )
    reports = {}
    for name, base, agency in modes:
        db = new_db(base, agency)
        reports[name] = {"plans": plan_summary(db), "replay": full_replay(db)}
        db.close()
    print(json.dumps({
        "contract": "storm-web04b5-offline-index-fixture/v1",
        "dataset": "synthetic-only",
        "engine": "Python sqlite3 in-memory SQLite, not Cloudflare D1",
        "stormCompleteAdvisories": 748,
        "results": reports,
        "noProductionAccess": True,
        "note": "Plans are indicative only; production D1 index choice still gated on separate review.",
    }, indent=2))


if __name__ == "__main__":
    main()
