import hashlib
import json
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select, update

from ..application_rules import review_decision_note, review_item_is_deterministically_invalid
from ..database import (
    PublicationRecordRow,
    ReviewJobRecord,
)
from ..entity_linkage import audit_claim_entity_links, classify_unlinked_claim
from ..quality import (
    claim_semantic_fingerprint,
)
from ..rag import (
    LexicalRagRetriever,
)
from ..repository import OPEN_REVIEW_STATUSES
from ..review_revision import create_revision
from ..schemas import (
    CandidateAssessment,
    CandidateCreate,
    Claim,
    ClaimEntityAuditReport,
    ClaimEntityRepairItem,
    ClaimEntityRepairReport,
    ClaimEntityRepairRequest,
    ClaimEntityResolutionRequest,
    ClaimEntityResolutionResult,
    PublicationRecord,
    RelationClaimAuditReport,
    RelationClaimRepairItem,
    RelationClaimRepairReport,
    RelationClaimRepairRequest,
    ReviewBatchApproval,
    ReviewDecision,
    ReviewInventoryReport,
    ReviewLifecycleDecision,
    ReviewPublicationStateRequest,
    ReviewQueueItem,
    ReviewRevisionRequest,
)
from .dependencies import AdminDependency, ReviewerDependency, ServicesDependency, SessionDependency

router = APIRouter()


@router.post(
    "/api/v2/admin/review-candidates/assess",
    response_model=CandidateAssessment,
)
def assess_review_candidate(
    services: ServicesDependency,
    payload: CandidateCreate,
    _: ReviewerDependency,
    session: SessionDependency,
) -> CandidateAssessment:
    return services.quality_gate.assess(payload, services.get_catalog_snapshot(session))


@router.post(
    "/api/v2/admin/review-candidates",
    response_model=ReviewQueueItem,
    status_code=status.HTTP_201_CREATED,
)
def submit_review_candidate(
    services: ServicesDependency,
    payload: CandidateCreate,
    principal: ReviewerDependency,
    session: SessionDependency,
) -> ReviewQueueItem:
    evidence_ids = {item.id for item in payload.evidence}
    if not set(payload.claim.source_ids).issubset(evidence_ids):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Every claim source id must be included in the submitted evidence.",
        )
    assessment = services.quality_gate.assess(payload, services.get_catalog_snapshot(session))
    if assessment.resolved_entity_id and not payload.entity_id:
        payload = payload.model_copy(update={"entity_id": assessment.resolved_entity_id})
    reason = None
    if assessment.conflicting_claim_ids:
        reason = "Structured conflict detected against: " + ", ".join(
            assessment.conflicting_claim_ids
        )
    elif assessment.resolution == "ambiguous":
        reason = "Entity resolution is ambiguous and requires human confirmation."
    row = services.ingestion.submit_candidate(
        session,
        payload,
        queue_status=assessment.queue_status,
        conflict_claim_ids=assessment.conflicting_claim_ids,
        review_reason=reason,
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A review candidate with this id already exists.",
        )
    services.audit.record(
        session,
        principal,
        "review.candidate.create",
        "review_job",
        row.id,
        {"claimId": row.claim_id},
    )
    session.commit()
    return services.repository.to_queue_item(row)


@router.post("/api/v2/admin/review-queue/{review_id}/revise", response_model=ReviewQueueItem)
def revise_review_candidate(
    services: ServicesDependency,
    review_id: str,
    payload: ReviewRevisionRequest,
    principal: ReviewerDependency,
    session: SessionDependency,
) -> ReviewQueueItem:
    return create_revision(
        review_id,
        payload,
        principal,
        session,
        services.repository,
        services.quality_gate,
        services.audit,
        services.get_catalog_snapshot(session),
    )


@router.get("/api/v2/admin/review-queue", response_model=list[ReviewQueueItem])
def review_queue(
    services: ServicesDependency,
    response: Response,
    _: ReviewerDependency,
    session: SessionDependency,
    scope: Annotated[Literal["open", "history", "all"], Query()] = "all",
    limit: Annotated[int, Query(ge=1, le=500)] = 500,
) -> list[ReviewQueueItem]:
    response.headers["Cache-Control"] = "no-store"
    return services.repository.queue(session, scope=scope, limit=limit)


