"""Owner-only PoC notes, independent of public Claims and immutable research history."""

import json
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import DecisionValidationRecord, ResearchRecord
from .decision_constraints import current_claims
from .decision_validation_review import review_validation
from .engagement import EngagementService, revalidate_research
from .schemas import (
    DecisionContext,
    DecisionValidationSave,
    DecisionValidationView,
    KnowledgeSnapshot,
)


def owned_research(session: Session, research_id: str, user_id: str) -> ResearchRecord:
    row = session.scalar(
        select(ResearchRecord).where(
            ResearchRecord.id == research_id, ResearchRecord.user_id == user_id
        )
    )
    if row is None:
        raise HTTPException(404, "Research not found.")
    return row


def validation_view(
    session: Session, research_id: str, user_id: str, snapshot: KnowledgeSnapshot | None = None
) -> DecisionValidationView:
    research = owned_research(session, research_id, user_id)
    decision = json.loads(research.decision_json or "null") or {}
    candidate_ids = [
        candidate["entityId"]
        for candidate in decision.get("candidates", [])
        if candidate.get("eligibility") != "excluded"
    ][:20]
    candidate_ids = candidate_ids or [None]
    row = session.get(DecisionValidationRecord, research_id)
    if row is None:
        view = DecisionValidationView(research_id=research_id)
    else:
        view = DecisionValidationView(
            research_id=research_id,
            revision=row.revision,
            items=json.loads(row.items_json),
            updated_at=row.updated_at.replace(tzinfo=UTC),
        )
    context = json.loads(research.decision_context_json or "null") or {}
    eligible_ids = [
        candidate["entityId"]
        for candidate in decision.get("candidates", [])
        if candidate.get("eligibility") == "eligible"
    ]
    if snapshot is not None:
        refreshed = revalidate_research(EngagementService._research_view(research), snapshot)
        eligible_ids = (
            [
                row.entity_id
                for row in refreshed.decision.candidates
                if row.eligibility == "eligible"
            ]
            if refreshed.decision
            else []
        )
        if context and eligible_ids:
            current_decision = EngagementService._build_decision(
                DecisionContext.model_validate(context),
                [
                    claim
                    for claim in current_claims(snapshot.claims, snapshot)
                    if claim.entity_id in eligible_ids
                ],
                eligible_ids,
                snapshot,
                "zh",
            )
            current_eligible = {
                row.entity_id
                for row in current_decision.candidates
                if row.eligibility == "eligible"
            }
            eligible_ids = [key for key in eligible_ids if key in current_eligible]
    view.review = review_validation(
        view.items, candidate_ids, view.revision, context.get("priority", "balanced"), eligible_ids
    )
    return view


def save_validation(
    session: Session,
    research_id: str,
    user_id: str,
    payload: DecisionValidationSave,
    snapshot: KnowledgeSnapshot | None = None,
) -> DecisionValidationView:
    research = owned_research(session, research_id, user_id)
    decision = json.loads(research.decision_json or "null") or {}
    candidate_ids = {row["entityId"] for row in decision.get("candidates", [])}
    context = json.loads(research.decision_context_json or "null") or {}
    candidate_ids.update(context.get("candidateEntityIds", []))
    candidate_ids.update(
        citation.get("claim", {}).get("entityId")
        for citation in json.loads(research.citations_json)
    )
    if any(
        item.candidate_id is not None and item.candidate_id not in candidate_ids
        for item in payload.items
    ):
        raise HTTPException(422, "Validation candidate must belong to this decision.")
    encoded = json.dumps(
        [item.model_dump(by_alias=True) for item in payload.items], ensure_ascii=False
    )
    now = datetime.now(UTC)
    if payload.expected_revision == 0:
        session.add(
            DecisionValidationRecord(
                research_id=research_id,
                user_id=user_id,
                revision=1,
                items_json=encoded,
                updated_at=now,
            )
        )
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise HTTPException(
                409, "Validation was changed elsewhere. Reload before saving."
            ) from None
    else:
        result = session.execute(
            update(DecisionValidationRecord)
            .where(
                DecisionValidationRecord.research_id == research_id,
                DecisionValidationRecord.user_id == user_id,
                DecisionValidationRecord.revision == payload.expected_revision,
            )
            .values(revision=payload.expected_revision + 1, items_json=encoded, updated_at=now)
        )
        if result.rowcount != 1:
            session.rollback()
            raise HTTPException(409, "Validation was changed elsewhere. Reload before saving.")
        session.commit()
    return validation_view(session, research_id, user_id, snapshot)
