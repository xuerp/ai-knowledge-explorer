from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from ..database import (
    ReviewJobRecord,
)
from ..entry_requests import (
    EntryRequestCreate,
    EntryRequestReceipt,
    create_entry_request,
)
from ..home_overview import HomeOverview, build_home_overview
from ..repository import OPEN_REVIEW_STATUSES
from ..schemas import (
    BusinessQualityMetrics,
    Entity,
    EntityClaimPage,
    GraphQuery,
    GraphSnapshot,
    KnowledgeSnapshot,
    ModelVersionCompareRequest,
    QualityMetrics,
    ReviewReasonBreakdown,
    ReviewStats,
    TimelineEntry,
)
from .dependencies import ServicesDependency, SessionDependency

router = APIRouter()


@router.post("/api/v2/entry-requests", response_model=EntryRequestReceipt, status_code=201)
def submit_entry_request(
    services: ServicesDependency, payload: EntryRequestCreate, session: SessionDependency
):
    return create_entry_request(session, payload)


@router.get("/api/snapshot", response_model=KnowledgeSnapshot)
@router.get("/api/v2/snapshot", response_model=KnowledgeSnapshot)
def snapshot(services: ServicesDependency, session: SessionDependency) -> KnowledgeSnapshot:
    return services.get_public_snapshot(session)


@router.get("/api/v2/home", response_model=HomeOverview)
def home_overview(services: ServicesDependency, session: SessionDependency) -> HomeOverview:
    return build_home_overview(services.get_public_snapshot(session))


@router.get("/api/quality/metrics", response_model=QualityMetrics)
@router.get("/api/v2/quality/metrics", response_model=QualityMetrics)
def quality_metrics(services: ServicesDependency, session: SessionDependency) -> QualityMetrics:
    snapshot = services.get_catalog_snapshot(session)
    report = services.quality_gate.report(snapshot)
    return QualityMetrics(
        generated_at=datetime.now(UTC),
        data_mode=services.app_settings.data_mode,
        business=BusinessQualityMetrics(
            updated_at=services.business_metrics_updated_at(session),
            entity_count=report.entity_count,
            claim_count=report.claim_count,
            evidence_count=report.evidence_count,
            relation_count=report.relation_count,
            timeline_entry_count=report.timeline_entry_count,
            evidence_reference_coverage=report.evidence_reference_coverage,
            official_evidence_ratio=report.official_evidence_ratio,
            reviewed_evidence_ratio=report.reviewed_evidence_ratio,
            fresh_evidence_ratio=report.fresh_evidence_ratio,
            verified_content_ratio=report.verified_content_ratio,
            core_relation_deficit=report.core_relation_deficit,
        ),
        evaluation=services.evaluation_quality_metrics(snapshot),
    )


@router.get("/api/review/stats", response_model=ReviewStats)
@router.get("/api/v2/review/stats", response_model=ReviewStats)
def review_stats(services: ServicesDependency, session: SessionDependency) -> ReviewStats:
    rows = session.execute(
        select(
            ReviewJobRecord.status,
            ReviewJobRecord.created_at,
            ReviewJobRecord.reviewed_at,
            ReviewJobRecord.reason_category,
        )
    ).all()
    terminal = [row for row in rows if row.status in {"approved", "rejected"}]
    approved_count = sum(row.status == "approved" for row in terminal)
    rejected_rows = [row for row in terminal if row.status == "rejected"]
    rejected_count = len(rejected_rows)
    reviewed_count = len(terminal)
    durations = [
        max(0.0, (row.reviewed_at - row.created_at).total_seconds())
        for row in terminal
        if row.reviewed_at is not None
    ]
    category_counts: dict[str, int] = {}
    for row in rejected_rows:
        category = row.reason_category or "uncategorized"
        category_counts[category] = category_counts.get(category, 0) + 1
    rejection_reasons = [
        ReviewReasonBreakdown(
            category=category,
            count=count,
            ratio=count / rejected_count if rejected_count else 0.0,
        )
        for category, count in sorted(category_counts.items())
    ]
    reviewed_times = [row.reviewed_at for row in terminal if row.reviewed_at is not None]
    return ReviewStats(
        generated_at=datetime.now(UTC),
        open_count=sum(row.status in OPEN_REVIEW_STATUSES for row in rows),
        reviewed_count=reviewed_count,
        approved_count=approved_count,
        rejected_count=rejected_count,
        approval_rate=approved_count / reviewed_count if reviewed_count else 0.0,
        rejection_rate=rejected_count / reviewed_count if reviewed_count else 0.0,
        average_review_seconds=sum(durations) / len(durations) if durations else None,
        reviewed_with_duration_count=len(durations),
        last_reviewed_at=max(reviewed_times, default=None),
        rejection_reasons=rejection_reasons,
    )


