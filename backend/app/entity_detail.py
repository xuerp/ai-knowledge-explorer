"""Bounded public page projection, after the normal publication/quality gate.

Never use this to project an administrative snapshot. No account, review queue,
worker logs or research records are returned, including demo placeholders.
"""

from .schemas import KnowledgeSnapshot


def project_entity_detail(snapshot: KnowledgeSnapshot, entity_type: str, slug: str):
    target = next(
        (item for item in snapshot.entities if item.type == entity_type and item.slug == slug),
        None,
    )
    if target is None:
        return None
    family_id = target.family_id or target.id
    primary_ids = {target.id, family_id} | {
        item.id for item in snapshot.entities if item.family_id == family_id
    }
    edges = [
        edge
        for edge in snapshot.graph.edges
        if edge.from_id == target.id or edge.to_id == target.id
    ]
    entity_ids = primary_ids | {edge.from_id for edge in edges} | {edge.to_id for edge in edges}
    entities = [
        item
        if item.id in {target.id, target.family_id}
        else item.model_copy(update={"knowledge": None, "metrics": None, "capabilities": None})
        for item in snapshot.entities
        if item.id in entity_ids
    ]
    claims = [item for item in snapshot.claims if item.entity_id == target.id]
    timeline = {target.id: snapshot.timeline.get(target.id, [])}
    change_ids = {target.id} if target.family_id else primary_ids
    changes = [item for item in snapshot.changes if item.entity_id in change_ids]
    source_ids = set()
    access_urls = (
        {channel.url for channel in target.release.access_channels if channel.url}
        if target.release
        else set()
    )

    def collect(value):
        if isinstance(value, dict):
            source_ids.update(value.get("sourceIds") or [])
            for child in value.values():
                collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)

    for item in [*entities, *claims, *edges, *changes, *timeline[target.id]]:
        collect(item.model_dump(by_alias=True))
    return snapshot.model_copy(
        update={
            "entities": entities,
            "claims": claims,
            "evidence": [
                item
                for item in snapshot.evidence
                if item.id in source_ids or item.url in access_urls
            ],
            "timeline": timeline,
            "graph": snapshot.graph.model_copy(
                update={
                    "nodes": [
                        item for item in snapshot.graph.nodes if item.entity_id in entity_ids
                    ],
                    "edges": edges,
                }
            ),
            "changes": changes,
            "following": [],
            "interest_profile": [],
            "research_questions": [],
            "research_answers": [],
            "notifications": [],
            "review_candidates": [],
            "sync_runs": [],
        }
    )
