"""Offline comparison of grounded-relation auto-approval against human review.

The switch AI_RADAR_AUTO_APPROVE_GROUNDED_RELATIONS stays off until a batch of
human decisions shows the rule would not have approved anything a reviewer
rejected. This report replays every human-decided relation candidate through
the live rule and reports agreement. It never changes a review decision.
"""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from .application_rules import RELATION_CLAIM_PREDICATES
from .database import AuditLogRecord, DocumentSnapshotRecord, ReviewJobRecord, SourceRecord
from .schemas import AutoApprovalShadowItem, AutoApprovalShadowReport, Claim

AUTOMATION_REVIEWER = "automation@ai-radar.local"


def _candidate_snapshots(session: Session) -> dict[str, str]:
    """Map candidate id -> snapshot id from extraction audit records."""
    mapping: dict[str, str] = {}
    for row in session.scalars(
        select(AuditLogRecord).where(
            AuditLogRecord.action == "extraction.run",
            AuditLogRecord.target_type == "document_snapshot",
        )
    ):
        try:
            detail = json.loads(row.detail_json or "{}")
        except ValueError:
            continue
        for candidate_id in detail.get("candidateIds") or []:
            mapping.setdefault(str(candidate_id), row.target_id)
    return mapping


def auto_approval_shadow_report(services, session: Session) -> AutoApprovalShadowReport:
    snapshots_by_candidate = _candidate_snapshots(session)
    rows = session.scalars(
        select(ReviewJobRecord)
        .where(
            ReviewJobRecord.status.in_(("approved", "rejected")),
            ReviewJobRecord.reviewed_by.is_not(None),
            ReviewJobRecord.reviewed_by != AUTOMATION_REVIEWER,
        )
        .order_by(ReviewJobRecord.reviewed_at.desc())
    ).all()
    items: list[AutoApprovalShadowItem] = []
    untraceable = 0
    for row in rows:
        try:
            claim = Claim.model_validate_json(row.claim_json)
        except ValueError:
            continue
        if claim.predicate not in RELATION_CLAIM_PREDICATES:
            continue
        snapshot_id = snapshots_by_candidate.get(row.id)
        snapshot = session.get(DocumentSnapshotRecord, snapshot_id) if snapshot_id else None
        source = session.get(SourceRecord, snapshot.source_id) if snapshot else None
        if snapshot is None or source is None:
            # Extracted before candidate ids were recorded; cannot replay faithfully.
            untraceable += 1
            continue
        would_approve = services.grounded_relation_rule_passes(session, row, source, snapshot)
        if would_approve and row.status == "rejected":
            outcome = "false-approval"
        elif would_approve:
            outcome = "agreed-approval"
        elif row.status == "approved":
            outcome = "left-for-human"
        else:
            outcome = "agreed-rejection"
        items.append(
            AutoApprovalShadowItem(
                review_id=row.id,
                subject=claim.subject,
                predicate=claim.predicate,
                object_or_value=claim.object_or_value,
                human_decision=row.status,
                reason_category=row.reason_category,
                rule_would_approve=would_approve,
                outcome=outcome,
            )
        )
    count = {
        key: sum(item.outcome == key for item in items)
        for key in ("agreed-approval", "false-approval", "left-for-human", "agreed-rejection")
    }
    return AutoApprovalShadowReport(
        evaluated_count=len(items),
        untraceable_count=untraceable,
        agreed_approval_count=count["agreed-approval"],
        false_approval_count=count["false-approval"],
        left_for_human_count=count["left-for-human"],
        agreed_rejection_count=count["agreed-rejection"],
        ready_to_enable=bool(items)
        and count["false-approval"] == 0
        and count["agreed-approval"] > 0,
        items=items,
    )
