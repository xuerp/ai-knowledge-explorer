import json
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from ..application_rules import RELATION_CLAIM_PREDICATES
from ..database import (
    ReviewJobRecord,
)
from ..decision_evidence_requests import (
    require_completed_evidence,
)
from ..email_delivery import EmailDeliveryUnavailableError
from ..entry_requests import (
    EntryRequestDecision,
    EntryRequestStatus,
    EntryRequestView,
    decide_entry_request,
    list_entry_requests,
)
from ..schemas import (
    AuditLogView,
    Claim,
    DataQualityReport,
    DigestRunSummary,
    EmailDeliverySummary,
    EmailOutboxRetryRequest,
    EmailOutboxView,
    Entity,
    ExtractionProbeResult,
    GoldenQuestionReport,
    GraphEdge,
    IntegrationStatus,
    OperationsDiagnostics,
    ProductionReadiness,
    ReleaseBaseline,
    ReleaseClaimMetrics,
    TimelineEntry,
    UserCreate,
    UserView,
)
from .dependencies import AdminDependency, ReviewerDependency, ServicesDependency, SessionDependency

router = APIRouter()


@router.post("/api/v2/admin/users", response_model=UserView, status_code=status.HTTP_201_CREATED)
def create_user(
    services: ServicesDependency,
    payload: UserCreate,
    principal: AdminDependency,
    session: SessionDependency,
) -> UserView:
    try:
        user = services.auth.create_user(session, payload)
    except IntegrityError as error:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists.",
        ) from error
    services.audit.record(session, principal, "user.create", "user", user.id, {"role": user.role})
    session.commit()
    return services.auth.to_user_view(user)


