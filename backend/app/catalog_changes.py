"""Project reviewed catalog releases, without inventing dates or editorial cards."""

from datetime import date
from urllib.parse import urlparse

from .schemas import ChangeEvent, KnowledgeSnapshot


def catalog_release_changes(snapshot: KnowledgeSnapshot) -> list[ChangeEvent]:
    entities = {entity.id: entity for entity in snapshot.entities}
    evidence = {source.id: source for source in snapshot.evidence}
    changes: dict[str, ChangeEvent] = {}
    for family_id, events in snapshot.timeline.items():
        for event in events:
            version = entities.get(event.release_entity_id)
            if (
                not version
                or not version.release
                or version.family_id != family_id
                or version.release.stage == "pending"
                or event.kind != "release"
                or event.date_kind != "release"
                or event.confidence != "verified"
                or event.date != (version.release.released_at or version.first_released_at)
            ):
                continue
            try:
                if date.fromisoformat(event.date).isoformat() != event.date:
                    continue
            except ValueError:
                continue
            source_ids = []
            for source_id in dict.fromkeys(event.source_ids or []):
                source = evidence.get(source_id)
                if not source or source.type != "official" or not source.verified_at:
                    continue
                try:
                    url = urlparse(source.url)
                    if url.scheme == "https" and url.hostname:
                        source_ids.append(source_id)
                except ValueError:
                    continue
            if not source_ids:
                continue
            change_id = f"change-release-{version.id}"
            changes[change_id] = ChangeEvent(
                id=change_id,
                entity_id=version.id,
                date=event.date,
                summary=event.title,
                kind="new",
                confidence="verified",
                source_ids=source_ids,
            )
    return sorted(changes.values(), key=lambda item: (item.date, item.id), reverse=True)


def catalog_changes(snapshot: KnowledgeSnapshot) -> list[ChangeEvent]:
    entities = {entity.id: entity for entity in snapshot.entities}
    sources = {source.id: source for source in snapshot.evidence}
    claims = {claim.id: claim for claim in snapshot.claims}
    changes = {change.id: change for change in catalog_release_changes(snapshot)}
    for owner_id, events in snapshot.timeline.items():
        for event in events:
            entity_id = event.release_entity_id or owner_id
            entity = entities.get(entity_id)
            if (
                not entity
                or (entity_id != owner_id and entity.family_id != owner_id)
                or event.change_kind
                not in {"updated", "deprecated", "benchmark", "pricing", "availability"}
                or event.date_kind != "announcement"
                or event.confidence != "verified"
                or not event.detail
            ):
                continue
            try:
                if date.fromisoformat(event.date).isoformat() != event.date:
                    continue
            except ValueError:
                continue
            source_ids = []
            for source_id in dict.fromkeys(event.source_ids):
                source = sources.get(source_id)
                if (
                    not source
                    or source.type != "official"
                    or not source.verified_at
                    or not source.source_excerpt
                    or not any(
                        (claim := claims.get(claim_id))
                        and claim.confidence == "verified"
                        and claim.entity_id == entity_id
                        and claim.valid_from == event.date
                        and source.id in claim.source_ids
                        for claim_id in source.supports_claim_ids or []
                    )
                ):
                    continue
                try:
                    url = urlparse(source.url)
                    if url.scheme == "https" and url.hostname:
                        source_ids.append(source_id)
                except ValueError:
                    continue
            if source_ids:
                change_id = f"change-event-{event.id}"
                changes[change_id] = ChangeEvent(
                    id=change_id,
                    entity_id=entity_id,
                    date=event.date,
                    summary=event.title,
                    kind=event.change_kind,
                    confidence="verified",
                    source_ids=source_ids,
                    detail=event.detail,
                )
    return sorted(changes.values(), key=lambda item: (item.date, item.id), reverse=True)
