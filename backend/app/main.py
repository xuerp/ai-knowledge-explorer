import hashlib
import json
import re
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from urllib.parse import urlsplit

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from .answer_generation import CitedAnswerService
from .auth import AuditService, AuthService, Principal
from .automation import AutomationCycleBusyError, automation_cycle_lock
from .config import Settings
from .database import (
    AuditLogRecord,
    Database,
    DocumentSnapshotRecord,
    KnowledgeEntityRecord,
    PublicationRecordRow,
    ReviewJobRecord,
    SourceRecord,
    UserRecord,
)
from .email_delivery import EmailDeliveryService, EmailDeliveryUnavailableError
from .engagement import EngagementService
from .entity_linkage import audit_claim_entity_links, classify_unlinked_claim
from .extraction import (
    EXTRACTION_PIPELINE_VERSION,
    ExtractionUnavailableError,
    StructuredExtractionService,
    entity_reference_appears,
    extraction_audit_is_current,
)
from .fetching import FetchPolicyError, SafeHttpFetcher, classify_fetch_failure
from .golden_questions import GoldenQuestionEvaluator
from .ingestion import IngestionService, normalize_source_url, source_fetch_urls
from .operations import OperationsService
from .production_readiness import ProductionReadinessInputs, build_production_readiness
from .quality import (
    CORE_ENTITY_RELATION_REQUIREMENT,
    KnowledgeQualityGate,
    claim_semantic_fingerprint,
    relation_semantic_fingerprint,
    resolve_unique_entity_reference,
)
from .rag import HybridRagRetriever, LexicalRagRetriever
from .repository import OPEN_REVIEW_STATUSES, RELATION_PREDICATES, KnowledgeRepository
from .scheduler import IngestionScheduler
from .schemas import (
    RELATION_KINDS,
    AuditLogView,
    AutomationCycleResponse,
    BootstrapUser,
    CandidateAssessment,
    CandidateCreate,
    Claim,
    ClaimEntityAuditReport,
    ClaimEntityRepairItem,
    ClaimEntityRepairReport,
    ClaimEntityRepairRequest,
    ClaimEntityResolutionRequest,
    ClaimEntityResolutionResult,
    DataQualityReport,
    DigestPreference,
    DigestRunSummary,
    DocumentIngestRequest,
    DocumentSnapshotView,
    EmailDeliverySummary,
    EmailOutboxRetryRequest,
    EmailOutboxView,
    Entity,
    EntityClaimPage,
    ExtractionPlanItem,
    ExtractionProbeResult,
    ExtractionRequest,
    FollowCreate,
    FollowView,
    GoldenQuestionReport,
    GraphEdge,
    GraphQuery,
    GraphSnapshot,
    HealthResponse,
    IngestionResult,
    IngestionRunView,
    IntegrationStatus,
    KnowledgeSnapshot,
    LoginRequest,
    ModelVersionCompareRequest,
    NotificationView,
    OperationsDiagnostics,
    ProductionReadiness,
    PublicationRecord,
    PublishedResearchView,
    RelationBackfillStatus,
    RelationClaimAuditItem,
    RelationClaimAuditReport,
    RelationClaimRepairItem,
    RelationClaimRepairReport,
    RelationClaimRepairRequest,
    ReleaseBaseline,
    ReleaseClaimMetrics,
    ResearchCitation,
    ResearchCreate,
    ResearchView,
    ReviewBatchApproval,
    ReviewDecision,
    ReviewInventoryReport,
    ReviewLifecycleDecision,
    ReviewQueueItem,
    SchedulerRunSummary,
    SourceCreate,
    SourceProbeResult,
    SourceRetryRequest,
    SourceUpdate,
    SourceView,
    TimelineEntry,
    TokenResponse,
    UserCreate,
    UserView,
)
from .security import require_admin, require_automation, require_reviewer, require_user
from .worker import run_cycle

DATABASE_SCHEMA_REVISION = "20260831_0021"
SERVICE_RELEASE = "2026.08.31-embedding-schema-v65"

RELATION_CLAIM_PREDICATES = set(RELATION_KINDS)

RELATION_PREDICATE_ANCHORS = {
    "developed-by": ("developed-by", "developed by", "开发"),
    "based-on": ("based-on", "based on", "基于"),
    "competes-with": ("competes-with", "competes with", "竞争", "竞品"),
    "benchmarked-on": (
        "benchmarked-on",
        "benchmarked on",
        "evaluated on",
        "评测",
        "基准测试",
    ),
    "uses": ("uses", "using", "使用", "采用"),
    "cited-by": ("cited-by", "cited by", "被引用"),
    "part-of": ("part-of", "part of", "属于", "隶属于"),
    "successor-of": ("successor-of", "successor of", "继任", "后继"),
    "integrates-with": ("integrates-with", "integrates with", "集成", "兼容"),
}


def review_item_has_anchored_excerpt(item: ReviewQueueItem) -> bool:
    subject = " ".join((item.claim.subject or "").casefold().split())
    object_or_value = " ".join((item.claim.object_or_value or "").casefold().split())
    if not subject or not object_or_value:
        return False
    return any(
        subject in " ".join((evidence.source_excerpt or "").casefold().split())
        and object_or_value in " ".join((evidence.source_excerpt or "").casefold().split())
        for evidence in item.evidence_items
    )


