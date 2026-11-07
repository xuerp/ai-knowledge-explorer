"""A public updates feed without the unrelated knowledge/account payloads."""

from .schemas import CamelModel, ChangeEvent, DataMeta, Entity, Evidence, KnowledgeSnapshot


class UpdatesOverview(CamelModel):
    meta: DataMeta
    entities: list[Entity]
    evidence: list[Evidence]
    changes: list[ChangeEvent]


def build_updates_overview(snapshot: KnowledgeSnapshot) -> UpdatesOverview:
    source_ids = {source_id for change in snapshot.changes for source_id in change.source_ids}
    return UpdatesOverview(
        meta=snapshot.meta,
        changes=snapshot.changes,
        entities=[
            entity.model_copy(
                update={"specs": None, "capabilities": None, "metrics": None, "knowledge": None}
            )
            for entity in snapshot.entities
        ],
        evidence=[
            source.model_copy(
                update={
                    "source_excerpt": None,
                    "supports_claim_ids": None,
                    "contradicts_claim_ids": None,
                }
            )
            for source in snapshot.evidence
            if source.id in source_ids
        ],
    )