@router.get("/api/v2/admin/audit-log", response_model=list[AuditLogView])
def audit_log(
    services: ServicesDependency,
    _: AdminDependency,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[AuditLogView]:
    return services.audit.list(session, limit)


@router.get("/api/v2/admin/data-quality", response_model=DataQualityReport)
def data_quality(
    services: ServicesDependency,
    _: ReviewerDependency,
    session: SessionDependency,
) -> DataQualityReport:
    return services.get_quality_report(session, include_retrieval=False)


@router.get(
    "/api/v2/admin/golden-questions",
    response_model=GoldenQuestionReport,
)
def golden_question_report(
    services: ServicesDependency,
    _: ReviewerDependency,
    session: SessionDependency,
) -> GoldenQuestionReport:
    return services.get_golden_question_report(session)


@router.get("/api/v2/admin/integrations", response_model=IntegrationStatus)
def integration_status(
    services: ServicesDependency,
    _: AdminDependency,
    session: SessionDependency,
) -> IntegrationStatus:
    return services.integration_status(_, session)


@router.post(
    "/api/v2/admin/integrations/extraction/probe",
    response_model=ExtractionProbeResult,
)
def probe_extraction_integration(
    services: ServicesDependency,
    principal: AdminDependency,
    session: SessionDependency,
) -> ExtractionProbeResult:
    result = services.extraction.probe()
    services.audit.record(
        session,
        principal,
        "integration.extraction.probe",
        "integration",
        "extraction",
        {
            "passed": result.passed,
            "errorCode": result.error_code,
            "endpointHost": result.endpoint_host,
            "model": result.model,
            "latencyMs": result.latency_ms,
            "providerCall": services.extraction.call_metadata(),
        },
    )
    session.commit()
    return result


@router.get("/api/v2/admin/operations", response_model=OperationsDiagnostics)
def operations_status(
    services: ServicesDependency,
    response: Response,
    _: AdminDependency,
    session: SessionDependency,
    recent_limit: Annotated[int, Query(alias="recentLimit", ge=1, le=100)] = 20,
) -> OperationsDiagnostics:
    response.headers["Cache-Control"] = "no-store"
    return services.operations.diagnostics(
        session,
        services.app_settings.worker_id,
        run_limit=recent_limit,
    )


@router.get(
    "/api/v2/admin/production-readiness",
    response_model=ProductionReadiness,
)
def production_readiness(
    services: ServicesDependency,
    response: Response,
    _: AdminDependency,
    session: SessionDependency,
) -> ProductionReadiness:
    return services.production_readiness(response, _, session)


@router.post("/api/v2/admin/digests/run", response_model=DigestRunSummary)
def run_daily_digests(
    services: ServicesDependency,
    principal: AdminDependency,
    session: SessionDependency,
) -> DigestRunSummary:
    result = services.engagement.queue_daily_digests(session)
    services.audit.record(
        session,
        principal,
        "digest.run",
        "email_outbox",
        "daily",
        result.model_dump(by_alias=True),
    )
    session.commit()
    return result


@router.get("/api/v2/admin/email-outbox", response_model=list[EmailOutboxView])
def email_outbox(
    services: ServicesDependency,
    _: AdminDependency,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[EmailOutboxView]:
    return services.engagement.list_outbox(session, limit)


@router.post(
    "/api/v2/admin/email-outbox/send",
    response_model=EmailDeliverySummary,
)
def send_email_outbox(
    services: ServicesDependency,
    principal: AdminDependency,
    session: SessionDependency,
) -> EmailDeliverySummary:
    try:
        result = services.email_delivery.send_queued(session)
    except EmailDeliveryUnavailableError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(error),
        ) from error
    services.audit.record(
        session,
        principal,
        "email_outbox.send",
        "email_outbox",
        "queued",
        result.model_dump(by_alias=True),
    )
    session.commit()
    return result


@router.post(
    "/api/v2/admin/email-outbox/{outbox_id}/retry",
    response_model=EmailOutboxView,
)
def retry_email_outbox(
    services: ServicesDependency,
    outbox_id: str,
    payload: EmailOutboxRetryRequest,
    principal: AdminDependency,
    session: SessionDependency,
) -> EmailOutboxView:
    try:
        row = services.email_delivery.requeue_failed(
            session,
            outbox_id,
            payload.expected_attempt_count,
        )
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(error),
        ) from error
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Outbox message not found.",
        )
    services.audit.record(
        session,
        principal,
        "email_outbox.retry",
        "email_outbox",
        row.id,
        {"attemptCount": row.attempt_count},
    )
    session.commit()
    return services.engagement.to_outbox_view(row)


@router.get("/api/v2/admin/entry-requests", response_model=list[EntryRequestView])
def entry_requests(
    services: ServicesDependency,
    session: SessionDependency,
    _: ReviewerDependency,
    status: EntryRequestStatus | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    q: str | None = Query(default=None, max_length=120),
):
    return list_entry_requests(session, status, offset, limit, q)


@router.patch("/api/v2/admin/entry-requests/{request_id}", response_model=EntryRequestView)
def review_entry_request(
    services: ServicesDependency,
    request_id: str,
    payload: EntryRequestDecision,
    session: SessionDependency,
    principal: ReviewerDependency,
):
    if payload.status == "resolved":
        require_completed_evidence(
            session, request_id, payload.entity_id, services.get_public_snapshot(session)
        )
    result = decide_entry_request(session, request_id, payload, principal.email)
    services.audit.record(
        session,
        principal,
        "entry-request.review",
        "entry-request",
        request_id,
        {"status": result.status, "entityId": result.entity_id},
    )
    session.commit()
    return result


@router.post(
    "/api/v2/admin/entities",
    response_model=Entity,
    status_code=status.HTTP_201_CREATED,
)
def upsert_catalog_entity(
    services: ServicesDependency,
    payload: Entity,
    principal: AdminDependency,
    session: SessionDependency,
) -> Entity:
    try:
        entity = services.repository.upsert_entity(session, payload)
        services.audit.record(
            session,
            principal,
            "catalog.entity.upsert",
            "entity",
            entity.id,
            {"slug": entity.slug, "familyId": entity.family_id},
        )
        session.commit()
        return entity
    except ValueError as error:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    except IntegrityError as error:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Entity id or slug conflicts with an existing catalog record.",
        ) from error