def review_item_is_deterministically_invalid(item: ReviewQueueItem) -> bool:
    return (
        not item.entity_id or not item.evidence_items or not review_item_has_anchored_excerpt(item)
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or Settings.from_env()
    database = Database(app_settings.database_url)
    repository = KnowledgeRepository(app_settings.seed_snapshot_path, app_settings.data_mode)
    ingestion = IngestionService(app_settings.fetch_allowed_hosts)
    fetcher = SafeHttpFetcher(app_settings.fetch_allowed_hosts, app_settings.fetch_max_bytes)
    scheduler = IngestionScheduler(
        fetcher,
        ingestion,
        retry_base_minutes=app_settings.fetch_retry_base_minutes,
        retry_max_minutes=app_settings.fetch_retry_max_minutes,
        lease_minutes=app_settings.fetch_lease_minutes,
    )
    auth = AuthService(app_settings.jwt_secret, app_settings.access_token_minutes)
    audit = AuditService()
    quality_gate = KnowledgeQualityGate()
    golden_questions = GoldenQuestionEvaluator()
    rag_retriever = (
        HybridRagRetriever(enabled=True)
        if app_settings.rag_hybrid_enabled
        else LexicalRagRetriever()
    )
    engagement = EngagementService(
        rag_retriever,
        CitedAnswerService(enabled=app_settings.rag_generation_enabled),
    )
    extraction = StructuredExtractionService(
        app_settings.extraction_api_url,
        app_settings.extraction_api_key,
        app_settings.extraction_model,
    )
    email_delivery = EmailDeliveryService(
        app_settings.smtp_host,
        app_settings.smtp_port,
        app_settings.smtp_username,
        app_settings.smtp_password,
        app_settings.smtp_from,
        app_settings.smtp_starttls,
        max_attempts=app_settings.email_max_attempts,
        retry_base_seconds=app_settings.email_retry_base_seconds,
        lease_seconds=app_settings.email_lease_seconds,
    )
    operations = OperationsService(
        app_settings.worker_stale_seconds,
        app_settings.auto_extraction_retry_minutes,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if database.engine.dialect.name == "sqlite":
            database.create_all()
        with database.session() as session:
            repository.seed_catalog(session)
            repository.seed_review_jobs(session)
            ingestion.reconcile_historical_permanent_failures(session)
            ingestion.reconcile_source_portfolio(session)
        yield
        database.dispose()

    app = FastAPI(
        title="AI Radar API",
        version="0.1.0",
        description="Evidence-first knowledge API with a protected human review gate.",
        lifespan=lifespan,
    )
    app.state.settings = app_settings
    app.state.database = database
    app.state.repository = repository
    app.state.auth = auth
    app.state.audit = audit
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(app_settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Accept", "Authorization", "Content-Type", "X-Admin-Token"],
    )

    def get_session(request: Request):
        session = request.app.state.database.session()
        try:
            yield session
        finally:
            session.close()

    SessionDependency = Annotated[Session, Depends(get_session)]
    UserDependency = Annotated[Principal, Depends(require_user)]
    ReviewerDependency = Annotated[Principal, Depends(require_reviewer)]
    AdminDependency = Annotated[Principal, Depends(require_admin)]
    AutomationDependency = Annotated[None, Depends(require_automation)]

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(
            ok=True,
            release=SERVICE_RELEASE,
            build_commit=app_settings.build_commit,
            schema_revision=DATABASE_SCHEMA_REVISION,
            built_at=app_settings.built_at,
            environment=app_settings.environment,
            data_mode=app_settings.data_mode,
            database=app_settings.database_url.split(":", 1)[0],
            admin_writes_enabled=bool(app_settings.admin_token or auth.enabled),
            auth_enabled=auth.enabled,
        )

    @app.get("/ready", response_model=HealthResponse)
    def ready(session: SessionDependency) -> HealthResponse:
        try:
            if not golden_questions.questions_path.is_file():
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Golden question runtime data is not ready.",
                )
            session.execute(text("SELECT 1"))
            if database.engine.dialect.name != "sqlite":
                revision = session.scalar(text("SELECT version_num FROM alembic_version"))
                if revision != DATABASE_SCHEMA_REVISION:
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="Database schema revision is not ready.",
                    )
            if app_settings.data_mode == "live":
                quality = get_quality_report(session)
                if not quality.live_ready:
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="Live data quality gate is not satisfied.",
                    )
        except HTTPException:
            raise
        except SQLAlchemyError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Database readiness check failed.",
            ) from error
        return health()

    @app.get(
        "/api/v2/public/relation-backfill-status",
        response_model=RelationBackfillStatus,
    )
    def public_relation_backfill_status(
        session: SessionDependency,
    ) -> RelationBackfillStatus:
        return get_relation_backfill_status(session)

    @app.post("/api/v2/auth/bootstrap", response_model=TokenResponse)
    def bootstrap_user(
        payload: BootstrapUser,
        principal: AdminDependency,
        session: SessionDependency,
    ) -> TokenResponse:
        if not auth.enabled:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="AI_RADAR_JWT_SECRET must be configured before bootstrapping users.",
            )
        if auth.count_users(session):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Bootstrap is only available before the first user is created.",
            )
        user = auth.create_user(
            session,
            UserCreate(email=payload.email, password=payload.password, role="admin"),
        )
        audit.record(session, principal, "user.bootstrap", "user", user.id, {"role": "admin"})
        session.commit()
        return auth.issue_token(user)

    @app.post("/api/v2/auth/login", response_model=TokenResponse)
    def login(payload: LoginRequest, session: SessionDependency) -> TokenResponse:
        if not auth.enabled:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="JWT authentication is not configured.",
            )
        user = auth.authenticate(session, str(payload.email), payload.password)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password.",
            )
        return auth.issue_token(user)

    @app.post("/api/v2/automation/run-cycle", response_model=AutomationCycleResponse)
    def run_automation_cycle(
        _: AutomationDependency,
        session: SessionDependency,
    ) -> AutomationCycleResponse:
        current = datetime.now(UTC)
        worker_id = app_settings.worker_id
        next_cycle_at = current + timedelta(hours=1)
        try:
            with automation_cycle_lock(database.engine):
                try:
                    run_id = operations.start_ephemeral_cycle(
                        session,
                        worker_id,
                        "scheduled",
                        now=current,
                        active_after_seconds=app_settings.automation_cycle_lease_seconds,
                    )
                except RuntimeError as error:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=str(error),
                    ) from error

                def cycle_heartbeat() -> None:
                    with database.session() as heartbeat_session:
                        operations.heartbeat(
                            heartbeat_session,
                            worker_id,
                            state="running",
                        )

                try:
                    result = run_cycle(
                        session,
                        scheduler,
                        engagement,
                        email_delivery,
                        digest_timezone=app_settings.digest_timezone,
                        now=current,
                        heartbeat=cycle_heartbeat,
                    )
                    automatic_extraction = run_automatic_extraction(session)
                    result["extraction"] = automatic_extraction
                    if int(automatic_extraction.get("failed", 0)) > 0:
                        errors = result.setdefault("errors", {})
                        if isinstance(errors, dict):
                            errors["extraction"] = automatic_extraction.get("errors", [])
                    cycle_status = operations.complete_cycle(
                        session,
                        worker_id,
                        run_id,
                        result,
                        next_cycle_at=next_cycle_at,
                    )
                except Exception as error:
                    session.rollback()
                    operations.fail_cycle(
                        session,
                        worker_id,
                        run_id,
                        error,
                        next_cycle_at=next_cycle_at,
                    )
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail="Automation cycle failed.",
                    ) from error
        except AutomationCycleBusyError as error:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(error),
            ) from error

        return AutomationCycleResponse(
            cycle_id=run_id,
            worker_id=worker_id,
            status=cycle_status,
            result=result,
            next_cycle_at=next_cycle_at,
        )

    @app.get("/api/v2/auth/me", response_model=UserView)
    def me(principal: UserDependency, session: SessionDependency) -> UserView:
        user = session.get(UserRecord, principal.subject)
        if not user or not user.active:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
        return auth.to_user_view(user)

    @app.post("/api/v2/following", response_model=FollowView)
    def follow_entity(
        payload: FollowCreate,
        principal: UserDependency,
        session: SessionDependency,
    ) -> FollowView:
        result = engagement.follow(
            session,
            principal.subject,
            payload,
            get_public_snapshot(session),
        )
        if not result:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")
        return result

    @app.get("/api/v2/following", response_model=list[FollowView])
    def following(
        principal: UserDependency,
        session: SessionDependency,
    ) -> list[FollowView]:
        return engagement.list_follows(session, principal.subject)

    @app.delete("/api/v2/following/{follow_id}", status_code=status.HTTP_204_NO_CONTENT)
    def unfollow_entity(
        follow_id: str,
        principal: UserDependency,
        session: SessionDependency,
    ) -> None:
        if not engagement.unfollow(session, principal.subject, follow_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Follow not found.")

    @app.get("/api/v2/notifications", response_model=list[NotificationView])
    def notifications(
        principal: UserDependency,
        session: SessionDependency,
    ) -> list[NotificationView]:
        return engagement.list_notifications(session, principal.subject)

    @app.post(
        "/api/v2/notifications/{notification_id}/read",
        response_model=NotificationView,
    )
    def mark_notification_read(
        notification_id: str,
        principal: UserDependency,
        session: SessionDependency,
    ) -> NotificationView:
        result = engagement.mark_notification_read(session, principal.subject, notification_id)
        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Notification not found.",
            )
        return result

    @app.post("/api/v2/notification-preferences", response_model=UserView)
    def update_notification_preferences(
        payload: DigestPreference,
        principal: UserDependency,
        session: SessionDependency,
    ) -> UserView:
        user = session.get(UserRecord, principal.subject)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
        user.daily_digest_enabled = payload.enabled
        user.digest_hour = payload.hour
        session.commit()
        return auth.to_user_view(user)

    @app.post("/api/v2/research", response_model=ResearchView)
    def create_research(
        payload: ResearchCreate,
        principal: UserDependency,
        session: SessionDependency,
    ) -> ResearchView:
        return engagement.research(
            session,
            principal.subject,
            payload,
            get_public_snapshot(session),
        )

    @app.get("/api/v2/research/{research_id}", response_model=ResearchView)
    def research_detail(
        research_id: str,
        principal: UserDependency,
        session: SessionDependency,
    ) -> ResearchView:
        result = engagement.get_research(
            session,
            research_id,
            user_id=principal.subject,
        )
        if not result:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Research not found.")
        return result

    @app.post("/api/v2/research/{research_id}/publish", response_model=ResearchView)
    def publish_research(
        research_id: str,
        principal: UserDependency,
        session: SessionDependency,
    ) -> ResearchView:
        result = engagement.publish_research(session, research_id, principal.subject)
        if not result:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Research not found.")
        return result

    def published_research_view(
        result: ResearchView,
        session: Session,
    ) -> PublishedResearchView:
        snapshot = get_public_snapshot(session)
        evidence_by_id = {item.id: item for item in snapshot.evidence}
        claims_by_id = {item.id: item for item in snapshot.claims}
        citations = []
        for claim_id in result.claim_ids:
            claim = claims_by_id.get(claim_id)
            if not claim:
                continue
            citations.append(
                ResearchCitation(
                    claim=claim,
                    evidence=[
                        evidence_by_id[evidence_id]
                        for evidence_id in claim.source_ids
                        if evidence_id in evidence_by_id
                    ],
                )
            )
        return PublishedResearchView.model_validate(
            {
                **result.model_dump(mode="json", by_alias=True),
                "citations": [item.model_dump(mode="json", by_alias=True) for item in citations],
            }
        )

    @app.get("/api/v2/share/{slug}", response_model=PublishedResearchView)
    def public_research(slug: str, session: SessionDependency) -> PublishedResearchView:
        result = engagement.get_research(session, "", public_slug=slug)
        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Published research not found.",
            )
        return published_research_view(result, session)

    @app.get("/api/v2/share/{slug}/markdown", response_class=PlainTextResponse)
    def public_research_markdown(slug: str, session: SessionDependency) -> str:
        result = engagement.get_research(session, "", public_slug=slug)
        if not result:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Published research not found.",
            )
        published = published_research_view(result, session)
        citations = "\n".join(
            f"- `{item.claim.id}` — "
            + ", ".join(f"[{source.publisher}]({source.url})" for source in item.evidence)
            for item in published.citations
        )
        return f"# {result.question}\n\n{result.summary}\n\n## Sources\n\n{citations}\n"

    @app.post("/api/v2/admin/users", response_model=UserView, status_code=status.HTTP_201_CREATED)
    def create_user(
        payload: UserCreate,
        principal: AdminDependency,
        session: SessionDependency,
    ) -> UserView:
        try:
            user = auth.create_user(session, payload)
        except IntegrityError as error:
            session.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A user with this email already exists.",
            ) from error
        audit.record(session, principal, "user.create", "user", user.id, {"role": user.role})
        session.commit()
        return auth.to_user_view(user)

    @app.get("/api/v2/admin/audit-log", response_model=list[AuditLogView])
    def audit_log(
        _: AdminDependency,
        session: SessionDependency,
        limit: Annotated[int, Query(ge=1, le=500)] = 100,
    ) -> list[AuditLogView]:
        return audit.list(session, limit)

    @app.get("/api/v2/admin/data-quality", response_model=DataQualityReport)
    def data_quality(
        _: ReviewerDependency,
        session: SessionDependency,
    ) -> DataQualityReport:
        return get_quality_report(session, include_retrieval=False)

    @app.get(
        "/api/v2/admin/golden-questions",
        response_model=GoldenQuestionReport,
    )
    def golden_question_report(
        _: ReviewerDependency,
        session: SessionDependency,
    ) -> GoldenQuestionReport:
        return get_golden_question_report(session)

    @app.get("/api/v2/admin/integrations", response_model=IntegrationStatus)
    def integration_status(
        _: AdminDependency,
        session: SessionDependency,
    ) -> IntegrationStatus:
        sources = ingestion.list_sources(session)
        extraction_host = (
            urlsplit(app_settings.extraction_api_url).hostname
            if app_settings.extraction_api_url
            else None
        )
        return IntegrationStatus(
            extraction_configured=bool(
                app_settings.extraction_api_url
                and app_settings.extraction_api_key
                and app_settings.extraction_model
            ),
            extraction_pipeline_version=EXTRACTION_PIPELINE_VERSION,
            extraction_endpoint_host=extraction_host,
            extraction_model=app_settings.extraction_model,
            automatic_extraction_enabled=(
                extraction.enabled and app_settings.auto_extraction_max_snapshots_per_cycle > 0
            ),
            automatic_extraction_max_snapshots_per_cycle=(
                app_settings.auto_extraction_max_snapshots_per_cycle
            ),
            automatic_extraction_max_candidates_per_snapshot=(
                app_settings.auto_extraction_max_candidates_per_snapshot
            ),
            automatic_extraction_retry_minutes=app_settings.auto_extraction_retry_minutes,
            automatic_relation_approval_enabled=app_settings.auto_approve_grounded_relations,
            smtp_configured=bool(app_settings.smtp_host and app_settings.smtp_from),
            smtp_host=app_settings.smtp_host,
            smtp_from=app_settings.smtp_from,
            fetch_allowed_hosts=list(app_settings.fetch_allowed_hosts),
            registered_sources=len(sources),
            automatic_sources=sum(source.fetch_enabled for source in sources),
            digest_timezone=app_settings.digest_timezone,
        )

    @app.post(
        "/api/v2/admin/integrations/extraction/probe",
        response_model=ExtractionProbeResult,
    )
    def probe_extraction_integration(
        principal: AdminDependency,
        session: SessionDependency,
    ) -> ExtractionProbeResult:
        result = extraction.probe()
        audit.record(
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
            },
        )
        session.commit()
        return result

    @app.get("/api/v2/admin/operations", response_model=OperationsDiagnostics)
    def operations_status(
        response: Response,
        _: AdminDependency,
        session: SessionDependency,
        recent_limit: Annotated[int, Query(alias="recentLimit", ge=1, le=100)] = 20,
    ) -> OperationsDiagnostics:
        response.headers["Cache-Control"] = "no-store"
        return operations.diagnostics(
            session,
            app_settings.worker_id,
            run_limit=recent_limit,
        )

    @app.get(
        "/api/v2/admin/production-readiness",
        response_model=ProductionReadiness,
    )
    def production_readiness(
        response: Response,
        _: AdminDependency,
        session: SessionDependency,
    ) -> ProductionReadiness:
        response.headers["Cache-Control"] = "no-store"
        sources = ingestion.list_sources(session)
        quality = get_quality_report(session, include_retrieval=False)
        diagnostics = operations.diagnostics(session, app_settings.worker_id, run_limit=1)
        revision: str | None = None
        if database.engine.dialect.name != "sqlite":
            try:
                revision = session.scalar(text("SELECT version_num FROM alembic_version"))
            except SQLAlchemyError:
                session.rollback()
        return build_production_readiness(
            ProductionReadinessInputs(
                environment=app_settings.environment,
                data_mode=app_settings.data_mode,
                database_dialect=database.engine.dialect.name,
                schema_revision=revision,
                expected_schema_revision=DATABASE_SCHEMA_REVISION,
                jwt_enabled=auth.enabled,
                legacy_admin_token_enabled=bool(app_settings.admin_token),
                cors_origins=app_settings.cors_origins,
                extraction_configured=extraction.enabled,
                smtp_configured=email_delivery.enabled,
                fetch_allowed_hosts=len(app_settings.fetch_allowed_hosts),
                automatic_sources=sum(source.active and source.fetch_enabled for source in sources),
                quality_ready=quality.live_ready,
                heartbeat_status=diagnostics.heartbeat_status,
            )
        )

    @app.post("/api/v2/admin/digests/run", response_model=DigestRunSummary)
    def run_daily_digests(
        principal: AdminDependency,
        session: SessionDependency,
    ) -> DigestRunSummary:
        result = engagement.queue_daily_digests(session)
        audit.record(
            session,
            principal,
            "digest.run",
            "email_outbox",
            "daily",
            result.model_dump(by_alias=True),
        )
        session.commit()
        return result

    @app.get("/api/v2/admin/email-outbox", response_model=list[EmailOutboxView])
    def email_outbox(
        _: AdminDependency,
        session: SessionDependency,
        limit: Annotated[int, Query(ge=1, le=500)] = 200,
    ) -> list[EmailOutboxView]:
        return engagement.list_outbox(session, limit)

    @app.post(
        "/api/v2/admin/email-outbox/send",
        response_model=EmailDeliverySummary,
    )
    def send_email_outbox(
        principal: AdminDependency,
        session: SessionDependency,
    ) -> EmailDeliverySummary:
        try:
            result = email_delivery.send_queued(session)
        except EmailDeliveryUnavailableError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
            ) from error
        audit.record(
            session,
            principal,
            "email_outbox.send",
            "email_outbox",
            "queued",
            result.model_dump(by_alias=True),
        )
        session.commit()
        return result

    @app.post(
        "/api/v2/admin/email-outbox/{outbox_id}/retry",
        response_model=EmailOutboxView,
    )
    def retry_email_outbox(
        outbox_id: str,
        payload: EmailOutboxRetryRequest,
        principal: AdminDependency,
        session: SessionDependency,
    ) -> EmailOutboxView:
        try:
            row = email_delivery.requeue_failed(
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
        audit.record(
            session,
            principal,
            "email_outbox.retry",
            "email_outbox",
            row.id,
            {"attemptCount": row.attempt_count},
        )
        session.commit()
        return engagement.to_outbox_view(row)

    def get_catalog_snapshot(session: Session) -> KnowledgeSnapshot:
        return repository.public_snapshot(session)

    def require_publishable_entity(row: ReviewJobRecord, session: Session) -> None:
        if not row.entity_id or session.get(KnowledgeEntityRecord, row.entity_id) is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="A claim cannot be published without one valid knowledge entity.",
            )

    def build_extraction_plan(
        session: Session,
        limit: int,
        *,
        automatic_only: bool = False,
    ) -> list[tuple[SourceRecord, DocumentSnapshotRecord]]:
        extraction_runs = session.scalars(
            select(AuditLogRecord).where(
                AuditLogRecord.action == "extraction.run",
                AuditLogRecord.target_type == "document_snapshot",
            )
        ).all()
        extracted_snapshot_ids = {
            row.target_id for row in extraction_runs if extraction_audit_is_current(row.detail_json)
        }
        cooling_down_snapshot_ids: set[str] = set()
        if automatic_only:
            retry_after = datetime.now(UTC) - timedelta(
                minutes=app_settings.auto_extraction_retry_minutes
            )
            recent_failures = session.scalars(
                select(AuditLogRecord).where(
                    AuditLogRecord.action == "extraction.failed",
                    AuditLogRecord.target_type == "document_snapshot",
                    AuditLogRecord.created_at >= retry_after,
                )
            ).all()
            cooling_down_snapshot_ids = {
                row.target_id
                for row in recent_failures
                if extraction_audit_is_current(row.detail_json)
            }
        snapshots = session.scalars(
            select(DocumentSnapshotRecord).order_by(
                DocumentSnapshotRecord.observed_at.desc(),
                DocumentSnapshotRecord.id.desc(),
            )
        ).all()
        eligible: list[tuple[SourceRecord, DocumentSnapshotRecord]] = []
        seen_sources: set[str] = set()
        for snapshot_row in snapshots:
            if snapshot_row.source_id in seen_sources:
                continue
            seen_sources.add(snapshot_row.source_id)
            if snapshot_row.id in extracted_snapshot_ids:
                continue
            if snapshot_row.id in cooling_down_snapshot_ids:
                continue
            source = session.get(SourceRecord, snapshot_row.source_id)
            if not source or not source.active:
                continue
            eligible.append((source, snapshot_row))

        public_snapshot = get_catalog_snapshot(session)
        quality = quality_gate.report(public_snapshot)
        priority_ids = set(quality.core_entities_below_five_relations)
        priority_entities = [
            entity for entity in public_snapshot.entities if entity.id in priority_ids
        ]
        priority_weights = {
            entity_id: CORE_ENTITY_RELATION_REQUIREMENT
            - quality.core_entity_relation_counts[entity_id]
            for entity_id in priority_ids
        }

        def priority_mentions(
            item: tuple[SourceRecord, DocumentSnapshotRecord],
        ) -> int:
            return sum(
                priority_weights[entity.id] * entity_reference_appears(item[1].content_text, entity)
                for entity in priority_entities
            )

        eligible.sort(
            key=lambda item: (
                priority_mentions(item),
                item[1].observed_at,
                item[1].id,
            ),
            reverse=True,
        )
        return eligible[:limit]

    def build_relation_backfill_plan(
        session: Session,
        limit: int,
        *,
        excluded_snapshot_ids: set[str] | None = None,
    ) -> tuple[list[tuple[SourceRecord, DocumentSnapshotRecord]], int]:
        batch_id = app_settings.relation_backfill_batch_id
        budget = app_settings.relation_backfill_max_snapshots
        if not batch_id or budget <= 0:
            return [], 0

        audit_state = relation_backfill_audit_state(session, batch_id)
        attempted_snapshot_ids = audit_state["attemptedSnapshotIds"]
        attempts = int(audit_state["attempts"])
        remaining = max(0, budget - attempts)
        if remaining == 0 or limit <= 0:
            return [], remaining

        public_snapshot = get_catalog_snapshot(session)
        quality = quality_gate.report(public_snapshot)
        if quality.core_relation_deficit <= 0:
            return [], remaining
        priority_ids = set(quality.core_entities_below_five_relations)
        priority_entities = [
            entity for entity in public_snapshot.entities if entity.id in priority_ids
        ]
        priority_weights = {
            entity_id: CORE_ENTITY_RELATION_REQUIREMENT
            - quality.core_entity_relation_counts[entity_id]
            for entity_id in priority_ids
        }

        snapshots = session.scalars(
            select(DocumentSnapshotRecord).order_by(
                DocumentSnapshotRecord.observed_at.desc(),
                DocumentSnapshotRecord.id.desc(),
            )
        ).all()
        excluded = excluded_snapshot_ids or set()
        eligible: list[tuple[int, SourceRecord, DocumentSnapshotRecord]] = []
        seen_sources: set[str] = set()
        for snapshot_row in snapshots:
            if snapshot_row.source_id in seen_sources:
                continue
            seen_sources.add(snapshot_row.source_id)
            if snapshot_row.id in attempted_snapshot_ids or snapshot_row.id in excluded:
                continue
            source = session.get(SourceRecord, snapshot_row.source_id)
            if not source or not source.active:
                continue
            # 关系补齐只读取已经持久化的不可变快照，不发起采集请求。因此，位于
            # 官方白名单内的人工或熔断信源也可以参与一次性批次，而无需恢复联网采集。
            # 信任边界使用管理员登记的原始官方 URL，不使用为采集兜底准备的镜像地址。
            host = (urlsplit(source.url).hostname or "").lower()
            if host not in app_settings.fetch_allowed_hosts:
                continue
            score = sum(
                priority_weights[entity.id]
                for entity in priority_entities
                if entity_reference_appears(snapshot_row.content_text, entity)
            )
            if score <= 0:
                continue
            eligible.append((score, source, snapshot_row))

        eligible.sort(
            key=lambda item: (item[0], item[2].observed_at, item[2].id),
            reverse=True,
        )
        selected = eligible[: min(limit, remaining)]
        return [(source, snapshot) for _, source, snapshot in selected], remaining

    def relation_backfill_audit_state(session: Session, batch_id: str) -> dict[str, object]:
        attempt_rows = session.scalars(
            select(AuditLogRecord).where(
                AuditLogRecord.action.in_({"extraction.run", "extraction.failed"}),
                AuditLogRecord.target_type == "document_snapshot",
            )
        ).all()
        attempted_snapshot_ids: set[str] = set()
        state: dict[str, object] = {
            "attempts": 0,
            "succeeded": 0,
            "failed": 0,
            "candidatesCreated": 0,
            "duplicatesSkipped": 0,
            "relationsAutoApproved": 0,
        }
        for row in attempt_rows:
            try:
                detail = json.loads(row.detail_json)
            except (TypeError, ValueError):
                continue
            if detail.get("relationBackfillBatchId") != batch_id:
                continue
            state["attempts"] = int(state["attempts"]) + 1
            outcome = "succeeded" if row.action == "extraction.run" else "failed"
            state[outcome] = int(state[outcome]) + 1
            state["candidatesCreated"] = int(state["candidatesCreated"]) + int(
                detail.get("candidatesCreated", 0)
            )
            state["duplicatesSkipped"] = int(state["duplicatesSkipped"]) + int(
                detail.get("duplicatesSkipped", 0)
            )
            state["relationsAutoApproved"] = int(state["relationsAutoApproved"]) + int(
                detail.get("relationsAutoApproved", 0)
            )
            attempted_snapshot_ids.add(row.target_id)
        state["attemptedSnapshotIds"] = attempted_snapshot_ids
        return state

    def get_relation_backfill_status(session: Session) -> RelationBackfillStatus:
        batch_id = app_settings.relation_backfill_batch_id
        budget = app_settings.relation_backfill_max_snapshots
        quality = quality_gate.report(get_catalog_snapshot(session))
        if not batch_id or budget <= 0:
            return RelationBackfillStatus(
                configured=False,
                status="disabled",
                budget=0,
                attempts=0,
                succeeded=0,
                failed=0,
                candidates_created=0,
                duplicates_skipped=0,
                relations_auto_approved=0,
                attempts_remaining=0,
                eligible_snapshots=0,
                relation_deficit=quality.core_relation_deficit,
                core_entities_below_requirement=len(quality.core_entities_below_five_relations),
            )
        state = relation_backfill_audit_state(session, batch_id)
        attempts = int(state["attempts"])
        remaining = max(0, budget - attempts)
        eligible, _ = build_relation_backfill_plan(session, remaining)
        complete = (
            quality.core_relation_deficit <= 0 or remaining == 0 or (attempts > 0 and not eligible)
        )
        phase: Literal["waiting", "running", "complete"] = (
            "complete" if complete else "running" if attempts > 0 else "waiting"
        )
        return RelationBackfillStatus(
            configured=True,
            status=phase,
            batch_id=batch_id,
            budget=budget,
            attempts=attempts,
            succeeded=int(state["succeeded"]),
            failed=int(state["failed"]),
            candidates_created=int(state["candidatesCreated"]),
            duplicates_skipped=int(state["duplicatesSkipped"]),
            relations_auto_approved=int(state["relationsAutoApproved"]),
            attempts_remaining=remaining,
            eligible_snapshots=len(eligible),
            relation_deficit=quality.core_relation_deficit,
            core_entities_below_requirement=len(quality.core_entities_below_five_relations),
        )

    def create_extraction_candidates(
        session: Session,
        source: SourceRecord,
        snapshot_row: DocumentSnapshotRecord,
        max_candidates: int,
    ) -> tuple[list[ReviewQueueItem], int]:
        public_snapshot = get_catalog_snapshot(session)
        quality = quality_gate.report(public_snapshot)
        candidates = extraction.extract(
            source,
            snapshot_row,
            max_candidates,
            public_snapshot.entities,
            priority_entity_ids=quality.core_entities_below_five_relations,
            priority_entity_deficits={
                entity_id: CORE_ENTITY_RELATION_REQUIREMENT
                - quality.core_entity_relation_counts[entity_id]
                for entity_id in quality.core_entities_below_five_relations
            },
            claims_remaining=quality.claims_remaining,
            relation_deficit=quality.core_relation_deficit,
        )

        def semantic_fingerprint(
            claim: Claim,
            entity_id: str | None = None,
        ) -> tuple[str, str, str, str, str]:
            object_entity_id = None
            if claim.predicate in RELATION_CLAIM_PREDICATES:
                object_entity_id = resolve_unique_entity_reference(
                    claim.object_or_value,
                    public_snapshot.entities,
                )
            return claim_semantic_fingerprint(
                claim,
                entity_id,
                object_entity_id,
            )

        published_fingerprints = {semantic_fingerprint(claim) for claim in public_snapshot.claims}
        published_fingerprints.update(
            relation_semantic_fingerprint(
                edge.from_id,
                edge.kind,
                edge.to_id,
                edge.valid_from or "",
                edge.valid_to or "",
            )
            for edge in public_snapshot.graph.edges
            if edge.kind in RELATION_CLAIM_PREDICATES
        )
        open_review_rows = session.scalars(
            select(ReviewJobRecord).where(ReviewJobRecord.status.in_(OPEN_REVIEW_STATUSES))
        ).all()
        open_fingerprints = {
            semantic_fingerprint(
                Claim.model_validate_json(existing_row.claim_json),
                existing_row.entity_id,
            ): existing_row
            for existing_row in open_review_rows
        }

        def merge_duplicate_evidence(
            existing_row: ReviewJobRecord,
            candidate: CandidateCreate,
        ) -> None:
            existing_claim = Claim.model_validate_json(existing_row.claim_json)
            evidence_by_id = {
                evidence.id: evidence for evidence in repository.approved_evidence(existing_row)
            }
            changed = False
            for evidence in candidate.evidence:
                existing_evidence = evidence_by_id.get(evidence.id)
                if existing_evidence is not None:
                    if evidence.source_excerpt and not existing_evidence.source_excerpt:
                        evidence_by_id[evidence.id] = existing_evidence.model_copy(
                            update={"source_excerpt": evidence.source_excerpt}
                        )
                        changed = True
                    continue
                evidence_by_id[evidence.id] = evidence.model_copy(
                    update={"supports_claim_ids": [existing_claim.id]}
                )
                changed = True
            if not changed:
                return
            evidence_items = list(evidence_by_id.values())
            existing_claim = existing_claim.model_copy(
                update={"source_ids": [evidence.id for evidence in evidence_items]}
            )
            existing_row.claim_json = existing_claim.model_dump_json(by_alias=True)
            existing_row.evidence_ids_json = json.dumps(
                [evidence.id for evidence in evidence_items]
            )
            existing_row.evidence_json = json.dumps(
                [evidence.model_dump(mode="json", by_alias=True) for evidence in evidence_items],
                ensure_ascii=False,
            )
            existing_row.version += 1
            if not existing_row.review_reason:
                existing_row.review_reason = "检测到重复事实，已合并新增证据。"

        created: list[ReviewQueueItem] = []
        duplicates_skipped = 0
        for candidate in candidates:
            assessment = quality_gate.assess(candidate, public_snapshot)
            if assessment.resolved_entity_id:
                candidate = candidate.model_copy(
                    update={"entity_id": assessment.resolved_entity_id}
                )
            fingerprint = semantic_fingerprint(
                candidate.claim,
                candidate.entity_id,
            )
            if fingerprint in published_fingerprints:
                duplicates_skipped += 1
                continue
            if existing_row := open_fingerprints.get(fingerprint):
                merge_duplicate_evidence(existing_row, candidate)
                duplicates_skipped += 1
                continue
            reason = None
            if assessment.conflicting_claim_ids:
                reason = "Structured conflict detected against: " + ", ".join(
                    assessment.conflicting_claim_ids
                )
            row = ingestion.submit_candidate(
                session,
                candidate,
                queue_status=assessment.queue_status,
                conflict_claim_ids=assessment.conflicting_claim_ids,
                review_reason=reason,
            )
            if row:
                created.append(repository.to_queue_item(row))
                open_fingerprints[fingerprint] = row
        return created, duplicates_skipped

    def is_grounded_relation_auto_approvable(
        session: Session,
        row: ReviewJobRecord,
        source: SourceRecord,
        snapshot_row: DocumentSnapshotRecord,
    ) -> bool:
        if not app_settings.auto_approve_grounded_relations:
            return False
        item = repository.to_queue_item(row)
        claim = item.claim
        if (
            item.status != "pending"
            or item.conflict_claim_ids
            or not item.entity_id
            or claim.predicate not in RELATION_CLAIM_PREDICATES
            or not claim.subject
            or not claim.object_or_value
        ):
            return False

        def reference_key(value: str | None) -> str:
            return " ".join((value or "").casefold().split())

        document = reference_key(snapshot_row.content_text)
        subject_key = reference_key(claim.subject)
        target_key = reference_key(claim.object_or_value)
        if subject_key not in document or target_key not in document:
            return False

        def contains_anchor(anchor: str) -> bool:
            normalized = reference_key(anchor)
            if normalized.isascii():
                return bool(re.search(rf"\b{re.escape(normalized)}\b", document))
            return normalized in document

        if not any(
            contains_anchor(anchor) for anchor in RELATION_PREDICATE_ANCHORS[claim.predicate]
        ):
            return False

        catalog = get_catalog_snapshot(session)
        source_entities = [entity for entity in catalog.entities if entity.id == item.entity_id]
        if len(source_entities) != 1:
            return False
        source_entity = source_entities[0]
        source_references = {
            reference_key(source_entity.id),
            reference_key(source_entity.slug),
            reference_key(source_entity.name.zh),
            reference_key(source_entity.name.en),
            *(reference_key(alias) for alias in source_entity.aliases or []),
        }
        if subject_key not in source_references:
            return False
        targets = [
            entity
            for entity in catalog.entities
            if target_key
            in {
                reference_key(entity.id),
                reference_key(entity.slug),
                reference_key(entity.name.zh),
                reference_key(entity.name.en),
                *(reference_key(alias) for alias in entity.aliases or []),
            }
        ]
        if len(targets) != 1 or targets[0].id == item.entity_id:
            return False
        evidence_items = repository.approved_evidence(row)
        return bool(evidence_items) and all(
            evidence.type == "official" and str(evidence.url).rstrip("/") == source.url.rstrip("/")
            for evidence in evidence_items
        )

    def run_automatic_extraction(session: Session) -> dict[str, object]:
        limit = app_settings.auto_extraction_max_snapshots_per_cycle
        summary: dict[str, object] = {
            "configured": extraction.enabled,
            "enabled": extraction.enabled and limit > 0,
            "pipelineVersion": EXTRACTION_PIPELINE_VERSION,
            "planned": 0,
            "processed": 0,
            "candidatesCreated": 0,
            "duplicatesSkipped": 0,
            "relationsAutoApproved": 0,
            "failed": 0,
        }
        if not summary["enabled"]:
            return summary
        regular_plan = build_extraction_plan(session, limit, automatic_only=True)
        planned: list[tuple[SourceRecord, DocumentSnapshotRecord, bool]] = [
            (source, snapshot_row, False) for source, snapshot_row in regular_plan
        ]
        backfill_plan, backfill_remaining = build_relation_backfill_plan(
            session,
            limit - len(planned),
            excluded_snapshot_ids={snapshot_row.id for _, snapshot_row, _ in planned},
        )
        planned.extend((source, snapshot_row, True) for source, snapshot_row in backfill_plan)
        if app_settings.relation_backfill_batch_id:
            summary["relationBackfillBatchId"] = app_settings.relation_backfill_batch_id
            summary["relationBackfillAttemptsRemaining"] = backfill_remaining
        summary["planned"] = len(planned)
        errors: list[dict[str, str]] = []
        backfill_attempts_this_cycle = 0
        principal = Principal(
            subject="automation",
            email="automation@ai-radar.local",
            role="admin",
        )
        for source, snapshot_row, is_relation_backfill in planned:
            audit_context = (
                {"relationBackfillBatchId": app_settings.relation_backfill_batch_id}
                if is_relation_backfill
                else {}
            )
            try:
                created, duplicates_skipped = create_extraction_candidates(
                    session,
                    source,
                    snapshot_row,
                    app_settings.auto_extraction_max_candidates_per_snapshot,
                )
                auto_approved = 0
                for item in created:
                    row = session.get(ReviewJobRecord, item.id)
                    if row and is_grounded_relation_auto_approvable(
                        session,
                        row,
                        source,
                        snapshot_row,
                    ):
                        decide_review(
                            row.id,
                            ReviewDecision(
                                expected_version=row.version,
                                reason="自动批准：官方原文逐字锚定主客体与关系语义，且实体唯一、零冲突。",
                            ),
                            "approved",
                            principal,
                            session,
                        )
                        auto_approved += 1
                audit.record(
                    session,
                    principal,
                    "extraction.run",
                    "document_snapshot",
                    snapshot_row.id,
                    {
                        "automatic": True,
                        "candidatesCreated": len(created),
                        "duplicatesSkipped": duplicates_skipped,
                        "relationsAutoApproved": auto_approved,
                        "pipelineVersion": EXTRACTION_PIPELINE_VERSION,
                        "sourceId": source.id,
                        **audit_context,
                    },
                )
                session.commit()
                if is_relation_backfill:
                    backfill_attempts_this_cycle += 1
                summary["processed"] = int(summary["processed"]) + 1
                summary["candidatesCreated"] = int(summary["candidatesCreated"]) + len(created)
                summary["duplicatesSkipped"] = (
                    int(summary["duplicatesSkipped"]) + duplicates_skipped
                )
                summary["relationsAutoApproved"] = (
                    int(summary["relationsAutoApproved"]) + auto_approved
                )
            except Exception as error:  # noqa: BLE001 - persist diagnostics and retry later
                session.rollback()
                audit.record(
                    session,
                    principal,
                    "extraction.failed",
                    "document_snapshot",
                    snapshot_row.id,
                    {
                        "sourceId": source.id,
                        "error": str(error)[:500],
                        "pipelineVersion": EXTRACTION_PIPELINE_VERSION,
                        **audit_context,
                    },
                )
                session.commit()
                if is_relation_backfill:
                    backfill_attempts_this_cycle += 1
                summary["failed"] = int(summary["failed"]) + 1
                errors.append({"sourceId": source.id, "error": str(error)[:500]})
                continue
        if errors:
            summary["errors"] = errors
        if app_settings.relation_backfill_batch_id:
            summary["relationBackfillAttemptsRemaining"] = max(
                0,
                backfill_remaining - backfill_attempts_this_cycle,
            )
        return summary

    def get_golden_question_report(session: Session) -> GoldenQuestionReport:
        return golden_questions.evaluate(
            get_catalog_snapshot(session),
            session=session,
            retriever=engagement.retriever,
        )

    def get_quality_report(
        session: Session,
        *,
        include_retrieval: bool = True,
    ) -> DataQualityReport:
        snapshot = get_catalog_snapshot(session)
        report = quality_gate.report(snapshot)
        golden = golden_questions.evaluate(
            snapshot,
            session=session if include_retrieval else None,
            retriever=engagement.retriever if include_retrieval else None,
        )
        issues = [*report.issues]
        if not include_retrieval:
            issues.append("完整 RAG 检索评估未在快速概览中执行，正式发布前必须单独运行。")
        if not golden.ready:
            issues.append(
                f"Golden question pass ratio must reach {golden.required_ratio:.0%}; "
                f"current ratio is {golden.pass_ratio:.0%}."
            )
        return report.model_copy(
            update={
                "evaluation_scope": "full" if include_retrieval else "overview",
                "golden_questions": golden,
                "live_ready": report.live_ready and golden.ready and include_retrieval,
                "issues": issues,
            }
        )

    def get_public_snapshot(session: Session) -> KnowledgeSnapshot:
        snapshot = get_catalog_snapshot(session)
        if app_settings.data_mode == "live":
            quality = get_quality_report(session)
            if not quality.live_ready:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Live data quality gate is not satisfied.",
                )
        return snapshot

    @app.get("/api/snapshot", response_model=KnowledgeSnapshot)
    @app.get("/api/v2/snapshot", response_model=KnowledgeSnapshot)
    def snapshot(session: SessionDependency) -> KnowledgeSnapshot:
        return get_public_snapshot(session)

    @app.get("/api/v2/entities", response_model=list[Entity])
    def entities(
        session: SessionDependency,
        entity_type: Annotated[str | None, Query(alias="type")] = None,
        query: str | None = None,
    ) -> list[Entity]:
        items = get_public_snapshot(session).entities
        if entity_type:
            items = [item for item in items if item.type == entity_type]
        if query:
            needle = query.casefold()
            items = [
                item
                for item in items
                if needle in item.name.zh.casefold()
                or needle in item.name.en.casefold()
                or needle in item.slug.casefold()
                or any(needle in alias.casefold() for alias in item.aliases or [])
            ]
        return items

    @app.get(
        "/api/v2/entities/{entity_id}/claims",
        response_model=EntityClaimPage,
    )
    def entity_claims(
        entity_id: str,
        session: SessionDependency,
        scope: Annotated[Literal["current", "history", "all"], Query()] = "current",
        topic: str | None = None,
        cursor: str | None = None,
        limit: Annotated[int, Query(ge=1, le=50)] = 10,
    ) -> EntityClaimPage:
        public_snapshot = get_public_snapshot(session)
        current = [claim for claim in public_snapshot.claims if claim.entity_id == entity_id]
        rows = session.scalars(
            select(ReviewJobRecord).where(
                ReviewJobRecord.entity_id == entity_id,
                ReviewJobRecord.status == "approved",
            )
        ).all()
        historical = [
            repository.approved_claim(row)
            for row in rows
            if row.lifecycle_status != "current" and row.publication_action != "merged-evidence"
        ]
        ordered_current = sorted(
            current,
            key=lambda claim: (claim.updated_at, claim.id),
            reverse=True,
        )
        if scope == "current":
            items = ordered_current
        elif scope == "history":
            items = [*ordered_current[5:], *historical]
        else:
            items = [*ordered_current, *historical]
        if topic:
            topic_key = " ".join(topic.casefold().split())
            items = [
                claim
                for claim in items
                if " ".join((claim.predicate or "").casefold().split()) == topic_key
            ]
        items = sorted(items, key=lambda claim: (claim.updated_at, claim.id), reverse=True)
        if cursor:
            items = [claim for claim in items if f"{claim.updated_at}|{claim.id}" < cursor]
        page_items = items[:limit]
        next_cursor = (
            f"{page_items[-1].updated_at}|{page_items[-1].id}"
            if len(items) > limit and page_items
            else None
        )
        evidence_by_id = {item.id: item for item in public_snapshot.evidence}
        for row in rows:
            for evidence in repository.approved_evidence(row):
                evidence_by_id[evidence.id] = evidence
        source_ids = {source_id for claim in page_items for source_id in claim.source_ids}
        return EntityClaimPage(
            items=page_items,
            evidence=[
                evidence_by_id[item_id] for item_id in source_ids if item_id in evidence_by_id
            ],
            next_cursor=next_cursor,
        )

    @app.get("/api/v2/model-families", response_model=list[Entity])
    def model_families(session: SessionDependency) -> list[Entity]:
        return [
            item
            for item in get_public_snapshot(session).entities
            if item.type == "model" and item.family_id is None
        ]

    @app.get("/api/v2/model-families/{family_id}/versions", response_model=list[Entity])
    def model_family_versions(family_id: str, session: SessionDependency) -> list[Entity]:
        snapshot = get_public_snapshot(session)
        family = next(
            (
                item
                for item in snapshot.entities
                if item.id == family_id and item.type == "model" and item.family_id is None
            ),
            None,
        )
        if not family:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Model family not found.",
            )
        return sorted(
            [item for item in snapshot.entities if item.family_id == family_id],
            key=lambda item: item.first_released_at or "",
        )

    @app.post("/api/v2/model-versions/compare", response_model=list[Entity])
    def compare_model_versions(
        payload: ModelVersionCompareRequest,
        session: SessionDependency,
    ) -> list[Entity]:
        if len(set(payload.version_ids)) != len(payload.version_ids):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Each compared version must be unique.",
            )
        snapshot = get_public_snapshot(session)
        entity_by_id = {item.id: item for item in snapshot.entities}
        versions: list[Entity] = []
        for version_id in payload.version_ids:
            entity = entity_by_id.get(version_id)
            if not entity or entity.type != "model" or entity.family_id is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Concrete model version not found: {version_id}",
                )
            versions.append(entity)
        return versions

    @app.get("/api/v2/entities/{entity_id}/timeline", response_model=list[TimelineEntry])
    def entity_timeline(entity_id: str, session: SessionDependency) -> list[TimelineEntry]:
        return get_public_snapshot(session).timeline.get(entity_id, [])

    @app.get("/api/v2/entities/{entity_id}/neighbors", response_model=GraphSnapshot)
    def entity_neighbors(entity_id: str, session: SessionDependency) -> GraphSnapshot:
        graph = get_public_snapshot(session).graph
        if not any(node.entity_id == entity_id for node in graph.nodes):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")
        edges = [
            edge for edge in graph.edges if edge.from_id == entity_id or edge.to_id == entity_id
        ]
        entity_ids = {entity_id} | {edge.from_id for edge in edges} | {edge.to_id for edge in edges}
        return GraphSnapshot(
            nodes=[node for node in graph.nodes if node.entity_id in entity_ids],
            edges=edges,
            captured_at=graph.captured_at,
            valid_at=graph.valid_at,
        )

    @app.get("/api/v2/entities/{entity_type}/{slug}", response_model=Entity)
    def entity_detail(
        entity_type: str,
        slug: str,
        session: SessionDependency,
    ) -> Entity:
        entity = next(
            (
                item
                for item in get_public_snapshot(session).entities
                if item.type == entity_type and item.slug == slug
            ),
            None,
        )
        if not entity:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")
        return entity

    @app.post("/api/v2/graph/query", response_model=GraphSnapshot)
    def graph_query(query: GraphQuery, session: SessionDependency) -> GraphSnapshot:
        graph = get_public_snapshot(session).graph
        nodes = [
            node
            for node in graph.nodes
            if not query.entity_types or node.type in query.entity_types
        ]
        entity_ids = {node.entity_id for node in nodes}
        edges = [
            edge
            for edge in graph.edges
            if edge.from_id in entity_ids
            and edge.to_id in entity_ids
            and (not query.confidences or edge.confidence in query.confidences)
            and (not query.relation_kinds or edge.kind in query.relation_kinds)
            and (not query.valid_at or not edge.valid_from or edge.valid_from <= query.valid_at)
            and (not query.valid_at or not edge.valid_to or edge.valid_to >= query.valid_at)
        ]
        return GraphSnapshot(
            nodes=nodes,
            edges=edges,
            captured_at=graph.captured_at,
            valid_at=query.valid_at or graph.valid_at,
        )

    @app.post(
        "/api/v2/admin/entities",
        response_model=Entity,
        status_code=status.HTTP_201_CREATED,
    )
    def upsert_catalog_entity(
        payload: Entity,
        principal: AdminDependency,
        session: SessionDependency,
    ) -> Entity:
        try:
            entity = repository.upsert_entity(session, payload)
            audit.record(
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

    @app.post(
        "/api/v2/admin/relations",
        response_model=GraphEdge,
        status_code=status.HTTP_201_CREATED,
    )
    def upsert_catalog_relation(
        payload: GraphEdge,
        principal: AdminDependency,
        session: SessionDependency,
    ) -> GraphEdge:
        try:
            edge = repository.upsert_relation(session, payload)
            audit.record(
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

    @app.post(
        "/api/v2/admin/entities/{entity_id}/timeline",
        response_model=TimelineEntry,
        status_code=status.HTTP_201_CREATED,
    )
    def upsert_catalog_timeline(
        entity_id: str,
        payload: TimelineEntry,
        principal: AdminDependency,
        session: SessionDependency,
    ) -> TimelineEntry:
        try:
            entry = repository.upsert_timeline(session, entity_id, payload)
            audit.record(
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

    @app.get("/api/v2/admin/sources", response_model=list[SourceView])
    def list_sources(
        _: AdminDependency,
        session: SessionDependency,
    ) -> list[SourceView]:
        return ingestion.list_sources(session)

    @app.post(
        "/api/v2/admin/sources",
        response_model=SourceView,
        status_code=status.HTTP_201_CREATED,
    )
    def create_source(
        payload: SourceCreate,
        principal: AdminDependency,
        session: SessionDependency,
    ) -> SourceView:
        try:
            source = ingestion.create_source(session, payload)
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
                detail="A source with this id or normalized URL already exists.",
            ) from error
        audit.record(session, principal, "source.create", "source", source.id)
        session.commit()
        return source

    @app.patch(
        "/api/v2/admin/sources/{source_id}",
        response_model=SourceView,
    )
    def update_source(
        source_id: str,
        payload: SourceUpdate,
        principal: AdminDependency,
        session: SessionDependency,
    ) -> SourceView:
        try:
            source = ingestion.update_source(session, source_id, payload)
        except ValueError as error:
            session.rollback()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=str(error),
            ) from error
        if not source:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found.")
        audit.record(
            session,
            principal,
            "source.update",
            "source",
            source.id,
            {
                "active": source.active,
                "fetchEnabled": source.fetch_enabled,
                "fetchIntervalMinutes": source.fetch_interval_minutes,
                "fetchUrl": source.fetch_url,
                "fallbackUrlCount": len(source.fallback_urls),
                "autoPausedAt": (
                    source.auto_paused_at.isoformat() if source.auto_paused_at else None
                ),
            },
        )
        session.commit()
        return source

    @app.post(
        "/api/v2/admin/sources/{source_id}/probe",
        response_model=SourceProbeResult,
    )
    def probe_source(
        source_id: str,
        principal: AdminDependency,
        session: SessionDependency,
    ) -> SourceProbeResult:
        source = session.get(SourceRecord, source_id)
        if not source:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found.")
        try:
            document = None
            probed_url = None
            last_error: Exception | None = None
            for candidate_url in source_fetch_urls(source):
                try:
                    document = fetcher.fetch(candidate_url)
                    probed_url = candidate_url
                    break
                except (FetchPolicyError, httpx.HTTPError, OSError) as error:
                    last_error = error
            if document is None or probed_url is None:
                raise last_error or FetchPolicyError("Source has no configured collection URL.")
        except (FetchPolicyError, httpx.HTTPError, OSError) as error:
            source.last_probe_at = datetime.now(UTC)
            source.last_probe_status = "failed"
            source.last_probe_error = str(error)[:2000]
            source.failure_kind = classify_fetch_failure(error)
            source.last_probe_content_type = None
            source.last_probe_readable_characters = None
            audit.record(
                session,
                principal,
                "source.probe.failed",
                "source",
                source.id,
                {"errorType": type(error).__name__},
            )
            session.commit()
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Source preflight failed: {error}",
            ) from error
        source.last_probe_at = datetime.now(UTC)
        source.last_probe_status = "passed"
        source.last_probe_error = None
        source.failure_kind = None
        source.last_probe_content_type = document.content_type
        source.last_probe_readable_characters = len(document.content)
        final_url = normalize_source_url(document.final_url or probed_url)
        if final_url != probed_url:
            previous_url = probed_url
            if normalize_source_url(probed_url) == normalize_source_url(source.url):
                source.url = final_url
            elif source.fetch_url and normalize_source_url(probed_url) == normalize_source_url(
                source.fetch_url
            ):
                source.fetch_url = final_url
            audit.record(
                session,
                principal,
                "source.canonical_url_adopted",
                "source",
                source.id,
                {"previousUrl": previous_url, "canonicalUrl": final_url},
            )
        audit.record(
            session,
            principal,
            "source.probe",
            "source",
            source.id,
            {
                "contentType": document.content_type,
                "readableCharacters": len(document.content),
            },
        )
        session.commit()
        return SourceProbeResult(
            source_id=source.id,
            url=final_url,
            content_type=document.content_type,
            readable_characters=len(document.content),
            etag=document.etag,
            last_modified=document.last_modified,
        )

    @app.post(
        "/api/v2/admin/sources/{source_id}/retry",
        response_model=SourceView,
    )
    def retry_source(
        source_id: str,
        payload: SourceRetryRequest,
        principal: AdminDependency,
        session: SessionDependency,
    ) -> SourceView:
        try:
            source = ingestion.queue_source_retry(
                session,
                source_id,
                payload.expected_failure_count,
            )
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(error),
            ) from error
        if source is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found.")
        audit.record(
            session,
            principal,
            "source.retry",
            "source",
            source.id,
            {"consecutiveFailures": source.consecutive_failures},
        )
        session.commit()
        return source

    @app.post(
        "/api/v2/admin/sources/{source_id}/snapshots",
        response_model=IngestionResult,
    )
    def ingest_source_snapshot(
        source_id: str,
        payload: DocumentIngestRequest,
        principal: AdminDependency,
        session: SessionDependency,
    ) -> IngestionResult:
        result = ingestion.ingest_document(session, source_id, payload)
        if not result:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found.")
        audit.record(
            session,
            principal,
            "source.ingest",
            "source",
            source_id,
            {"changeType": result.change_type, "snapshotId": result.snapshot_id},
        )
        session.commit()
        return result

    @app.get(
        "/api/v2/admin/sources/{source_id}/snapshots",
        response_model=list[DocumentSnapshotView],
    )
    def list_source_snapshots(
        source_id: str,
        _: AdminDependency,
        session: SessionDependency,
        limit: Annotated[int, Query(ge=1, le=20)] = 5,
    ) -> list[DocumentSnapshotView]:
        if not session.get(SourceRecord, source_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found.")
        rows = session.scalars(
            select(DocumentSnapshotRecord)
            .where(DocumentSnapshotRecord.source_id == source_id)
            .order_by(
                DocumentSnapshotRecord.observed_at.desc(),
                DocumentSnapshotRecord.id.desc(),
            )
            .limit(limit)
        ).all()
        return [
            DocumentSnapshotView(
                id=row.id,
                source_id=row.source_id,
                content_hash=row.content_hash,
                content_preview=row.content_text[:4000],
                readable_characters=len(row.content_text),
                observed_at=row.observed_at,
                published_at=row.published_at,
                previous_snapshot_id=row.previous_snapshot_id,
            )
            for row in rows
        ]

    @app.get("/api/v2/admin/ingestion-runs", response_model=list[IngestionRunView])
    def list_ingestion_runs(
        _: AdminDependency,
        session: SessionDependency,
        source_id: Annotated[str | None, Query(alias="sourceId")] = None,
        limit: Annotated[int, Query(ge=1, le=500)] = 200,
    ) -> list[IngestionRunView]:
        return ingestion.list_runs(session, source_id, limit)

    @app.get(
        "/api/v2/admin/extraction-plan",
        response_model=list[ExtractionPlanItem],
    )
    def extraction_plan(
        response: Response,
        _: AdminDependency,
        session: SessionDependency,
        limit: Annotated[int, Query(ge=1, le=50)] = 20,
    ) -> list[ExtractionPlanItem]:
        response.headers["Cache-Control"] = "no-store"
        return [
            ExtractionPlanItem(
                source_id=source.id,
                source_title=source.title,
                snapshot_id=snapshot_row.id,
                observed_at=snapshot_row.observed_at,
                readable_characters=len(snapshot_row.content_text),
            )
            for source, snapshot_row in build_extraction_plan(session, limit)
        ]

    @app.post(
        "/api/v2/admin/sources/{source_id}/extract",
        response_model=list[ReviewQueueItem],
    )
    def extract_source_candidates(
        source_id: str,
        payload: ExtractionRequest,
        principal: AdminDependency,
        session: SessionDependency,
    ) -> list[ReviewQueueItem]:
        source = session.get(SourceRecord, source_id)
        if not source:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found.")
        statement = select(DocumentSnapshotRecord).where(
            DocumentSnapshotRecord.source_id == source_id
        )
        if payload.snapshot_id:
            statement = statement.where(DocumentSnapshotRecord.id == payload.snapshot_id)
        snapshot_row = session.scalars(
            statement.order_by(DocumentSnapshotRecord.observed_at.desc()).limit(1)
        ).first()
        if not snapshot_row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No source snapshot is available for extraction.",
            )
        try:
            created, duplicates_skipped = create_extraction_candidates(
                session,
                source,
                snapshot_row,
                payload.max_candidates,
            )
        except ExtractionUnavailableError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
            ) from error
        audit.record(
            session,
            principal,
            "extraction.run",
            "document_snapshot",
            snapshot_row.id,
            {
                "candidatesCreated": len(created),
                "duplicatesSkipped": duplicates_skipped,
                "pipelineVersion": EXTRACTION_PIPELINE_VERSION,
                "sourceId": source_id,
            },
        )
        session.commit()
        return created

    @app.post("/api/v2/admin/ingestion/run", response_model=SchedulerRunSummary)
    def run_ingestion(
        principal: AdminDependency,
        session: SessionDependency,
    ) -> SchedulerRunSummary:
        result = scheduler.run_due(session)
        audit.record(
            session,
            principal,
            "ingestion.run",
            "scheduler",
            "due-cycle",
            result.model_dump(by_alias=True),
        )
        session.commit()
        return result

    @app.post(
        "/api/v2/admin/sources/{source_id}/collect",
        response_model=SchedulerRunSummary,
    )
    def collect_source_now(
        source_id: str,
        principal: AdminDependency,
        session: SessionDependency,
    ) -> SchedulerRunSummary:
        source = session.get(SourceRecord, source_id)
        if not source:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found.")
        if not source.active or not source.fetch_enabled:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Source must be active with automatic collection enabled.",
            )
        result = scheduler.run_due(session, source_id=source_id, force=True, limit=1)
        if result.due == 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Source is already being collected; retry after its lease expires.",
            )
        audit.record(
            session,
            principal,
            "source.collect",
            "source",
            source_id,
            result.model_dump(by_alias=True),
        )
        session.commit()
        return result

    @app.post(
        "/api/v2/admin/review-candidates/assess",
        response_model=CandidateAssessment,
    )
    def assess_review_candidate(
        payload: CandidateCreate,
        _: ReviewerDependency,
        session: SessionDependency,
    ) -> CandidateAssessment:
        return quality_gate.assess(payload, get_catalog_snapshot(session))

    @app.post(
        "/api/v2/admin/review-candidates",
        response_model=ReviewQueueItem,
        status_code=status.HTTP_201_CREATED,
    )
    def submit_review_candidate(
        payload: CandidateCreate,
        principal: ReviewerDependency,
        session: SessionDependency,
    ) -> ReviewQueueItem:
        evidence_ids = {item.id for item in payload.evidence}
        if not set(payload.claim.source_ids).issubset(evidence_ids):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Every claim source id must be included in the submitted evidence.",
            )
        assessment = quality_gate.assess(payload, get_catalog_snapshot(session))
        if assessment.resolved_entity_id and not payload.entity_id:
            payload = payload.model_copy(update={"entity_id": assessment.resolved_entity_id})
        reason = None
        if assessment.conflicting_claim_ids:
            reason = "Structured conflict detected against: " + ", ".join(
                assessment.conflicting_claim_ids
            )
        elif assessment.resolution == "ambiguous":
            reason = "Entity resolution is ambiguous and requires human confirmation."
        row = ingestion.submit_candidate(
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
        audit.record(
            session,
            principal,
            "review.candidate.create",
            "review_job",
            row.id,
            {"claimId": row.claim_id},
        )
        session.commit()
        return repository.to_queue_item(row)

    @app.get("/api/v2/admin/review-queue", response_model=list[ReviewQueueItem])
    def review_queue(
        response: Response,
        _: ReviewerDependency,
        session: SessionDependency,
        scope: Annotated[Literal["open", "history", "all"], Query()] = "all",
        limit: Annotated[int, Query(ge=1, le=500)] = 500,
    ) -> list[ReviewQueueItem]:
        response.headers["Cache-Control"] = "no-store"
        return repository.queue(session, scope=scope, limit=limit)

    @app.get(
        "/api/v2/admin/review-queue-inventory",
        response_model=ReviewInventoryReport,
    )
    def review_queue_inventory(
        _: ReviewerDependency,
        session: SessionDependency,
    ) -> ReviewInventoryReport:
        open_items = repository.queue(session, scope="open", limit=500)
        published_rows = session.scalars(
            select(ReviewJobRecord).where(
                ReviewJobRecord.status == "approved",
                ReviewJobRecord.lifecycle_status == "current",
                ReviewJobRecord.publication_action != "merged-evidence",
            )
        ).all()
        published_fingerprints = {
            claim_semantic_fingerprint(repository.approved_claim(row), row.entity_id)
            for row in published_rows
        }
        by_entity: dict[str, int] = {}
        by_source: dict[str, int] = {}
        by_month: dict[str, int] = {}
        risk_counts = {"standard": 0, "high": 0}
        fingerprints: dict[tuple[str, str, str, str, str], int] = {}
        update_values: dict[tuple[str, str, str], set[str]] = {}
        conflict_items = 0
        missing_evidence_items = 0
        invalid_anchor_items = 0
        stale_items = 0
        duplicate_with_published_items = 0
        now = datetime.now(UTC)
        high_risk_predicates = {
            "price",
            "pricing",
            "availability",
            "context-window",
            "benchmark",
            "released-at",
            "deprecated-at",
        }

        for item in open_items:
            entity_key = item.entity_id or "未解析实体"
            by_entity[entity_key] = by_entity.get(entity_key, 0) + 1
            month = item.created_at[:7]
            by_month[month] = by_month.get(month, 0) + 1
            publishers = {evidence.publisher for evidence in item.evidence_items} or {"缺少信源"}
            for publisher in publishers:
                by_source[publisher] = by_source.get(publisher, 0) + 1

            predicate = " ".join((item.claim.predicate or "").casefold().split())
            subject = " ".join((item.claim.subject or "").casefold().split())
            value = " ".join((item.claim.object_or_value or "").casefold().split())
            high_risk = bool(
                item.conflict_claim_ids
                or predicate in high_risk_predicates
                or any(evidence.type == "community" for evidence in item.evidence_items)
            )
            risk_counts["high" if high_risk else "standard"] += 1
            conflict_items += int(bool(item.conflict_claim_ids))
            missing_evidence_items += int(not item.evidence_items)
            anchored = bool(
                subject
                and value
                and any(
                    subject in " ".join((evidence.source_excerpt or "").casefold().split())
                    and value in " ".join((evidence.source_excerpt or "").casefold().split())
                    for evidence in item.evidence_items
                )
            )
            invalid_anchor_items += int(not anchored)
            try:
                created_at = datetime.fromisoformat(item.created_at)
                if created_at.tzinfo is None:
                    created_at = created_at.replace(tzinfo=UTC)
                stale_items += int(now - created_at.astimezone(UTC) > timedelta(days=90))
            except ValueError:
                stale_items += 1

            fingerprint = claim_semantic_fingerprint(item.claim, item.entity_id)
            fingerprints[fingerprint] = fingerprints.get(fingerprint, 0) + 1
            duplicate_with_published_items += int(fingerprint in published_fingerprints)
            update_key = (entity_key.casefold(), subject, predicate)
            update_values.setdefault(update_key, set()).add(value)

        return ReviewInventoryReport(
            generated_at=now.isoformat(),
            open_total=len(open_items),
            by_entity=dict(sorted(by_entity.items(), key=lambda pair: (-pair[1], pair[0]))),
            by_source=dict(sorted(by_source.items(), key=lambda pair: (-pair[1], pair[0]))),
            by_month=dict(sorted(by_month.items())),
            risk_counts=risk_counts,
            deterministic_duplicate_groups=sum(count > 1 for count in fingerprints.values()),
            possible_update_groups=sum(len(values) > 1 for values in update_values.values()),
            conflict_items=conflict_items,
            missing_evidence_items=missing_evidence_items,
            invalid_anchor_items=invalid_anchor_items,
            stale_items=stale_items,
            duplicate_with_published_items=duplicate_with_published_items,
        )

    @app.get(
        "/api/v2/admin/claim-entity-audit",
        response_model=ClaimEntityAuditReport,
    )
    def claim_entity_audit(
        response: Response,
        _: ReviewerDependency,
        session: SessionDependency,
    ) -> ClaimEntityAuditReport:
        response.headers["Cache-Control"] = "no-store"
        report = audit_claim_entity_links(get_catalog_snapshot(session))
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

    def approved_relation_rows(
        session: Session,
        claim_ids: list[str] | None = None,
    ) -> list[ReviewJobRecord]:
        statement = select(ReviewJobRecord).where(
            ReviewJobRecord.status == "approved",
            ReviewJobRecord.publication_action != "merged-evidence",
        )
        if claim_ids:
            statement = statement.where(ReviewJobRecord.claim_id.in_(claim_ids))
        rows = session.scalars(
            statement.order_by(ReviewJobRecord.created_at, ReviewJobRecord.id).limit(500)
        ).all()
        relation_rows: list[ReviewJobRecord] = []
        for row in rows:
            try:
                claim = Claim.model_validate_json(row.claim_json)
            except (ValueError, TypeError, json.JSONDecodeError):
                if claim_ids:
                    relation_rows.append(row)
                continue
            predicate_key = " ".join((claim.predicate or "").casefold().split())
            if predicate_key in RELATION_PREDICATES:
                relation_rows.append(row)
        return relation_rows

    def assess_historical_relation_claim(
        session: Session,
        row: ReviewJobRecord,
        snapshot: KnowledgeSnapshot,
    ) -> tuple[RelationClaimAuditItem, GraphEdge | None]:
        try:
            claim = Claim.model_validate_json(row.claim_json)
        except (ValueError, TypeError, json.JSONDecodeError):
            return (
                RelationClaimAuditItem(
                    review_job_id=row.id,
                    claim_id=row.claim_id,
                    source_entity_id=row.entity_id,
                    status="invalid",
                    reason="Claim 结构无效，必须先人工修复原始记录。",
                ),
                None,
            )

        predicate_key = " ".join((claim.predicate or "").casefold().split())
        relation_kind = RELATION_PREDICATES.get(predicate_key)
        if relation_kind is None:
            return (
                RelationClaimAuditItem(
                    review_job_id=row.id,
                    claim_id=row.claim_id,
                    source_entity_id=row.entity_id,
                    predicate=claim.predicate,
                    target_reference=claim.object_or_value,
                    status="invalid",
                    reason="该 Claim 不是受支持的关系谓词。",
                ),
                None,
            )

        entity_ids = {entity.id for entity in snapshot.entities}
        if row.entity_id not in entity_ids:
            return (
                RelationClaimAuditItem(
                    review_job_id=row.id,
                    claim_id=row.claim_id,
                    source_entity_id=row.entity_id,
                    predicate=claim.predicate,
                    target_reference=claim.object_or_value,
                    relation_kind=relation_kind,
                    status="review-required",
                    reason="关系 Claim 缺少合法源实体，必须先完成实体关联修复。",
                ),
                None,
            )

        proposed = repository.relation_from_approved_claim(session, row, snapshot)
        if proposed is None:
            return (
                RelationClaimAuditItem(
                    review_job_id=row.id,
                    claim_id=row.claim_id,
                    source_entity_id=row.entity_id,
                    predicate=claim.predicate,
                    target_reference=claim.object_or_value,
                    relation_kind=relation_kind,
                    status="review-required",
                    reason="关系目标未唯一解析到现有实体，不能自动生成图谱边。",
                ),
                None,
            )

        target_entity_id = proposed.to_id if proposed.from_id == row.entity_id else proposed.from_id
        existing = next((edge for edge in snapshot.graph.edges if edge.id == proposed.id), None)
        if existing is None:
            status_value: Literal["repairable", "linked"] = "repairable"
            reason = "已审核关系 Claim 可唯一解析，图谱中尚无对应关系，可以确定性补建。"
        elif existing.confidence != proposed.confidence or set(existing.source_ids) != set(
            proposed.source_ids
        ):
            status_value = "repairable"
            reason = "图谱关系已存在，但需要确定性合并该 Claim 的 Evidence。"
        else:
            status_value = "linked"
            reason = "关系 Claim 已完整发布到图谱，无需修复。"
        return (
            RelationClaimAuditItem(
                review_job_id=row.id,
                claim_id=row.claim_id,
                source_entity_id=row.entity_id,
                predicate=claim.predicate,
                target_reference=claim.object_or_value,
                proposed_target_entity_id=target_entity_id,
                relation_id=proposed.id,
                relation_kind=proposed.kind,
                status=status_value,
                reason=reason,
            ),
            proposed,
        )

    @app.get(
        "/api/v2/admin/relation-claim-audit",
        response_model=RelationClaimAuditReport,
    )
    def relation_claim_audit(
        response: Response,
        _: ReviewerDependency,
        session: SessionDependency,
    ) -> RelationClaimAuditReport:
        response.headers["Cache-Control"] = "no-store"
        snapshot = get_catalog_snapshot(session)
        items = [
            assess_historical_relation_claim(session, row, snapshot)[0]
            for row in approved_relation_rows(session)
        ]
        return RelationClaimAuditReport(
            generated_at=datetime.now(UTC),
            total_relation_claims=len(items),
            linked_count=sum(item.status == "linked" for item in items),
            repairable_count=sum(item.status == "repairable" for item in items),
            manual_review_count=sum(
                item.status in {"review-required", "invalid"} for item in items
            ),
            items=items,
        )

    @app.post(
        "/api/v2/admin/relation-claim-repair",
        response_model=RelationClaimRepairReport,
    )
    def repair_historical_relations(
        payload: RelationClaimRepairRequest,
        principal: AdminDependency,
        session: SessionDependency,
    ) -> RelationClaimRepairReport:
        if payload.mode == "apply" and not payload.claim_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Apply mode requires an explicit list of at most 50 relation claim ids.",
            )

        snapshot = get_catalog_snapshot(session)
        rows = approved_relation_rows(session, payload.claim_ids or None)
        items: list[RelationClaimRepairItem] = []
        repairable_count = 0
        repaired_count = 0
        for row in rows:
            assessment, proposed = assess_historical_relation_claim(session, row, snapshot)
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
                repository.upsert_relation(session, proposed)
                audit.record(
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

    @app.post(
        "/api/v2/admin/claim-entity-repair",
        response_model=ClaimEntityRepairReport,
    )
    def repair_claim_entities(
        payload: ClaimEntityRepairRequest,
        principal: AdminDependency,
        session: SessionDependency,
    ) -> ClaimEntityRepairReport:
        if payload.mode == "apply" and not payload.claim_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Apply mode requires an explicit list of at most 50 claim ids.",
            )

        snapshot = get_catalog_snapshot(session)
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
                audit.record(
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

    @app.post(
        "/api/v2/admin/claim-entity-resolution",
        response_model=ClaimEntityResolutionResult,
    )
    def resolve_claim_entity_manually(
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

        snapshot = get_catalog_snapshot(session)
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
            row.claim_json = claim.model_copy(
                update={"entity_id": payload.entity_id}
            ).model_dump_json(by_alias=True)
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
            relation = repository.relation_from_approved_claim(session, row)
            if relation is not None:
                repository.upsert_relation(session, relation)
                relation_id = relation.id
        audit.record(
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

    @app.get(
        "/api/v2/admin/release-baseline",
        response_model=ReleaseBaseline,
    )
    def release_baseline(
        response: Response,
        principal: AdminDependency,
        session: SessionDependency,
    ) -> ReleaseBaseline:
        response.headers["Cache-Control"] = "no-store"
        snapshot = get_catalog_snapshot(session)
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

        quality = get_quality_report(session)
        golden = quality.golden_questions or get_golden_question_report(session)
        sources = ingestion.list_sources(session)
        source_health = {
            state: sum(source.health_state == state for source in sources)
            for state in ("healthy", "retrying", "paused", "manual", "unverified")
        }
        return ReleaseBaseline(
            generated_at=datetime.now(UTC),
            build=health(),
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
            review_queue=review_queue_inventory(principal, session),
            operations=operations.diagnostics(
                session,
                app_settings.worker_id,
                run_limit=20,
            ),
            source_health=source_health,
            integrations=integration_status(principal, session),
            readiness=production_readiness(Response(), principal, session),
        )

    def decide_review(
        review_id: str,
        decision: ReviewDecision,
        action: Literal["approved", "rejected"],
        actor: Principal,
        session: Session,
        *,
        commit: bool = True,
        batch_safe_only: bool = False,
    ) -> ReviewQueueItem:
        row = session.scalar(
            select(ReviewJobRecord).where(ReviewJobRecord.id == review_id).with_for_update()
        )
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Review job not found."
            )
        if row.status not in OPEN_REVIEW_STATUSES:
            if row.status == action:
                return repository.to_queue_item(row)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Review job is already {row.status}.",
            )
        queue_item = repository.to_queue_item(row)

        if batch_safe_only and (
            row.status != "pending"
            or json.loads(row.conflict_ids_json or "[]")
            or not review_item_has_anchored_excerpt(queue_item)
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=("Review job requires an anchored source excerpt and individual review."),
            )
        if row.version != decision.expected_version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Review job version is {row.version}; refresh before deciding.",
            )
        if action == "approved" and not queue_item.evidence_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="A claim cannot be published without evidence.",
            )
        if action == "approved":
            require_publishable_entity(row, session)
        row.status = action
        row.review_reason = decision.reason
        row.reviewed_at = datetime.now(UTC)
        row.reviewed_by = actor.email
        row.version += 1
        published_relation = None
        if action == "approved":
            repository.persist_approved_verification(row)
            queue_item = repository.to_queue_item(row)
            published_relation = repository.relation_from_approved_claim(session, row)
            if published_relation:
                repository.upsert_relation(session, published_relation)
            session.add(
                PublicationRecordRow(
                    review_job_id=row.id,
                    claim_id=row.claim_id,
                    published_at=row.reviewed_at,
                    actor=actor.email,
                )
            )
            notifications_created = engagement.notify_followers(
                session,
                row.entity_id,
                row.claim_id,
                queue_item.claim.text.zh,
            )
        else:
            notifications_created = 0
        audit.record(
            session,
            actor,
            f"review.{action}",
            "review_job",
            row.id,
            {
                "claimId": row.claim_id,
                "reason": decision.reason,
                "notificationsCreated": notifications_created,
                "relationId": published_relation.id if published_relation else None,
            },
        )
        if commit:
            session.commit()
        return repository.to_queue_item(row)

    def decide_claim_lifecycle(
        review_id: str,
        decision: ReviewLifecycleDecision,
        publication_action: Literal["merged-evidence", "superseding"],
        actor: Principal,
        session: Session,
        *,
        commit: bool = True,
    ) -> ReviewQueueItem:
        row = session.scalar(
            select(ReviewJobRecord).where(ReviewJobRecord.id == review_id).with_for_update()
        )
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Review job not found.",
            )
        if row.decision_idempotency_key:
            if (
                row.decision_idempotency_key == decision.idempotency_key
                and row.publication_action == publication_action
                and row.target_claim_id == decision.target_claim_id
            ):
                return repository.to_queue_item(row)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Review job already has a different lifecycle decision.",
            )
        if row.status not in OPEN_REVIEW_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Review job is already {row.status}.",
            )
        if row.version != decision.expected_version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Review job version is {row.version}; refresh before deciding.",
            )
        queue_item = repository.to_queue_item(row)
        require_publishable_entity(row, session)
        if not queue_item.evidence_items:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="A claim cannot be published without evidence.",
            )

        key_owner = session.scalar(
            select(ReviewJobRecord).where(
                ReviewJobRecord.decision_idempotency_key == decision.idempotency_key
            )
        )
        if key_owner is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Idempotency key is already used by another review decision.",
            )
        target = session.scalars(
            select(ReviewJobRecord)
            .where(
                ReviewJobRecord.claim_id == decision.target_claim_id,
                ReviewJobRecord.status == "approved",
                ReviewJobRecord.lifecycle_status == "current",
                ReviewJobRecord.publication_action != "merged-evidence",
            )
            .order_by(ReviewJobRecord.created_at.desc())
            .with_for_update()
        ).first()
        if target is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Current approved target claim not found.",
            )
        if target.id == row.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A review job cannot target itself.",
            )
        if target.version != decision.expected_target_version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Target claim version is {target.version}; refresh before deciding.",
            )

        candidate_claim = queue_item.claim
        target_claim = repository.approved_claim(target)
        candidate_subject = " ".join((candidate_claim.subject or "").casefold().split())
        target_subject = " ".join((target_claim.subject or "").casefold().split())
        candidate_predicate = " ".join((candidate_claim.predicate or "").casefold().split())
        target_predicate = " ".join((target_claim.predicate or "").casefold().split())
        if publication_action == "merged-evidence":
            if claim_semantic_fingerprint(
                candidate_claim, row.entity_id
            ) != claim_semantic_fingerprint(target_claim, target.entity_id):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Evidence can only be merged into the same semantic claim.",
                )
        elif (
            row.entity_id != target.entity_id
            or not candidate_subject
            or candidate_subject != target_subject
            or not candidate_predicate
            or candidate_predicate != target_predicate
            or candidate_claim.object_or_value == target_claim.object_or_value
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A superseding claim must change the value of the same entity fact.",
            )

        now = datetime.now(UTC)
        row.status = "approved"
        row.review_reason = decision.reason
        row.reviewed_at = now
        row.reviewed_by = actor.email
        row.version += 1
        row.publication_action = publication_action
        row.target_review_job_id = target.id
        row.target_claim_id = target.claim_id
        row.decision_idempotency_key = decision.idempotency_key

        notifications_created = 0
        published_relation = None
        if publication_action == "merged-evidence":
            row.lifecycle_status = "historical"
            incoming_evidence = [
                evidence.model_copy(
                    update={
                        "supports_claim_ids": list(
                            dict.fromkeys([*(evidence.supports_claim_ids or []), target.claim_id])
                        )
                    }
                )
                for evidence in queue_item.evidence_items
            ]
            row.evidence_json = json.dumps(
                [item.model_dump(mode="json", by_alias=True) for item in incoming_evidence],
                ensure_ascii=False,
            )
            existing_evidence = repository.approved_evidence(target)
            evidence_by_id = {item.id: item for item in existing_evidence}
            evidence_by_id.update({item.id: item for item in incoming_evidence})
            merged_evidence = list(evidence_by_id.values())
            merged_claim = target_claim.model_copy(
                update={
                    "source_ids": list(
                        dict.fromkeys(
                            [
                                *target_claim.source_ids,
                                *(item.id for item in incoming_evidence),
                            ]
                        )
                    )
                }
            )
            target.reviewed_at = now
            target.reviewed_by = actor.email
            target.version += 1
            target.claim_json = merged_claim.model_dump_json(by_alias=True)
            target.evidence_ids_json = json.dumps(merged_claim.source_ids, ensure_ascii=False)
            target.evidence_json = json.dumps(
                [item.model_dump(mode="json", by_alias=True) for item in merged_evidence],
                ensure_ascii=False,
            )
            repository.persist_approved_verification(target)
        else:
            row.lifecycle_status = "current"
            target.lifecycle_status = "superseded"
            target.superseded_by_claim_id = row.claim_id
            target.reviewed_at = now
            target.reviewed_by = actor.email
            target.version += 1
            target_claim = target_claim.model_copy(
                update={"valid_to": candidate_claim.valid_from or now.date().isoformat()}
            )
            target.claim_json = target_claim.model_dump_json(by_alias=True)
            repository.persist_approved_verification(target)
            repository.persist_approved_verification(row)
            published_relation = repository.relation_from_approved_claim(session, row)
            if published_relation:
                repository.upsert_relation(session, published_relation)
            session.add(
                PublicationRecordRow(
                    review_job_id=row.id,
                    claim_id=row.claim_id,
                    published_at=now,
                    actor=actor.email,
                )
            )
            notifications_created = engagement.notify_followers(
                session,
                row.entity_id,
                row.claim_id,
                repository.approved_claim(row).text.zh,
            )

        audit.record(
            session,
            actor,
            f"review.{publication_action.replace('-', '_')}",
            "review_job",
            row.id,
            {
                "claimId": row.claim_id,
                "targetClaimId": target.claim_id,
                "reason": decision.reason,
                "notificationsCreated": notifications_created,
                "relationId": published_relation.id if published_relation else None,
            },
        )
        if commit:
            try:
                session.commit()
            except IntegrityError as error:
                session.rollback()
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Lifecycle decision conflicts with a concurrent request.",
                ) from error
        else:
            session.flush()
        return repository.to_queue_item(row)

    @app.post(
        "/api/v2/admin/review-queue/batch-approve",
        response_model=list[ReviewQueueItem],
    )
    def batch_approve_reviews(
        approval: ReviewBatchApproval,
        actor: ReviewerDependency,
        session: SessionDependency,
    ) -> list[ReviewQueueItem]:
        item_ids = [item.id for item in approval.items]
        if len(item_ids) != len(set(item_ids)):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="A review job can appear only once in a batch.",
            )
        decisions: list[ReviewQueueItem] = []
        try:
            for item in approval.items:
                decisions.append(
                    decide_review(
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

    @app.post(
        "/api/v2/admin/review-queue/batch-merge-duplicates",
        response_model=list[ReviewQueueItem],
    )
    def batch_merge_duplicate_reviews(
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
                repository.approved_claim(target),
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
                item = repository.to_queue_item(row)
                target = targets_by_fingerprint.get(
                    claim_semantic_fingerprint(item.claim, item.entity_id)
                )
                if target is None or target.id == row.id:
                    continue
                digest = hashlib.sha256(f"{row.id}:{row.version}".encode()).hexdigest()[:32]
                merged.append(
                    decide_claim_lifecycle(
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

    @app.post(
        "/api/v2/admin/review-queue/batch-reject-invalid",
        response_model=list[ReviewQueueItem],
    )
    def batch_reject_invalid_reviews(
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
                item = repository.to_queue_item(row)
                if not review_item_is_deterministically_invalid(item):
                    continue
                rejected.append(
                    decide_review(
                        row.id,
                        ReviewDecision(
                            expected_version=row.version,
                            reason=(
                                "确定性队列治理：候选缺少可发布实体、直接证据或可定位原文锚点。"
                            ),
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

    @app.post(
        "/api/v2/admin/review-queue/batch-verify-automation",
        response_model=list[ReviewQueueItem],
    )
    def batch_verify_automation_reviews(
        verification: ReviewBatchApproval,
        actor: ReviewerDependency,
        session: SessionDependency,
    ) -> list[ReviewQueueItem]:
        item_ids = [item.id for item in verification.items]
        if len(item_ids) != len(set(item_ids)):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
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
                    verified.append(repository.to_queue_item(row))
                    continue
                if row.status != "approved" or row.reviewed_by != "automation@ai-radar.local":
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=(
                            "Only an approved automation review can receive human verification."
                        ),
                    )
                if row.version != item.expected_version:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"Review job version is {row.version}; refresh before verifying.",
                    )
                if not repository.to_queue_item(row).evidence_ids:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail="An approved claim cannot be verified without evidence.",
                    )
                row.reviewed_at = datetime.now(UTC)
                row.reviewed_by = actor.email
                row.review_reason = item.reason
                row.version += 1
                repository.persist_approved_verification(row)
                audit.record(
                    session,
                    actor,
                    "review.human_verified",
                    "review_job",
                    row.id,
                    {"claimId": row.claim_id, "reason": item.reason},
                )
                verified.append(repository.to_queue_item(row))
            session.commit()
        except Exception:
            session.rollback()
            raise
        return verified

    @app.post(
        "/api/v2/admin/review-queue/{review_id}/approve",
        response_model=ReviewQueueItem,
    )
    def approve_review(
        review_id: str,
        decision: ReviewDecision,
        actor: ReviewerDependency,
        session: SessionDependency,
    ) -> ReviewQueueItem:
        return decide_review(review_id, decision, "approved", actor, session)

    @app.post(
        "/api/v2/admin/review-queue/{review_id}/merge-evidence",
        response_model=ReviewQueueItem,
    )
    def merge_review_evidence(
        review_id: str,
        decision: ReviewLifecycleDecision,
        actor: ReviewerDependency,
        session: SessionDependency,
    ) -> ReviewQueueItem:
        return decide_claim_lifecycle(
            review_id,
            decision,
            "merged-evidence",
            actor,
            session,
        )

    @app.post(
        "/api/v2/admin/review-queue/{review_id}/approve-superseding",
        response_model=ReviewQueueItem,
    )
    def approve_superseding_review(
        review_id: str,
        decision: ReviewLifecycleDecision,
        actor: ReviewerDependency,
        session: SessionDependency,
    ) -> ReviewQueueItem:
        return decide_claim_lifecycle(
            review_id,
            decision,
            "superseding",
            actor,
            session,
        )

    @app.post(
        "/api/v2/admin/review-queue/{review_id}/reject",
        response_model=ReviewQueueItem,
    )
    def reject_review(
        review_id: str,
        decision: ReviewDecision,
        actor: ReviewerDependency,
        session: SessionDependency,
    ) -> ReviewQueueItem:
        return decide_review(review_id, decision, "rejected", actor, session)

    @app.get(
        "/api/v2/admin/publication-history",
        response_model=list[PublicationRecord],
    )
    def publication_history(
        _: ReviewerDependency,
        session: SessionDependency,
    ) -> list[PublicationRecord]:
        return repository.publication_history(session)

    return app


app = create_app()