@router.get(
    "/api/v2/admin/review-queue-inventory",
    response_model=ReviewInventoryReport,
)
def review_queue_inventory(
    services: ServicesDependency,
    _: ReviewerDependency,
    session: SessionDependency,
) -> ReviewInventoryReport:
    return services.review_queue_inventory(_, session)


@router.get(
    "/api/v2/admin/claim-entity-audit",
    response_model=ClaimEntityAuditReport,
)
def claim_entity_audit(
    services: ServicesDependency,
    response: Response,
    _: ReviewerDependency,
    session: SessionDependency,
) -> ClaimEntityAuditReport:
    response.headers["Cache-Control"] = "no-store"
    report = audit_claim_entity_links(services.get_catalog_snapshot(session))
    claim_ids = [item.claim_id for item in report.items]
    rows = session.scalars(
        select(ReviewJobRecord)
        .where(
            ReviewJobRecord.claim_id.in_(claim_ids),
            ReviewJobRecord.status == "approved",
            ReviewJobRecord.lifecycle_status == "current",
            ReviewJobRecord.publication_action != "merged-evidence",
        )
        .order_by(ReviewJobRecord.created_at.desc(), ReviewJobRecord.id.desc())
    ).all()
    row_by_claim_id: dict[str, ReviewJobRecord] = {}
    for row in rows:
        row_by_claim_id.setdefault(row.claim_id, row)
    return report.model_copy(
        update={
            "items": [
                item.model_copy(
                    update={
                        "review_job_id": row_by_claim_id[item.claim_id].id,
                        "version": row_by_claim_id[item.claim_id].version,
                    }
                )
                if item.claim_id in row_by_claim_id
                else item
                for item in report.items
            ]
        }
    )


@router.get(
    "/api/v2/admin/relation-claim-audit",
    response_model=RelationClaimAuditReport,
)
def relation_claim_audit(
    services: ServicesDependency,
    response: Response,
    _: ReviewerDependency,
    session: SessionDependency,
) -> RelationClaimAuditReport:
    response.headers["Cache-Control"] = "no-store"
    snapshot = services.get_catalog_snapshot(session)
    items = [
        services.assess_historical_relation_claim(session, row, snapshot)[0]
        for row in services.approved_relation_rows(session)
    ]
    return RelationClaimAuditReport(
        generated_at=datetime.now(UTC),
        total_relation_claims=len(items),
        linked_count=sum(item.status == "linked" for item in items),
        repairable_count=sum(item.status == "repairable" for item in items),
        manual_review_count=sum(item.status in {"review-required", "invalid"} for item in items),
        items=items,
    )


@router.post(
    "/api/v2/admin/relation-claim-repair",
    response_model=RelationClaimRepairReport,
)
def repair_historical_relations(
    services: ServicesDependency,
    payload: RelationClaimRepairRequest,
    principal: AdminDependency,
    session: SessionDependency,
) -> RelationClaimRepairReport:
    if payload.mode == "apply" and not payload.claim_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Apply mode requires an explicit list of at most 50 relation claim ids.",
        )

    snapshot = services.get_catalog_snapshot(session)
    rows = services.approved_relation_rows(session, payload.claim_ids or None)
    items: list[RelationClaimRepairItem] = []
    repairable_count = 0
    repaired_count = 0
    for row in rows:
        assessment, proposed = services.assess_historical_relation_claim(session, row, snapshot)
        if assessment.status != "repairable" or proposed is None:
            items.append(
                RelationClaimRepairItem(
                    review_job_id=row.id,
                    claim_id=row.claim_id,
                    relation_id=assessment.relation_id,
                    status="skipped",
                    reason=assessment.reason,
                )
            )
            continue

        repairable_count += 1
        item_status: Literal["repairable", "repaired"] = "repairable"
        if payload.mode == "apply":
            services.repository.upsert_relation(session, proposed)
            services.audit.record(
                session,
                principal,
                "relation.claim.repair",
                "review_job",
                row.id,
                {
                    "claimId": row.claim_id,
                    "relationId": proposed.id,
                    "fromId": proposed.from_id,
                    "toId": proposed.to_id,
                    "kind": proposed.kind,
                    "method": "deterministic-history-repair",
                },
            )
            repaired_count += 1
            item_status = "repaired"
        items.append(
            RelationClaimRepairItem(
                review_job_id=row.id,
                claim_id=row.claim_id,
                relation_id=proposed.id,
                status=item_status,
                reason=assessment.reason,
            )
        )

    if payload.mode == "apply":
        session.commit()
    return RelationClaimRepairReport(
        generated_at=datetime.now(UTC),
        mode=payload.mode,
        total=len(items),
        repairable_count=repairable_count,
        repaired_count=repaired_count,
        items=items,
    )