@router.post(
    "/api/v2/admin/relations",
    response_model=GraphEdge,
    status_code=status.HTTP_201_CREATED,
)
def upsert_catalog_relation(
    services: ServicesDependency,
    payload: GraphEdge,
    principal: AdminDependency,
    session: SessionDependency,
) -> GraphEdge:
    try:
        edge = services.repository.upsert_relation(session, payload)
        services.audit.record(
            session,
            principal,
            "catalog.relation.upsert",
            "relation",
            edge.id,
            {"fromId": edge.from_id, "toId": edge.to_id, "kind": edge.kind},
        )
        session.commit()
        return edge
    except ValueError as error:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error


@router.post(
    "/api/v2/admin/entities/{entity_id}/timeline",
    response_model=TimelineEntry,
    status_code=status.HTTP_201_CREATED,
)
def upsert_catalog_timeline(
    services: ServicesDependency,
    entity_id: str,
    payload: TimelineEntry,
    principal: AdminDependency,
    session: SessionDependency,
) -> TimelineEntry:
    try:
        entry = services.repository.upsert_timeline(session, entity_id, payload)
        services.audit.record(
            session,
            principal,
            "catalog.timeline.upsert",
            "timeline",
            entry.id,
            {"entityId": entity_id, "date": entry.date},
        )
        session.commit()
        return entry
    except ValueError as error:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error


@router.get(
    "/api/v2/admin/release-baseline",
    response_model=ReleaseBaseline,
)
def release_baseline(
    services: ServicesDependency,
    response: Response,
    principal: AdminDependency,
    session: SessionDependency,
) -> ReleaseBaseline:
    response.headers["Cache-Control"] = "no-store"
    snapshot = services.get_catalog_snapshot(session)
    entity_ids = {entity.id for entity in snapshot.entities}
    approved_rows = session.scalars(
        select(ReviewJobRecord).where(
            ReviewJobRecord.status == "approved",
            ReviewJobRecord.publication_action != "merged-evidence",
        )
    ).all()
    auto_approved_relation_claim_count = 0
    for row in approved_rows:
        if row.reviewed_by != "automation@ai-radar.local":
            continue
        try:
            predicate = Claim.model_validate_json(row.claim_json).predicate
        except (ValueError, TypeError, json.JSONDecodeError):
            continue
        auto_approved_relation_claim_count += int(predicate in RELATION_CLAIM_PREDICATES)

    quality = services.get_quality_report(session)
    golden = quality.golden_questions or services.get_golden_question_report(session)
    sources = services.ingestion.list_sources(session)
    source_health = {
        state: sum(source.health_state == state for source in sources)
        for state in ("healthy", "retrying", "paused", "manual", "unverified")
    }
    return ReleaseBaseline(
        generated_at=datetime.now(UTC),
        build=services.health(),
        claims=ReleaseClaimMetrics(
            public_claim_count=len(snapshot.claims),
            entity_linked_public_claim_count=sum(
                claim.entity_id in entity_ids for claim in snapshot.claims
            ),
            approved_claim_count=len(approved_rows),
            human_reviewed_claim_count=sum(
                bool(row.reviewed_by) and row.reviewed_by != "automation@ai-radar.local"
                for row in approved_rows
            ),
            auto_approved_relation_claim_count=auto_approved_relation_claim_count,
            current_claim_count=len(snapshot.claims),
            historical_claim_count=sum(
                row.lifecycle_status in {"historical", "superseded", "retracted"}
                for row in approved_rows
            ),
        ),
        quality=quality,
        golden_questions=golden,
        review_queue=services.review_queue_inventory(principal, session),
        operations=services.operations.diagnostics(
            session,
            services.app_settings.worker_id,
            run_limit=20,
        ),
        source_health=source_health,
        integrations=services.integration_status(principal, session),
        readiness=services.production_readiness(Response(), principal, session),
    )
