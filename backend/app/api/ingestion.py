from datetime import UTC, datetime
from typing import Annotated

import httpx
from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from ..database import (
    DocumentSnapshotRecord,
    SourceRecord,
)
from ..extraction import (
    EXTRACTION_PIPELINE_VERSION,
    ExtractionUnavailableError,
)
from ..fetching import FetchPolicyError, classify_fetch_failure
from ..ingestion import normalize_source_url, source_fetch_urls
from ..schemas import (
    DocumentIngestRequest,
    DocumentSnapshotView,
    ExtractionPlanItem,
    ExtractionRequest,
    IngestionResult,
    IngestionRunView,
    ReviewQueueItem,
    SchedulerRunSummary,
    SourceCreate,
    SourceProbeResult,
    SourceRetryRequest,
    SourceUpdate,
    SourceView,
)
from .dependencies import AdminDependency, ServicesDependency, SessionDependency

router = APIRouter()


@router.get("/api/v2/admin/sources", response_model=list[SourceView])
def list_sources(
    services: ServicesDependency,
    _: AdminDependency,
    session: SessionDependency,
) -> list[SourceView]:
    return services.ingestion.list_sources(session)


@router.post(
    "/api/v2/admin/sources",
    response_model=SourceView,
    status_code=status.HTTP_201_CREATED,
)
def create_source(
    services: ServicesDependency,
    payload: SourceCreate,
    principal: AdminDependency,
    session: SessionDependency,
) -> SourceView:
    try:
        source = services.ingestion.create_source(session, payload)
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
    services.audit.record(session, principal, "source.create", "source", source.id)
    session.commit()
    return source


@router.patch(
    "/api/v2/admin/sources/{source_id}",
    response_model=SourceView,
)
def update_source(
    services: ServicesDependency,
    source_id: str,
    payload: SourceUpdate,
    principal: AdminDependency,
    session: SessionDependency,
) -> SourceView:
    try:
        source = services.ingestion.update_source(session, source_id, payload)
    except ValueError as error:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found.")
    services.audit.record(
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
            "autoPausedAt": (source.auto_paused_at.isoformat() if source.auto_paused_at else None),
        },
    )
    session.commit()
    return source


@router.post(
    "/api/v2/admin/sources/{source_id}/probe",
    response_model=SourceProbeResult,
)
def probe_source(
    services: ServicesDependency,
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
                document = services.fetcher.fetch(candidate_url)
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
        services.audit.record(
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
        services.audit.record(
            session,
            principal,
            "source.canonical_url_adopted",
            "source",
            source.id,
            {"previousUrl": previous_url, "canonicalUrl": final_url},
        )
    services.audit.record(
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


@router.post(
    "/api/v2/admin/sources/{source_id}/retry",
    response_model=SourceView,
)
def retry_source(
    services: ServicesDependency,
    source_id: str,
    payload: SourceRetryRequest,
    principal: AdminDependency,
    session: SessionDependency,
) -> SourceView:
    try:
        source = services.ingestion.queue_source_retry(
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
    services.audit.record(
        session,
        principal,
        "source.retry",
        "source",
        source.id,
        {"consecutiveFailures": source.consecutive_failures},
    )
    session.commit()
    return source


@router.post(
    "/api/v2/admin/sources/{source_id}/snapshots",
    response_model=IngestionResult,
)
def ingest_source_snapshot(
    services: ServicesDependency,
    source_id: str,
    payload: DocumentIngestRequest,
    principal: AdminDependency,
    session: SessionDependency,
) -> IngestionResult:
    result = services.ingestion.ingest_document(session, source_id, payload)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found.")
    services.audit.record(
        session,
        principal,
        "source.ingest",
        "source",
        source_id,
        {"changeType": result.change_type, "snapshotId": result.snapshot_id},
    )
    session.commit()
    return result


@router.get(
    "/api/v2/admin/sources/{source_id}/snapshots",
    response_model=list[DocumentSnapshotView],
)
def list_source_snapshots(
    services: ServicesDependency,
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


@router.get("/api/v2/admin/ingestion-runs", response_model=list[IngestionRunView])
def list_ingestion_runs(
    services: ServicesDependency,
    _: AdminDependency,
    session: SessionDependency,
    source_id: Annotated[str | None, Query(alias="sourceId")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[IngestionRunView]:
    return services.ingestion.list_runs(session, source_id, limit)


@router.get(
    "/api/v2/admin/extraction-plan",
    response_model=list[ExtractionPlanItem],
)
def extraction_plan(
    services: ServicesDependency,
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
        for source, snapshot_row in services.build_extraction_plan(session, limit)
    ]


@router.post(
    "/api/v2/admin/sources/{source_id}/extract",
    response_model=list[ReviewQueueItem],
)
def extract_source_candidates(
    services: ServicesDependency,
    source_id: str,
    payload: ExtractionRequest,
    principal: AdminDependency,
    session: SessionDependency,
) -> list[ReviewQueueItem]:
    source = session.get(SourceRecord, source_id)
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found.")
    statement = select(DocumentSnapshotRecord).where(DocumentSnapshotRecord.source_id == source_id)
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
        created, duplicates_skipped = services.create_extraction_candidates(
            session,
            source,
            snapshot_row,
            payload.max_candidates,
        )
    except ExtractionUnavailableError as error:
        session.rollback()
        services.audit.record(
            session,
            principal,
            "extraction.failed",
            "document_snapshot",
            snapshot_row.id,
            {
                "sourceId": source_id,
                "error": str(error),
                "pipelineVersion": EXTRACTION_PIPELINE_VERSION,
                "providerCall": services.extraction.call_metadata(),
            },
        )
        session.commit()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(error),
        ) from error
    services.audit.record(
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
            "providerCall": services.extraction.call_metadata(),
        },
    )
    session.commit()
    return created


@router.post("/api/v2/admin/ingestion/run", response_model=SchedulerRunSummary)
def run_ingestion(
    services: ServicesDependency,
    principal: AdminDependency,
    session: SessionDependency,
) -> SchedulerRunSummary:
    result = services.scheduler.run_due(session)
    services.audit.record(
        session,
        principal,
        "ingestion.run",
        "scheduler",
        "due-cycle",
        result.model_dump(by_alias=True),
    )
    session.commit()
    return result


@router.post(
    "/api/v2/admin/sources/{source_id}/collect",
    response_model=SchedulerRunSummary,
)
def collect_source_now(
    services: ServicesDependency,
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
    result = services.scheduler.run_due(session, source_id=source_id, force=True, limit=1)
    if result.due == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Source is already being collected; retry after its lease expires.",
        )
    services.audit.record(
        session,
        principal,
        "source.collect",
        "source",
        source_id,
        result.model_dump(by_alias=True),
    )
    session.commit()
    return result