@router.post(
    "/api/v2/admin/claim-entity-repair",
    response_model=ClaimEntityRepairReport,
)
def repair_claim_entities(
    services: ServicesDependency,
    payload: ClaimEntityRepairRequest,
    principal: AdminDependency,
    session: SessionDependency,
) -> ClaimEntityRepairReport:
    if payload.mode == "apply" and not payload.claim_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Apply mode requires an explicit list of at most 50 claim ids.",
        )

    snapshot = services.get_catalog_snapshot(session)
    entity_ids = {entity.id for entity in snapshot.entities}
    statement = select(ReviewJobRecord).where(
        ReviewJobRecord.status == "approved",
        ReviewJobRecord.publication_action != "merged-evidence",
    )
    if payload.claim_ids:
        statement = statement.where(ReviewJobRecord.claim_id.in_(payload.claim_ids))
    rows = session.scalars(
        statement.order_by(ReviewJobRecord.created_at, ReviewJobRecord.id).limit(500)
    ).all()
    explicit_selection = bool(payload.claim_ids)
    items: list[ClaimEntityRepairItem] = []
    repairable_count = 0
    repaired_count = 0
    for row in rows:
        if row.entity_id in entity_ids:
            if explicit_selection:
                items.append(
                    ClaimEntityRepairItem(
                        review_job_id=row.id,
                        claim_id=row.claim_id,
                        previous_entity_id=row.entity_id,
                        proposed_entity_id=row.entity_id,
                        status="skipped",
                        reason="该 Claim 已关联合法实体，无需修复。",
                    )
                )
            continue
        try:
            claim = Claim.model_validate_json(row.claim_json)
        except (ValueError, TypeError, json.JSONDecodeError):
            items.append(
                ClaimEntityRepairItem(
                    review_job_id=row.id,
                    claim_id=row.claim_id,
                    previous_entity_id=row.entity_id,
                    status="skipped",
                    reason="Claim 结构无效，必须人工修复原始记录。",
                )
            )
            continue

        proposed_entity_id = claim.entity_id if claim.entity_id in entity_ids else None
        repair_reason = (
            "Claim 载荷已经包含合法实体，可以确定性同步到审核记录。"
            if proposed_entity_id
            else "主体精确命中唯一实体，允许确定性回填。"
        )
        classification = classify_unlinked_claim(
            claim.model_copy(update={"entity_id": None}),
            snapshot.entities,
        )
        if proposed_entity_id is None and classification.resolution == "deterministic":
            proposed_entity_id = classification.proposed_entity_id
        if proposed_entity_id is None:
            items.append(
                ClaimEntityRepairItem(
                    review_job_id=row.id,
                    claim_id=row.claim_id,
                    previous_entity_id=row.entity_id,
                    proposed_entity_id=classification.proposed_entity_id,
                    status="skipped",
                    reason=classification.reason,
                )
            )
            continue

        repairable_count += 1
        item_status: Literal["repairable", "repaired"] = "repairable"
        previous_entity_id = row.entity_id
        if payload.mode == "apply":
            row.entity_id = proposed_entity_id
            row.claim_json = claim.model_copy(
                update={"entity_id": proposed_entity_id}
            ).model_dump_json(by_alias=True)
            row.version += 1
            services.audit.record(
                session,
                principal,
                "claim.entity.repair",
                "review_job",
                row.id,
                {
                    "claimId": row.claim_id,
                    "previousEntityId": previous_entity_id,
                    "entityId": proposed_entity_id,
                    "method": "deterministic",
                },
            )
            if row.lifecycle_status == "current":
                session.add(
                    PublicationRecordRow(
                        review_job_id=row.id,
                        claim_id=row.claim_id,
                        published_at=datetime.now(UTC),
                        actor=principal.email,
                    )
                )
            repaired_count += 1
            item_status = "repaired"
        items.append(
            ClaimEntityRepairItem(
                review_job_id=row.id,
                claim_id=row.claim_id,
                previous_entity_id=previous_entity_id,
                proposed_entity_id=proposed_entity_id,
                status=item_status,
                reason=repair_reason,
            )
        )

    if payload.mode == "apply":
        session.commit()
    return ClaimEntityRepairReport(
        generated_at=datetime.now(UTC),
        mode=payload.mode,
        total=len(items),
        repairable_count=repairable_count,
        repaired_count=repaired_count,
        items=items,
    )


