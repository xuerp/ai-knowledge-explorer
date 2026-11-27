"""Review-latency service levels for the continuously updated knowledge base.

Two published commitments are measured from the moment a candidate enters the
review queue:

- relation candidates (canonical graph predicates) should be decided within 24 hours;
- every other fact should be decided within 3 days.

The clock starts at queue entry because candidates do not persist the snapshot
they were extracted from; extraction backlog is reported separately by the
operations queues.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .application_rules import RELATION_CLAIM_PREDICATES
from .database import EntryRequestRecord, ReviewJobRecord
from .knowledge_checks import VERIFY_REASON_PREFIX
from .schemas import Claim, FreshnessTrack, KnowledgeFreshness

OPEN_STATUSES = ("pending", "needs-more-evidence")
DECIDED_STATUSES = ("approved", "rejected")
TRACK_BUDGET_HOURS: dict[Literal["relation", "fact", "verification"], int] = {
    "relation": 24,
    "fact": 72,
    # A user asked to verify a "model knowledge" line; same budget as other facts.
    "verification": 72,
}
VERIFY_OPEN_STATUSES = ("pending", "in-review")
VERIFY_DECIDED_STATUSES = ("resolved", "rejected")
RECENT_WINDOW_DAYS = 7


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _track(row: ReviewJobRecord) -> Literal["relation", "fact"]:
    try:
        predicate = Claim.model_validate_json(row.claim_json).predicate
    except ValueError:
        return "fact"
    return "relation" if predicate in RELATION_CLAIM_PREDICATES else "fact"


def knowledge_freshness(session: Session, *, now: datetime | None = None) -> KnowledgeFreshness:
    """Summarize open-queue age and recent decision latency against both budgets."""
    current = _utc(now or datetime.now(UTC))
    recent_since = current - timedelta(days=RECENT_WINDOW_DAYS)
    rows = session.scalars(
        select(ReviewJobRecord).where(
            or_(
                ReviewJobRecord.status.in_(OPEN_STATUSES),
                (ReviewJobRecord.status.in_(DECIDED_STATUSES))
                & (ReviewJobRecord.reviewed_at >= recent_since),
            )
        )
    ).all()
    tracks: dict[str, dict] = {
        name: {
            "open": 0,
            "overdue": 0,
            "oldest": None,
            "decided": 0,
            "decided_late": 0,
        }
        for name in TRACK_BUDGET_HOURS
    }
    requests = session.scalars(
        select(EntryRequestRecord).where(
            EntryRequestRecord.reason.startswith(VERIFY_REASON_PREFIX, autoescape=True),
            or_(
                EntryRequestRecord.status.in_(VERIFY_OPEN_STATUSES),
                (EntryRequestRecord.status.in_(VERIFY_DECIDED_STATUSES))
                & (EntryRequestRecord.reviewed_at >= recent_since),
            ),
        )
    ).all()
    for row in requests:
        budget = timedelta(hours=TRACK_BUDGET_HOURS["verification"])
        bucket = tracks["verification"]
        created = _utc(row.created_at)
        if row.status in VERIFY_OPEN_STATUSES:
            bucket["open"] += 1
            if current - created > budget:
                bucket["overdue"] += 1
            if bucket["oldest"] is None or created < bucket["oldest"]:
                bucket["oldest"] = created
        elif row.reviewed_at is not None:
            bucket["decided"] += 1
            if _utc(row.reviewed_at) - created > budget:
                bucket["decided_late"] += 1
    for row in rows:
        name = _track(row)
        budget = timedelta(hours=TRACK_BUDGET_HOURS[name])
        bucket = tracks[name]
        created = _utc(row.created_at)
        if row.status in OPEN_STATUSES:
            bucket["open"] += 1
            if current - created > budget:
                bucket["overdue"] += 1
            if bucket["oldest"] is None or created < bucket["oldest"]:
                bucket["oldest"] = created
        elif row.reviewed_at is not None:
            bucket["decided"] += 1
            if _utc(row.reviewed_at) - created > budget:
                bucket["decided_late"] += 1
    views = [
        FreshnessTrack(
            track=name,
            budget_hours=TRACK_BUDGET_HOURS[name],
            open_count=bucket["open"],
            overdue_count=bucket["overdue"],
            oldest_open_at=bucket["oldest"],
            oldest_open_age_hours=(
                round((current - bucket["oldest"]).total_seconds() / 3600, 1)
                if bucket["oldest"]
                else None
            ),
            recent_decided_count=bucket["decided"],
            recent_decided_late_count=bucket["decided_late"],
        )
        for name, bucket in tracks.items()
    ]
    overdue = sum(view.overdue_count for view in views)
    return KnowledgeFreshness(
        generated_at=current,
        status="overdue" if overdue else "on-track",
        overdue_count=overdue,
        recent_window_days=RECENT_WINDOW_DAYS,
        tracks=views,
    )
