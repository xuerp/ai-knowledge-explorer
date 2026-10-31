"""Small public homepage projection; never includes account or review payloads."""

from .schemas import (
    CamelModel,
    Confidence,
    DataMeta,
    Entity,
    GraphEdge,
    KnowledgeSnapshot,
    LocalizedText,
)


class HomeEntity(CamelModel):
    id: str
    type: str
    slug: str
    name: LocalizedText
    family_id: str | None = None
    vendor: str | None = None
    latest_version: str | None = None


class HomeEvidence(CamelModel):
    id: str
    url: str


class HomeChange(CamelModel):
    id: str
    entity_id: str
    date: str
    summary: LocalizedText
    confidence: Confidence
    source_ids: list[str]


class HomeOverview(CamelModel):
    meta: DataMeta
    entity_count: int
    claim_count: int
    sourced_claim_count: int
    relationship_count: int
    entities: list[HomeEntity]
    evidence: list[HomeEvidence]
    changes: list[HomeChange]
    featured_relations: list[GraphEdge]
    research_questions: list[LocalizedText]


def build_home_overview(snapshot: KnowledgeSnapshot) -> HomeOverview:
    entities = {item.id: item for item in snapshot.entities}
    sources = {item.id: item for item in snapshot.evidence if item.url.strip()}
    sourced_edges = [
        edge
        for edge in snapshot.graph.edges
        if edge.from_id in entities
        and edge.to_id in entities
        and any(sid in sources for sid in edge.source_ids)
    ]

    def family_id(entity_id: str) -> str:
        parent = entities[entity_id].family_id
        return parent if parent in entities else entity_id

    relationship_keys = {
        (family_id(edge.from_id), edge.kind, family_id(edge.to_id), edge.confidence)
        for edge in sourced_edges
        if edge.kind not in {"competes-with", "successor-of"}
        and family_id(edge.from_id) != family_id(edge.to_id)
    }
    kinds = ["uses", "integrates-with", "developed-by"]
    candidates = [
        edge
        for edge in sourced_edges
        if edge.confidence == "verified"
        and edge.kind in kinds
        and not entities[edge.from_id].family_id
    ]
    # Match the shared frontend selection: kind, target release, source recency.
    candidates.sort(key=lambda edge: entities[edge.from_id].last_updated_at, reverse=True)
    candidates.sort(
        key=lambda edge: (
            entities[edge.to_id].release.released_at or "" if entities[edge.to_id].release else ""
        ),
        reverse=True,
    )
    candidates.sort(key=lambda edge: kinds.index(edge.kind))
    featured: list[GraphEdge] = []
    for edge in candidates:
        if any(item.kind == edge.kind or item.from_id == edge.from_id for item in featured):
            continue
        featured.append(edge)
        if len(featured) == 3:
            break

    changes = [item for item in snapshot.changes[:3] if item.entity_id in entities]
    selected_ids = {
        item.id for item in snapshot.entities if item.type == "model" and not item.family_id
    }
    selected_ids.update(item.entity_id for item in changes)
    selected_ids.update(entity_id for edge in featured for entity_id in [edge.from_id, edge.to_id])
    selected_source_ids = {sid for edge in featured for sid in edge.source_ids}

    def teaser(entity: Entity) -> HomeEntity:
        return HomeEntity(
            id=entity.id,
            type=entity.type,
            slug=entity.slug,
            name=entity.name,
            family_id=entity.family_id,
            vendor=entity.vendor,
            latest_version=entity.latest_version,
        )

    return HomeOverview(
        meta=snapshot.meta,
        entity_count=len(snapshot.entities),
        claim_count=len(snapshot.claims),
        sourced_claim_count=sum(bool(item.source_ids) for item in snapshot.claims),
        relationship_count=len(relationship_keys),
        entities=[teaser(item) for item in snapshot.entities if item.id in selected_ids],
        evidence=[
            HomeEvidence(id=item.id, url=item.url)
            for item in snapshot.evidence
            if item.id in selected_source_ids
        ],
        changes=[
            HomeChange(
                id=item.id,
                entity_id=item.entity_id,
                date=item.date,
                summary=item.summary,
                confidence=item.confidence,
                source_ids=item.source_ids or [],
            )
            for item in changes
        ],
        featured_relations=featured,
        research_questions=snapshot.research_questions[:3],
    )