@router.post(
    "/api/v2/admin/claim-entity-resolution",
    response_model=ClaimEntityResolutionResult,
)
def resolve_claim_entity_manually(
    services: ServicesDependency,
    payload: ClaimEntityResolutionRequest,
    principal: AdminDependency,
    session: SessionDependency,
) -> ClaimEntityResolutionResult:
    row = session.scalars(
        select(ReviewJobRecord)
        .where(
            ReviewJobRecord.claim_id == payload.claim_id,
            ReviewJobRecord.status == "approved",
            ReviewJobRecord.lifecycle_status == "current",
            ReviewJobRecord.publication_action != "merged-evidence",
        )
        .order_by(ReviewJobRecord.created_at.desc(), ReviewJobRecord.id.desc())
        .with_for_update()
    ).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Current approved claim not found.",
        )
    if row.version != payload.expected_version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Review job version is {row.version}; refresh before correcting it.",
        )

    snapshot = services.get_catalog_snapshot(session)
    entity_ids = {entity.id for entity in snapshot.entities}
    if row.entity_id in entity_ids:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This claim already has a valid entity and cannot use the unlinked-claim correction flow.",
        )
    try:
        claim = Claim.model_validate_json(row.claim_json)
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Claim structure is invalid and must be repaired before entity resolution.",
        ) from error

    previous_entity_id = row.entity_id
    now = datetime.now(UTC)
    relation_id: str | None = None
    if payload.action == "assign":
        if payload.entity_id not in entity_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Assign mode requires an existing target entity id.",
            )
        row.entity_id = payload.entity_id
        row.claim_json = claim.model_copy(update={"entity_id": payload.entity_id}).model_dump_json(
            by_alias=True
        )
        audit_action = "claim.entity.manual-assign"
        result_status: Literal["assigned", "retracted"] = "assigned"
        lifecycle_status: Literal["current", "retracted"] = "current"
    else:
        if payload.entity_id is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Retract mode does not accept an entity id.",
            )
        row.lifecycle_status = "retracted"
        audit_action = "claim.entity.retract-unlinked"
        result_status = "retracted"
        lifecycle_status = "retracted"

    row.review_reason = payload.reason
    row.reviewed_at = now
    row.reviewed_by = principal.email
    row.version += 1
    if payload.action == "assign":
        relation = services.repository.relation_from_approved_claim(session, row)
        if relation is not None:
            services.repository.upsert_relation(session, relation)
            relation_id = relation.id
    services.audit.record(
        session,
        principal,
        audit_action,
        "review_job",
        row.id,
        {
            "claimId": row.claim_id,
            "previousEntityId": previous_entity_id,
            "entityId": row.entity_id,
            "lifecycleStatus": row.lifecycle_status,
            "reason": payload.reason,
            "relationId": relation_id,
        },
    )
    session.add(
        PublicationRecordRow(
            review_job_id=row.id,
            claim_id=row.claim_id,
            published_at=now,
            actor=principal.email,
        )
    )
    session.commit()
    return ClaimEntityResolutionResult(
        review_job_id=row.id,
        claim_id=row.claim_id,
        status=result_status,
        previous_entity_id=previous_entity_id,
        entity_id=row.entity_id,
        lifecycle_status=lifecycle_status,
        version=row.version,
    )


