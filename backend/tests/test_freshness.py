import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.database import Database, EntryRequestRecord, ReviewJobRecord
from app.freshness import knowledge_freshness

NOW = datetime(2026, 11, 23, 12, 0, tzinfo=UTC)


def _row(
    row_id: str, predicate: str, status: str, created_hours_ago: float, reviewed_after_hours=None
):
    created = NOW - timedelta(hours=created_hours_ago)
    claim = {
        "id": f"claim-{row_id}",
        "text": {"zh": "事实", "en": "Fact"},
        "confidence": "unverified",
        "sourceIds": ["evidence-x"],
        "updatedAt": "2026-11-23",
        "subject": "CrewAI",
        "predicate": predicate,
        "objectOrValue": "LangGraph",
    }
    return ReviewJobRecord(
        id=row_id,
        entity_id="e-crewai",
        claim_id=claim["id"],
        claim_json=json.dumps(claim),
        evidence_ids_json="[]",
        evidence_json="[]",
        conflict_ids_json="[]",
        status=status,
        created_at=created,
        reviewed_at=(
            created + timedelta(hours=reviewed_after_hours)
            if reviewed_after_hours is not None
            else None
        ),
        version=1,
    )


def _freshness(tmp_path: Path, rows):
    database = Database(f"sqlite:///{(tmp_path / 'freshness.db').as_posix()}")
    database.create_all()
    with database.session() as session:
        session.add_all(rows)
        session.commit()
        return knowledge_freshness(session, now=NOW)


def test_relation_and_fact_candidates_use_separate_budgets(tmp_path: Path):
    result = _freshness(
        tmp_path,
        [
            _row("rel-fresh", "competes-with", "pending", 23),
            _row("rel-overdue", "competes-with", "pending", 25),
            _row("fact-fresh", "context-window", "needs-more-evidence", 71),
            _row("fact-overdue", "context-window", "pending", 73),
        ],
    )
    tracks = {track.track: track for track in result.tracks}

    assert result.status == "overdue"
    assert result.overdue_count == 2
    assert tracks["relation"].budget_hours == 24
    assert (tracks["relation"].open_count, tracks["relation"].overdue_count) == (2, 1)
    assert tracks["relation"].oldest_open_age_hours == 25.0
    assert tracks["fact"].budget_hours == 72
    assert (tracks["fact"].open_count, tracks["fact"].overdue_count) == (2, 1)
    assert tracks["fact"].oldest_open_age_hours == 73.0


def test_recent_decisions_count_late_reviews_and_ignore_older_history(tmp_path: Path):
    result = _freshness(
        tmp_path,
        [
            _row("rel-on-time", "uses", "approved", 30, reviewed_after_hours=20),
            _row("rel-late", "uses", "rejected", 60, reviewed_after_hours=30),
            _row("fact-late", "input-price", "approved", 100, reviewed_after_hours=80),
            _row("fact-old", "input-price", "approved", 24 * 30, reviewed_after_hours=200),
        ],
    )
    tracks = {track.track: track for track in result.tracks}

    assert result.status == "on-track"
    assert result.overdue_count == 0
    assert (
        tracks["relation"].recent_decided_count,
        tracks["relation"].recent_decided_late_count,
    ) == (2, 1)
    assert (tracks["fact"].recent_decided_count, tracks["fact"].recent_decided_late_count) == (1, 1)
    assert tracks["fact"].open_count == 0
    assert tracks["fact"].oldest_open_at is None


def test_empty_queue_is_on_track(tmp_path: Path):
    result = _freshness(tmp_path, [])

    assert result.status == "on-track"
    assert [track.track for track in result.tracks] == ["relation", "fact", "verification"]
    assert all(track.open_count == 0 for track in result.tracks)


def _request(request_id, status, age_hours, *, verification=True, reviewed_after_hours=None):
    from app.knowledge_checks import VERIFY_REASON_PREFIX

    created = NOW - timedelta(hours=age_hours)
    return EntryRequestRecord(
        id=request_id,
        name="核验：示例",
        entity_type="model",
        source_url="https://example.com/",
        reason=(VERIFY_REASON_PREFIX if verification else "收录这个新模型：") + "示例内容。",
        status=status,
        created_at=created,
        reviewed_at=(
            created + timedelta(hours=reviewed_after_hours)
            if reviewed_after_hours is not None
            else None
        ),
        version=1,
    )


def test_verification_requests_have_their_own_three_day_track(tmp_path: Path):
    result = _freshness(
        tmp_path,
        [
            _request("v-fresh", "pending", 10),
            _request("v-overdue", "in-review", 80),
            _request("v-late", "resolved", 100, reviewed_after_hours=90),
            # An ordinary catalog suggestion is not a verification request.
            _request("other", "pending", 500, verification=False),
        ],
    )
    track = {item.track: item for item in result.tracks}["verification"]
    assert track.budget_hours == 72
    assert (track.open_count, track.overdue_count) == (2, 1)
    assert track.oldest_open_age_hours == 80.0
    assert (track.recent_decided_count, track.recent_decided_late_count) == (1, 1)
    assert result.status == "overdue" and result.overdue_count == 1
