from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import Settings
from .database import Database, PublicationRecordRow, ReviewJobRecord
from .ingestion import IngestionService
from .repository import OPEN_REVIEW_STATUSES, KnowledgeRepository
from .schemas import (
    CandidateCreate,
    DocumentIngestRequest,
    Entity,
    GraphQuery,
    GraphSnapshot,
    HealthResponse,
    IngestionResult,
    IngestionRunView,
    KnowledgeSnapshot,
    PublicationRecord,
    ReviewDecision,
    ReviewQueueItem,
    SourceCreate,
    SourceView,
    TimelineEntry,
)
from .security import require_admin_token


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or Settings.from_env()
    database = Database(app_settings.database_url)
    repository = KnowledgeRepository(app_settings.seed_snapshot_path, app_settings.data_mode)
    ingestion = IngestionService()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        database.create_all()
        with database.session() as session:
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
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(app_settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Accept", "Content-Type", "X-Admin-Token"],
    )

    def get_session(request: Request):
        session = request.app.state.database.session()
        try:
            yield session
        finally:
            session.close()

    SessionDependency = Annotated[Session, Depends(get_session)]
    AdminDependency = Annotated[str, Depends(require_admin_token)]

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(
            ok=True,
            environment=app_settings.environment,
            data_mode=app_settings.data_mode,
            database=app_settings.database_url.split(":", 1)[0],
            admin_writes_enabled=bool(app_settings.admin_token),
        )

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
        _: AdminDependency,
        session: SessionDependency,
    ) -> SourceView:
        try:
            return ingestion.create_source(session, payload)
        except IntegrityError as error:
            session.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A source with this id or normalized URL already exists.",
            ) from error

    @app.post(
        "/api/v2/admin/sources/{source_id}/snapshots",
        response_model=IngestionResult,
    )
    def ingest_source_snapshot(
        source_id: str,
        payload: DocumentIngestRequest,
        _: AdminDependency,
        session: SessionDependency,
    ) -> IngestionResult:
        result = ingestion.ingest_document(session, source_id, payload)
        if not result:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found.")
        return result

    @app.get("/api/v2/admin/ingestion-runs", response_model=list[IngestionRunView])
    def list_ingestion_runs(
        _: AdminDependency,
        session: SessionDependency,
        source_id: Annotated[str | None, Query(alias="sourceId")] = None,
    ) -> list[IngestionRunView]:
        return ingestion.list_runs(session, source_id)

    @app.post(
        "/api/v2/admin/review-candidates",
        response_model=ReviewQueueItem,
        status_code=status.HTTP_201_CREATED,
    )
    def submit_review_candidate(
        payload: CandidateCreate,
        _: AdminDependency,
        session: SessionDependency,
    ) -> ReviewQueueItem:
        evidence_ids = {item.id for item in payload.evidence}
        if not set(payload.claim.source_ids).issubset(evidence_ids):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Every claim source id must be included in the submitted evidence.",
            )
        row = ingestion.submit_candidate(session, payload)
        if not row:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A review candidate with this id already exists.",
            )
        return repository.to_queue_item(row)

    @app.get("/api/v2/admin/review-queue", response_model=list[ReviewQueueItem])
    def review_queue(
        _: AdminDependency,
        session: SessionDependency,
    ) -> list[ReviewQueueItem]:
        return repository.queue(session)

    def decide_review(
        review_id: str,
        decision: ReviewDecision,
        action: Literal["approved", "rejected"],
        actor: str,
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
            session.add(
                PublicationRecordRow(
                    review_job_id=row.id,
                    claim_id=row.claim_id,
                    published_at=row.reviewed_at,
                    actor=actor,
                )
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
        actor: AdminDependency,
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
        actor: AdminDependency,
        session: SessionDependency,
    ) -> ReviewQueueItem:
        return decide_review(review_id, decision, "rejected", actor, session)

    @app.get(
        "/api/v2/admin/publication-history",
        response_model=list[PublicationRecord],
    )
    def publication_history(
        _: AdminDependency,
        session: SessionDependency,
    ) -> list[PublicationRecord]:
        return repository.publication_history(session)

    return app


app = create_app()