@router.post(
    "/api/v2/admin/review-queue/batch-approve",
    response_model=list[ReviewQueueItem],
)
def batch_approve_reviews(
    services: ServicesDependency,
    approval: ReviewBatchApproval,
    actor: ReviewerDependency,
    session: SessionDependency,
) -> list[ReviewQueueItem]:
    item_ids = [item.id for item in approval.items]
    if len(item_ids) != len(set(item_ids)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A review job can appear only once in a batch.",
        )
    decisions: list[ReviewQueueItem] = []
    try:
        for item in approval.items:
            decisions.append(
                services.decide_review(
                    item.id,
                    ReviewDecision(
                        expected_version=item.expected_version,
                        reason=item.reason,
                    ),
                    "approved",
                    actor,
                    session,
                    commit=False,
                    batch_safe_only=True,
                )
            )
        session.commit()
    except Exception:
        session.rollback()
        raise
    return decisions


@router.post(
    "/api/v2/admin/review-queue/batch-merge-duplicates",
    response_model=list[ReviewQueueItem],
)
def batch_merge_duplicate_reviews(
    services: ServicesDependency,
    actor: ReviewerDependency,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=50)] = 50,
) -> list[ReviewQueueItem]:
    target_rows = session.scalars(
        select(ReviewJobRecord)
        .where(
            ReviewJobRecord.status == "approved",
            ReviewJobRecord.lifecycle_status == "current",
            ReviewJobRecord.publication_action != "merged-evidence",
        )
        .order_by(ReviewJobRecord.reviewed_at.desc())
    ).all()
    targets_by_fingerprint: dict[tuple[str, str, str, str, str], ReviewJobRecord] = {}
    for target in target_rows:
        fingerprint = claim_semantic_fingerprint(
            services.repository.approved_claim(target),
            target.entity_id,
        )
        targets_by_fingerprint.setdefault(fingerprint, target)

    open_rows = session.scalars(
        select(ReviewJobRecord)
        .where(ReviewJobRecord.status.in_(OPEN_REVIEW_STATUSES))
        .order_by(ReviewJobRecord.created_at.desc())
    ).all()
    merged: list[ReviewQueueItem] = []
    try:
        for row in open_rows:
            item = services.repository.to_queue_item(row)
            target = targets_by_fingerprint.get(
                claim_semantic_fingerprint(item.claim, item.entity_id)
            )
            if target is None or target.id == row.id:
                continue
            digest = hashlib.sha256(f"{row.id}:{row.version}".encode()).hexdigest()[:32]
            merged.append(
                services.decide_claim_lifecycle(
                    row.id,
                    ReviewLifecycleDecision(
                        expected_version=row.version,
                        target_claim_id=target.claim_id,
                        expected_target_version=target.version,
                        idempotency_key=f"queue-deduplicate-{digest}",
                        reason="确定性队列治理：语义完全相同，已将新证据合并到当前事实。",
                    ),
                    "merged-evidence",
                    actor,
                    session,
                    commit=False,
                )
            )
            if len(merged) >= limit:
                break
        session.commit()
    except Exception:
        session.rollback()
        raise
    return merged