@router.get("/api/v2/entities", response_model=list[Entity])
def entities(
    services: ServicesDependency,
    session: SessionDependency,
    entity_type: Annotated[str | None, Query(alias="type")] = None,
    query: str | None = None,
) -> list[Entity]:
    items = services.get_public_snapshot(session).entities
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


@router.get(
    "/api/v2/entities/{entity_id}/claims",
    response_model=EntityClaimPage,
)
def entity_claims(
    services: ServicesDependency,
    entity_id: str,
    session: SessionDependency,
    scope: Annotated[Literal["current", "history", "all"], Query()] = "current",
    topic: str | None = None,
    q: str | None = Query(default=None, max_length=200),
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> EntityClaimPage:
    public_snapshot = services.get_public_snapshot(session)
    current = [claim for claim in public_snapshot.claims if claim.entity_id == entity_id]
    rows = session.scalars(
        select(ReviewJobRecord).where(
            ReviewJobRecord.entity_id == entity_id,
            ReviewJobRecord.status == "approved",
        )
    ).all()
    historical = [
        services.repository.approved_claim(row)
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
    if q and q.strip():
        needle = q.strip().casefold()
        items = [
            claim
            for claim in items
            if needle
            in " ".join(
                [
                    claim.text.zh,
                    claim.text.en,
                    claim.predicate or "",
                    claim.subject or "",
                    claim.object_or_value or "",
                    claim.text.technical.zh if claim.text.technical else "",
                    claim.text.technical.en if claim.text.technical else "",
                ]
            ).casefold()
        ]
    total = len(items)
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
        for evidence in services.repository.approved_evidence(row):
            evidence_by_id[evidence.id] = evidence
    source_ids = {source_id for claim in page_items for source_id in claim.source_ids}
    return EntityClaimPage(
        total=total,
        items=page_items,
        evidence=[evidence_by_id[item_id] for item_id in source_ids if item_id in evidence_by_id],
        next_cursor=next_cursor,
    )


@router.get("/api/v2/model-families", response_model=list[Entity])
def model_families(services: ServicesDependency, session: SessionDependency) -> list[Entity]:
    return [
        item
        for item in services.get_public_snapshot(session).entities
        if item.type == "model" and item.family_id is None
    ]


@router.get("/api/v2/model-families/{family_id}/versions", response_model=list[Entity])
def model_family_versions(
    services: ServicesDependency, family_id: str, session: SessionDependency
) -> list[Entity]:
    snapshot = services.get_public_snapshot(session)
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
        key=lambda item: (
            (item.release.released_at if item.release else None) or item.first_released_at or ""
        ),
    )


@router.post("/api/v2/model-versions/compare", response_model=list[Entity])
def compare_model_versions(
    services: ServicesDependency,
    payload: ModelVersionCompareRequest,
    session: SessionDependency,
) -> list[Entity]:
    if len(set(payload.version_ids)) != len(payload.version_ids):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Each compared version must be unique.",
        )
    snapshot = services.get_public_snapshot(session)
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


@router.get("/api/v2/entities/{entity_id}/timeline", response_model=list[TimelineEntry])
def entity_timeline(
    services: ServicesDependency, entity_id: str, session: SessionDependency
) -> list[TimelineEntry]:
    return services.get_public_snapshot(session).timeline.get(entity_id, [])


@router.get("/api/v2/entities/{entity_id}/neighbors", response_model=GraphSnapshot)
def entity_neighbors(
    services: ServicesDependency, entity_id: str, session: SessionDependency
) -> GraphSnapshot:
    graph = services.get_public_snapshot(session).graph
    if not any(node.entity_id == entity_id for node in graph.nodes):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")
    edges = [edge for edge in graph.edges if edge.from_id == entity_id or edge.to_id == entity_id]
    entity_ids = {entity_id} | {edge.from_id for edge in edges} | {edge.to_id for edge in edges}
    return GraphSnapshot(
        nodes=[node for node in graph.nodes if node.entity_id in entity_ids],
        edges=edges,
        captured_at=graph.captured_at,
        valid_at=graph.valid_at,
    )


@router.get("/api/v2/entities/{entity_type}/{slug}", response_model=Entity)
def entity_detail(
    services: ServicesDependency,
    entity_type: str,
    slug: str,
    session: SessionDependency,
) -> Entity:
    entity = next(
        (
            item
            for item in services.get_public_snapshot(session).entities
            if item.type == entity_type and item.slug == slug
        ),
        None,
    )
    if not entity:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")
    return entity


@router.post("/api/v2/graph/query", response_model=GraphSnapshot)
def graph_query(
    services: ServicesDependency, query: GraphQuery, session: SessionDependency
) -> GraphSnapshot:
    graph = services.get_public_snapshot(session).graph
    nodes = [
        node for node in graph.nodes if not query.entity_types or node.type in query.entity_types
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
