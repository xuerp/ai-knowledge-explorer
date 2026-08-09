from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from .auth import AuditService, AuthService, Principal
from .config import Settings
from .database import (
    Database,
    DocumentSnapshotRecord,
    PublicationRecordRow,
    ReviewJobRecord,
    SourceRecord,
    UserRecord,
)
from .email_delivery import EmailDeliveryService, EmailDeliveryUnavailableError
from .engagement import EngagementService
from .extraction import ExtractionUnavailableError, StructuredExtractionService
from .fetching import SafeHttpFetcher
from .ingestion import IngestionService
from .operations import OperationsService
from .production_readiness import ProductionReadinessInputs, build_production_readiness
from .quality import KnowledgeQualityGate
from .repository import OPEN_REVIEW_STATUSES, KnowledgeRepository
from .scheduler import IngestionScheduler
from .schemas import (
    AuditLogView,
    BootstrapUser,
    CandidateAssessment,
    CandidateCreate,
    DataQualityReport,
    DigestPreference,
    DigestRunSummary,
    DocumentIngestRequest,
    EmailDeliverySummary,
    EmailOutboxRetryRequest,
    EmailOutboxView,
    Entity,
    ExtractionRequest,
    FollowCreate,
    FollowView,
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
    ResearchCitation,
    ResearchCreate,
    ResearchView,
    ReviewDecision,
    ReviewQueueItem,
    SchedulerRunSummary,
    SourceCreate,
    SourceRetryRequest,
    SourceUpdate,
    SourceView,
    TimelineEntry,
    TokenResponse,
    UserCreate,
    UserView,
)
from .security import require_admin, require_reviewer, require_user

DATABASE_SCHEMA_REVISION = "20260809_0013"


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or Settings.from_env()
    database = Database(app_settings.database_url)
    repository = KnowledgeRepository(app_settings.seed_snapshot_path, app_settings.data_mode)
    ingestion = IngestionService()
    scheduler = IngestionScheduler(
        SafeHttpFetcher(app_settings.fetch_allowed_hosts, app_settings.fetch_max_bytes),
        ingestion,
        retry_base_minutes=app_settings.fetch_retry_base_minutes,
        retry_max_minutes=app_settings.fetch_retry_max_minutes,
        lease_minutes=app_settings.fetch_lease_minutes,
    )
    auth = AuthService(app_settings.jwt_secret, app_settings.access_token_minutes)
    audit = AuditService()
    quality_gate = KnowledgeQualityGate()
    engagement = EngagementService()
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
    operations = OperationsService(app_settings.worker_stale_seconds)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if database.engine.dialect.name == "sqlite":
            database.create_all()
        with database.session() as session:
            repository.seed_catalog(session)
            repository.seed_review_jobs(session)
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

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(
            ok=True,
            environment=app_settings.environment,
            data_mode=app_settings.data_mode,
            database=app_settings.database_url.split(":", 1)[0],
            admin_writes_enabled=bool(app_settings.admin_token or auth.enabled),
            auth_enabled=auth.enabled,
        )

    @app.get("/ready", response_model=HealthResponse)
    def ready(session: SessionDependency) -> HealthResponse:
        try:
            session.execute(text("SELECT 1"))
            if database.engine.dialect.name != "sqlite":
                revision = session.scalar(text("SELECT version_num FROM alembic_version"))
                if revision != DATABASE_SCHEMA_REVISION:
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="Database schema revision is not ready.",
                    )
        except HTTPException:
            raise
        except SQLAlchemyError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Database readiness check failed.",
            ) from error
        return health()

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
        return PublishedResearchView(**result.model_dump(), citations=citations)

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
        return quality_gate.report(get_public_snapshot(session))

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
            extraction_endpoint_host=extraction_host,
            extraction_model=app_settings.extraction_model,
            smtp_configured=bool(app_settings.smtp_host and app_settings.smtp_from),
            smtp_host=app_settings.smtp_host,
            smtp_from=app_settings.smtp_from,
            fetch_allowed_hosts=list(app_settings.fetch_allowed_hosts),
            registered_sources=len(sources),
            automatic_sources=sum(source.fetch_enabled for source in sources),
            digest_timezone=app_settings.digest_timezone,
        )

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
        quality = quality_gate.report(get_public_snapshot(session))
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

    def get_public_snapshot(session: Session) -> KnowledgeSnapshot:
        return repository.public_snapshot(session)

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
        source = ingestion.update_source(session, source_id, payload)
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
            },
        )
        session.commit()
        return source

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

    @app.get("/api/v2/admin/ingestion-runs", response_model=list[IngestionRunView])
    def list_ingestion_runs(
        _: AdminDependency,
        session: SessionDependency,
        source_id: Annotated[str | None, Query(alias="sourceId")] = None,
        limit: Annotated[int, Query(ge=1, le=500)] = 200,
    ) -> list[IngestionRunView]:
        return ingestion.list_runs(session, source_id, limit)

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
            candidates = extraction.extract(source, snapshot_row, payload.max_candidates)
        except ExtractionUnavailableError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(error),
            ) from error
        public_snapshot = get_public_snapshot(session)
        created: list[ReviewQueueItem] = []
        for candidate in candidates:
            assessment = quality_gate.assess(candidate, public_snapshot)
            if assessment.resolved_entity_id:
                candidate = candidate.model_copy(
                    update={"entity_id": assessment.resolved_entity_id}
                )
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
        audit.record(
            session,
            principal,
            "extraction.run",
            "document_snapshot",
            snapshot_row.id,
            {"candidatesCreated": len(created), "sourceId": source_id},
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
        "/api/v2/admin/review-candidates/assess",
        response_model=CandidateAssessment,
    )
    def assess_review_candidate(
        payload: CandidateCreate,
        _: ReviewerDependency,
        session: SessionDependency,
    ) -> CandidateAssessment:
        return quality_gate.assess(payload, get_public_snapshot(session))

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
        assessment = quality_gate.assess(payload, get_public_snapshot(session))
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
        _: ReviewerDependency,
        session: SessionDependency,
    ) -> list[ReviewQueueItem]:
        return repository.queue(session)

    def decide_review(
        review_id: str,
        decision: ReviewDecision,
        action: Literal["approved", "rejected"],
        actor: Principal,
        session: Session,
    ) -> ReviewQueueItem:
        row = session.get(ReviewJobRecord, review_id)
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Review job not found."
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
        if action == "approved" and not repository.to_queue_item(row).evidence_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="A claim cannot be published without evidence.",
            )
        row.status = action
        row.review_reason = decision.reason
        row.reviewed_at = datetime.now(UTC)
        row.version += 1
        if action == "approved":
            queue_item = repository.to_queue_item(row)
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
            },
        )
        session.commit()
        return repository.to_queue_item(row)

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