@router.post(
    "/api/v2/admin/review-queue/batch-reject-invalid",
    response_model=list[ReviewQueueItem],
)
def batch_reject_invalid_reviews(
    services: ServicesDependency,
    actor: ReviewerDependency,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=50)] = 50,
) -> list[ReviewQueueItem]:
    open_rows = session.scalars(
        select(ReviewJobRecord)
        .where(ReviewJobRecord.status.in_(OPEN_REVIEW_STATUSES))
        .order_by(ReviewJobRecord.created_at.asc())
    ).all()
    rejected: list[ReviewQueueItem] = []
    try:
        for row in open_rows:
            item = services.repository.to_queue_item(row)
            if not review_item_is_deterministically_invalid(item):
                continue
            rejected.append(
                services.decide_review(
                    row.id,
                    ReviewDecision(
                        expected_version=row.version,
                        reason_category=(
                            "schema_error" if not item.entity_id else "unsupported_evidence"
                        ),
                        reason=("确定性队列治理：候选缺少可发布实体、直接证据或可定位原文锚点。"),
                    ),
                    "rejected",
                    actor,
                    session,
                    commit=False,
                )
            )
            if len(rejected) >= limit:
                break
        session.commit()
    except Exception:
        session.rollback()
        raise
    return rejected


@router.post(
    "/api/v2/admin/review-queue/batch-verify-automation",
    response_model=list[ReviewQueueItem],
)
def batch_verify_automation_reviews(
    services: ServicesDependency,
    verification: ReviewBatchApproval,
    actor: ReviewerDependency,
    session: SessionDependency,
) -> list[ReviewQueueItem]:
    item_ids = [item.id for item in verification.items]
    if len(item_ids) != len(set(item_ids)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A review job can appear only once in a batch.",
        )
    verified: list[ReviewQueueItem] = []
    try:
        for item in verification.items:
            row = session.scalar(
                select(ReviewJobRecord).where(ReviewJobRecord.id == item.id).with_for_update()
            )
            if row is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Review job not found.",
                )
            if (
                row.status == "approved"
                and row.reviewed_by
                and row.reviewed_by != "automation@ai-radar.local"
            ):
                verified.append(services.repository.to_queue_item(row))
                continue
            if row.status != "approved" or row.reviewed_by != "automation@ai-radar.local":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=("Only an approved automation review can receive human verification."),
                )
            if row.version != item.expected_version:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Review job version is {row.version}; refresh before verifying.",
                )
            if not services.repository.to_queue_item(row).evidence_ids:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="An approved claim cannot be verified without evidence.",
                )
            row.reviewed_at = datetime.now(UTC)
            row.reviewed_by = actor.email
            row.reason_category = None
            note = review_decision_note(item)
            row.review_reason = note
            row.version += 1
            services.repository.persist_approved_verification(row)
            services.audit.record(
                session,
                actor,
                "review.human_verified",
                "review_job",
                row.id,
                {"claimId": row.claim_id, "reason": note, "reasonNote": note},
            )
            verified.append(services.repository.to_queue_item(row))
        session.commit()
    except Exception:
        session.rollback()
        raise
    return verified


@router.post(
    "/api/v2/admin/review-queue/{review_id}/approve",
    response_model=ReviewQueueItem,
)
def approve_review(
    services: ServicesDependency,
    review_id: str,
    decision: ReviewDecision,
    actor: ReviewerDependency,
    session: SessionDependency,
) -> ReviewQueueItem:
    return services.decide_review(review_id, decision, "approved", actor, session)


@router.post(
    "/api/v2/admin/review-queue/{review_id}/merge-evidence",
    response_model=ReviewQueueItem,
)
def merge_review_evidence(
    services: ServicesDependency,
    review_id: str,
    decision: ReviewLifecycleDecision,
    actor: ReviewerDependency,
    session: SessionDependency,
) -> ReviewQueueItem:
    return services.decide_claim_lifecycle(
        review_id,
        decision,
        "merged-evidence",
        actor,
        session,
    )


@router.post(
    "/api/v2/admin/review-queue/{review_id}/approve-superseding",
    response_model=ReviewQueueItem,
)
def approve_superseding_review(
    services: ServicesDependency,
    review_id: str,
    decision: ReviewLifecycleDecision,
    actor: ReviewerDependency,
    session: SessionDependency,
) -> ReviewQueueItem:
    return services.decide_claim_lifecycle(
        review_id,
        decision,
        "superseding",
        actor,
        session,
    )


@router.post(
    "/api/v2/admin/review-queue/{review_id}/publication-state",
    response_model=ReviewQueueItem,
)
def change_review_publication_state(
    services: ServicesDependency,
    review_id: str,
    payload: ReviewPublicationStateRequest,
    actor: ReviewerDependency,
    session: SessionDependency,
) -> ReviewQueueItem:
    row = session.scalar(
        select(ReviewJobRecord).where(ReviewJobRecord.id == review_id).with_for_update()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Review job not found.")
    if row.version != payload.expected_version:
        raise HTTPException(status_code=409, detail="Review version changed; refresh first.")
    if row.status != "approved" or row.publication_action == "merged-evidence":
        raise HTTPException(
            status_code=409,
            detail="Only approved standalone claims can change publication state.",
        )
    expected_state = "current" if payload.action == "retract" else "retracted"
    target_state = "retracted" if payload.action == "retract" else "current"
    if row.lifecycle_status != expected_state:
        raise HTTPException(status_code=409, detail="This lifecycle state cannot use this action.")
    reason = payload.reason.strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="A meaningful reason is required.")
    if payload.action == "restore":
        services.require_publishable_entity(row, session)
        queue_item = services.repository.to_queue_item(row)
        # Human-reviewed claims can synthesize several source excerpts; the
        # literal subject/value rule is only appropriate for automatic approval.
        evidence_by_id = {item.id: item for item in queue_item.evidence_items}
        if not queue_item.claim.source_ids or any(
            source_id not in evidence_by_id
            or not evidence_by_id[source_id].url.strip()
            or not (evidence_by_id[source_id].source_excerpt or "").strip()
            for source_id in queue_item.claim.source_ids
        ):
            raise HTTPException(
                status_code=422, detail="Restoring requires reviewed source excerpts."
            )
    changed = session.execute(
        update(ReviewJobRecord)
        .where(
            ReviewJobRecord.id == review_id,
            ReviewJobRecord.version == payload.expected_version,
            ReviewJobRecord.status == "approved",
            ReviewJobRecord.lifecycle_status == expected_state,
        )
        .values(
            lifecycle_status=target_state,
            version=ReviewJobRecord.version + 1,
            review_reason=reason,
            reviewed_by=actor.email,
            reviewed_at=datetime.now(UTC),
        )
    )
    if changed.rowcount != 1:
        raise HTTPException(status_code=409, detail="Review changed concurrently; refresh first.")
    session.expire(row)
    session.refresh(row)
    services.audit.record(
        session,
        actor,
        f"review.{payload.action}",
        "review_job",
        row.id,
        {
            "claimId": row.claim_id,
            "reason": reason,
            "lifecycleStatus": target_state,
            "previousLifecycleStatus": expected_state,
            "version": row.version,
        },
    )
    session.add(
        PublicationRecordRow(
            review_job_id=row.id,
            claim_id=row.claim_id,
            published_at=row.reviewed_at,
            actor=actor.email,
        )
    )
    # Synchronize local documents only; lifecycle changes must not invoke an embedding API.
    LexicalRagRetriever(include_derived_knowledge=False).sync_snapshot(
        session, services.repository.public_snapshot(session)
    )
    session.commit()
    return services.repository.to_queue_item(row)


@router.post(
    "/api/v2/admin/review-queue/{review_id}/reject",
    response_model=ReviewQueueItem,
)
def reject_review(
    services: ServicesDependency,
    review_id: str,
    decision: ReviewDecision,
    actor: ReviewerDependency,
    session: SessionDependency,
) -> ReviewQueueItem:
    return services.decide_review(review_id, decision, "rejected", actor, session)


@router.get(
    "/api/v2/admin/publication-history",
    response_model=list[PublicationRecord],
)
def publication_history(
    services: ServicesDependency,
    _: ReviewerDependency,
    session: SessionDependency,
) -> list[PublicationRecord]:
    return services.repository.publication_history(session)
