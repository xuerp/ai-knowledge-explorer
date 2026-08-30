from __future__ import annotations

import hashlib
import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .database import (
    EntityAliasRecord,
    KnowledgeEntityRecord,
    KnowledgeRelationRecord,
    KnowledgeTimelineRecord,
    PublicationRecordRow,
    ReviewJobRecord,
    SourceRecord,
)
from .entity_aliases import (
    EntityAliasDefinition,
    apply_entity_aliases,
    load_entity_alias_catalog,
    normalize_entity_alias,
)
from .quality import resolve_claim_entity_reference
from .schemas import (
    Claim,
    Entity,
    Evidence,
    GraphEdge,
    GraphNode,
    KnowledgeSnapshot,
    LocalizedText,
    PublicationRecord,
    RelationKind,
    ReviewCandidate,
    ReviewQueueItem,
    TimelineEntry,
)

OPEN_REVIEW_STATUSES = {"pending", "needs-more-evidence"}
logger = logging.getLogger(__name__)

RELATION_PREDICATES: dict[str, RelationKind] = {
    "developed-by": "developed-by",
    "developed by": "developed-by",
    "由其开发": "developed-by",
    "开发方": "developed-by",
    "based-on": "based-on",
    "based on": "based-on",
    "基于": "based-on",
    "competes-with": "competes-with",
    "competes with": "competes-with",
    "竞争": "competes-with",
    "benchmarked-on": "benchmarked-on",
    "benchmarked on": "benchmarked-on",
    "评测于": "benchmarked-on",
    "uses": "uses",
    "use": "uses",
    "使用": "uses",
    "采用": "uses",
    "cited-by": "cited-by",
    "cited by": "cited-by",
    "被引用": "cited-by",
    "part-of": "part-of",
    "part of": "part-of",
    "属于": "part-of",
    "successor-of": "successor-of",
    "successor of": "successor-of",
    "继任": "successor-of",
    "integrates-with": "integrates-with",
    "integrates with": "integrates-with",
    "集成": "integrates-with",
    "兼容": "integrates-with",
}


def _reference_key(value: str | None) -> str:
    return " ".join((value or "").casefold().replace("_", " ").split())


# 这些条目来自随应用发布的官方目录。映射仅处理已经确认迁移或会因尾斜杠
# 规范化而被上游拦截的旧网址，不触碰管理员自行登记的信源。
CANONICAL_SOURCE_URL_MIGRATIONS = {
    "s-openai-about": "https://openai.com/our-structure/",
    "s-cursor-docs": "https://cursor.com/docs",
    "s-qwen-models": "https://raw.githubusercontent.com/QwenLM/Qwen3/main/README.md",
    "s-swebench": (
        "https://raw.githubusercontent.com/swe-bench/swe-bench.github.io/"
        "master/data/info_for_leaderboard.json"
    ),
}

MACHINE_SOURCE_CATALOG = (
    {
        "id": "s-openai-api-changelog",
        "url": "https://developers.openai.com/api/docs/changelog.md",
        "title": "OpenAI API 更新日志",
        "publisher": "OpenAI",
        "fetch_interval_minutes": 120,
    },
    {
        "id": "s-openai-models",
        "url": "https://developers.openai.com/api/docs/models.md",
        "title": "OpenAI 模型目录",
        "publisher": "OpenAI",
        "fetch_interval_minutes": 240,
    },
    {
        "id": "s-openai-deprecations",
        "url": "https://developers.openai.com/api/docs/deprecations.md",
        "title": "OpenAI 弃用与下线记录",
        "publisher": "OpenAI",
        "fetch_interval_minutes": 1440,
    },
    {
        "id": "s-google-gemini-api-changelog",
        "url": "https://ai.google.dev/gemini-api/docs/changelog",
        "title": "Gemini API 官方更新日志",
        "publisher": "Google",
        "fetch_interval_minutes": 240,
    },
    {
        "id": "s-anthropic-api-release-notes",
        "url": "https://platform.claude.com/docs/en/release-notes/overview.md",
        "title": "Anthropic Claude API 更新日志",
        "publisher": "Anthropic",
        "fetch_interval_minutes": 240,
    },
)


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


class KnowledgeRepository:
    def __init__(
        self,
        seed_snapshot_path: Path,
        data_mode: Literal["demo", "live"] = "demo",
    ):
        self.seed_snapshot_path = seed_snapshot_path
        self.alias_catalog_path = seed_snapshot_path.with_name("entity_aliases_v1.json")
        self.data_mode = data_mode
        self._seed: KnowledgeSnapshot | None = None
        self.alias_catalog_version: str | None = None
        self.alias_catalog_sha256: str | None = None
        self._alias_definitions: tuple[EntityAliasDefinition, ...] = ()

    def load_seed(self) -> KnowledgeSnapshot:
        if self._seed is None:
            payload = json.loads(self.seed_snapshot_path.read_text(encoding="utf-8"))
            extension_path = self.seed_snapshot_path.with_name("catalog_extension.json")
            if extension_path.exists():
                extension = json.loads(extension_path.read_text(encoding="utf-8"))
                for key in ("entities", "evidence", "claims"):
                    existing_ids = {item["id"] for item in payload.get(key, [])}
                    payload.setdefault(key, []).extend(
                        item for item in extension.get(key, []) if item["id"] not in existing_ids
                    )
                known_edge_ids = {item["id"] for item in payload["graph"].get("edges", [])}
                payload["graph"].setdefault("edges", []).extend(
                    item
                    for item in extension.get("relations", [])
                    if item["id"] not in known_edge_ids
                )
                known_node_entity_ids = {
                    item["entityId"] for item in payload["graph"].get("nodes", [])
                }
                payload["graph"].setdefault("nodes", []).extend(
                    {
                        "id": f"node-{entity['id']}",
                        "entityId": entity["id"],
                        "type": entity["type"],
                        "importance": 0.82,
                    }
                    for entity in extension.get("entities", [])
                    if entity["id"] not in known_node_entity_ids
                )
                for entity_id, entries in extension.get("timeline", {}).items():
                    known_entry_ids = {
                        item["id"] for item in payload.setdefault("timeline", {}).get(entity_id, [])
                    }
                    payload["timeline"].setdefault(entity_id, []).extend(
                        item for item in entries if item["id"] not in known_entry_ids
                    )
            self._seed = KnowledgeSnapshot.model_validate(payload)
            if self.alias_catalog_path.exists():
                (
                    self.alias_catalog_version,
                    self._alias_definitions,
                    self.alias_catalog_sha256,
                ) = load_entity_alias_catalog(self.alias_catalog_path)
                apply_entity_aliases(self._seed.entities, self._alias_definitions)
        return self._seed.model_copy(deep=True)

    def seed_catalog(self, session: Session) -> None:
        seed = self.load_seed()
        now = datetime.now(UTC)
        known_entity_ids = set(session.scalars(select(KnowledgeEntityRecord.id)).all())
        families = [entity for entity in seed.entities if entity.family_id is None]
        versions = [entity for entity in seed.entities if entity.family_id is not None]
        for entity in [*families, *versions]:
            if entity.id not in known_entity_ids:
                session.add(self._entity_record(entity, now))
        session.flush()

        known_source_ids = set(session.scalars(select(SourceRecord.id)).all())
        known_source_urls = set(session.scalars(select(SourceRecord.url)).all())
        for evidence in seed.evidence:
            normalized_url = evidence.url.rstrip("/")
            if evidence.id in known_source_ids or normalized_url in known_source_urls:
                continue
            session.add(
                SourceRecord(
                    id=evidence.id,
                    url=normalized_url,
                    title=evidence.title.zh,
                    publisher=evidence.publisher,
                    active=True,
                    fetch_enabled=False,
                    fetch_interval_minutes=240,
                    next_fetch_at=None,
                    created_at=now,
                )
            )
            known_source_ids.add(evidence.id)
            known_source_urls.add(normalized_url)

        for machine_source in MACHINE_SOURCE_CATALOG:
            normalized_url = str(machine_source["url"]).rstrip("/")
            source_id = str(machine_source["id"])
            if source_id in known_source_ids or normalized_url in known_source_urls:
                continue
            session.add(
                SourceRecord(
                    id=source_id,
                    url=normalized_url,
                    title=str(machine_source["title"]),
                    publisher=str(machine_source["publisher"]),
                    active=True,
                    fetch_enabled=False,
                    fetch_interval_minutes=int(machine_source["fetch_interval_minutes"]),
                    next_fetch_at=None,
                    created_at=now,
                )
            )
            known_source_ids.add(source_id)
            known_source_urls.add(normalized_url)

        for source_id, canonical_url in CANONICAL_SOURCE_URL_MIGRATIONS.items():
            row = session.get(SourceRecord, source_id)
            if row is None or row.url == canonical_url:
                continue
            row.url = canonical_url
            row.fetch_enabled = False
            row.next_fetch_at = None
            row.last_probe_at = None
            row.last_probe_status = None
            row.last_probe_error = None
            row.last_probe_content_type = None
            row.last_probe_readable_characters = None

        # These are narrow, one-way migrations for locally seeded records. They
        # never overwrite administrator-maintained fields or aliases.
        legacy_origins = {("美国", "United States"), ("中国", "China")}
        for entity in seed.entities:
            row = session.get(KnowledgeEntityRecord, entity.id)
            if row is None:
                continue
            stored = Entity.model_validate_json(row.payload_json)
            changed = False
            stored_origin = stored.origin
            if (
                entity.origin is not None
                and stored_origin is not None
                and (stored_origin.zh, stored_origin.en) in legacy_origins
            ):
                stored.origin = entity.origin
                changed = True
            aliases = {
                normalize_entity_alias(value): value
                for value in stored.aliases or []
                if value.strip()
            }
            for value in entity.aliases or []:
                aliases.setdefault(normalize_entity_alias(value), value)
            merged_aliases = list(aliases.values()) or None
            if stored.aliases != merged_aliases:
                stored.aliases = merged_aliases
                changed = True
            if changed:
                row.payload_json = stored.model_dump_json(by_alias=True)
                row.updated_at = now
            self._sync_entity_aliases(session, stored)

        known_timeline_ids = set(
            session.execute(
                select(KnowledgeTimelineRecord.id, KnowledgeTimelineRecord.entity_id)
            ).all()
        )
        for entity_id, entries in seed.timeline.items():
            for entry in entries:
                if (entry.id, entity_id) not in known_timeline_ids:
                    session.add(
                        KnowledgeTimelineRecord(
                            id=entry.id,
                            entity_id=entity_id,
                            event_date=entry.date,
                            payload_json=entry.model_dump_json(by_alias=True),
                            updated_at=now,
                        )
                    )

        known_relation_ids = set(session.scalars(select(KnowledgeRelationRecord.id)).all())
        for edge in seed.graph.edges:
            if edge.id not in known_relation_ids:
                session.add(
                    KnowledgeRelationRecord(
                        id=edge.id,
                        from_id=edge.from_id,
                        to_id=edge.to_id,
                        kind=edge.kind,
                        payload_json=edge.model_dump_json(by_alias=True),
                        updated_at=now,
                    )
                )
        session.commit()

    @staticmethod
    def _entity_record(entity: Entity, updated_at: datetime) -> KnowledgeEntityRecord:
        return KnowledgeEntityRecord(
            id=entity.id,
            entity_type=entity.type,
            slug=entity.slug,
            family_id=entity.family_id,
            payload_json=entity.model_dump_json(by_alias=True),
            updated_at=updated_at,
        )

    def _sync_entity_aliases(self, session: Session, entity: Entity) -> None:
        session.execute(delete(EntityAliasRecord).where(EntityAliasRecord.entity_id == entity.id))
        catalog_types = {
            normalize_entity_alias(item.alias): item.alias_type
            for item in self._alias_definitions
            if item.entity_id == entity.id
        }
        seen: set[str] = set()
        for alias in entity.aliases or []:
            alias_key = normalize_entity_alias(alias)
            if not alias_key or alias_key in seen:
                continue
            seen.add(alias_key)
            session.add(
                EntityAliasRecord(
                    entity_id=entity.id,
                    alias_key=alias_key,
                    alias=alias.strip(),
                    alias_type=catalog_types.get(alias_key, "other"),
                )
            )

    def upsert_entity(self, session: Session, entity: Entity) -> Entity:
        if entity.family_id == entity.id:
            raise ValueError("An entity cannot be its own model family.")
        if entity.family_id:
            if entity.type != "model":
                raise ValueError("Only model entities can belong to a model family.")
            if entity.latest_version:
                raise ValueError("Concrete model versions cannot declare latestVersion.")
            family_row = session.get(KnowledgeEntityRecord, entity.family_id)
            if family_row is None:
                raise ValueError(f"Unknown model family: {entity.family_id}")
            family = Entity.model_validate_json(family_row.payload_json)
            if family.type != "model" or family.family_id is not None:
                raise ValueError("familyId must reference a top-level model family.")
        elif entity.type != "model" and entity.latest_version:
            raise ValueError("Only model families can declare latestVersion.")

        now = datetime.now(UTC)
        row = session.get(KnowledgeEntityRecord, entity.id)
        if row is None:
            session.add(self._entity_record(entity, now))
        else:
            row.entity_type = entity.type
            row.slug = entity.slug
            row.family_id = entity.family_id
            row.payload_json = entity.model_dump_json(by_alias=True)
            row.updated_at = now
        session.flush()
        self._sync_entity_aliases(session, entity)
        session.flush()
        return entity

    def upsert_relation(self, session: Session, edge: GraphEdge) -> GraphEdge:
        if edge.from_id == edge.to_id:
            raise ValueError("A relation must connect two different entities.")
        if edge.confidence == "verified" and not edge.source_ids:
            raise ValueError("Verified relations must include at least one sourceId.")
        known_evidence = {item.id for item in self.public_snapshot(session).evidence}
        unknown_sources = sorted(set(edge.source_ids) - known_evidence)
        if unknown_sources:
            raise ValueError(f"Unknown relation sourceId(s): {', '.join(unknown_sources)}")
        missing = [
            entity_id
            for entity_id in (edge.from_id, edge.to_id)
            if session.get(KnowledgeEntityRecord, entity_id) is None
        ]
        if missing:
            raise ValueError(f"Unknown relation endpoint(s): {', '.join(missing)}")

        now = datetime.now(UTC)
        row = session.get(KnowledgeRelationRecord, edge.id)
        if row is None:
            row = KnowledgeRelationRecord(
                id=edge.id,
                from_id=edge.from_id,
                to_id=edge.to_id,
                kind=edge.kind,
                payload_json=edge.model_dump_json(by_alias=True),
                updated_at=now,
            )
            session.add(row)
        else:
            row.from_id = edge.from_id
            row.to_id = edge.to_id
            row.kind = edge.kind
            row.payload_json = edge.model_dump_json(by_alias=True)
            row.updated_at = now
        session.flush()
        return edge

    def relation_from_approved_claim(
        self,
        session: Session,
        row: ReviewJobRecord,
        snapshot: KnowledgeSnapshot | None = None,
    ) -> GraphEdge | None:
        claim = self.approved_claim(row)
        kind = RELATION_PREDICATES.get(_reference_key(claim.predicate))
        if not kind or not row.entity_id or not claim.object_or_value:
            return None
        snapshot = snapshot or self.public_snapshot(session)
        target_key = _reference_key(claim.object_or_value)
        targets = [
            entity
            for entity in snapshot.entities
            if target_key
            in {
                _reference_key(entity.id),
                _reference_key(entity.slug),
                _reference_key(entity.name.zh),
                _reference_key(entity.name.en),
                *(_reference_key(alias) for alias in entity.aliases or []),
            }
        ]
        if len(targets) != 1 or targets[0].id == row.entity_id:
            return None
        target_id = targets[0].id
        existing = next(
            (
                edge
                for edge in snapshot.graph.edges
                if edge.kind == kind
                and (
                    (edge.from_id == row.entity_id and edge.to_id == target_id)
                    or (
                        kind == "competes-with"
                        and edge.from_id == target_id
                        and edge.to_id == row.entity_id
                    )
                )
            ),
            None,
        )
        source_ids = list(dict.fromkeys(claim.source_ids))
        if existing:
            return existing.model_copy(
                update={
                    "confidence": "verified",
                    "source_ids": list(dict.fromkeys([*existing.source_ids, *source_ids])),
                }
            )
        from_id, to_id = row.entity_id, target_id
        if kind == "competes-with":
            from_id, to_id = sorted((from_id, to_id))
        digest = hashlib.sha256(f"{from_id}|{kind}|{to_id}".encode()).hexdigest()[:16]
        return GraphEdge(
            id=f"edge-reviewed-{digest}",
            from_id=from_id,
            to_id=to_id,
            kind=kind,
            confidence="verified",
            source_ids=source_ids,
            valid_from=claim.valid_from,
            valid_to=claim.valid_to,
        )

    def upsert_timeline(
        self,
        session: Session,
        entity_id: str,
        entry: TimelineEntry,
    ) -> TimelineEntry:
        if session.get(KnowledgeEntityRecord, entity_id) is None:
            raise ValueError(f"Unknown timeline entity: {entity_id}")
        if entry.confidence == "verified" and not entry.source_ids:
            raise ValueError("Verified timeline entries must include at least one sourceId.")
        known_evidence = {item.id for item in self.public_snapshot(session).evidence}
        unknown_sources = sorted(set(entry.source_ids) - known_evidence)
        if unknown_sources:
            raise ValueError(f"Unknown timeline sourceId(s): {', '.join(unknown_sources)}")

        now = datetime.now(UTC)
        row = session.get(KnowledgeTimelineRecord, (entry.id, entity_id))
        if row is None:
            row = KnowledgeTimelineRecord(
                id=entry.id,
                entity_id=entity_id,
                event_date=entry.date,
                payload_json=entry.model_dump_json(by_alias=True),
                updated_at=now,
            )
            session.add(row)
        else:
            row.entity_id = entity_id
            row.event_date = entry.date
            row.payload_json = entry.model_dump_json(by_alias=True)
            row.updated_at = now
        session.flush()
        return entry

    def seed_review_jobs(self, session: Session) -> None:
        seed = self.load_seed()
        for candidate in seed.review_candidates:
            if session.get(ReviewJobRecord, candidate.id):
                continue
            session.add(
                ReviewJobRecord(
                    id=candidate.id,
                    entity_id=candidate.entity_id,
                    claim_id=candidate.claim.id,
                    claim_json=candidate.claim.model_dump_json(by_alias=True),
                    evidence_ids_json=json.dumps(candidate.evidence_ids),
                    evidence_json=json.dumps(
                        [
                            evidence.model_dump(mode="json", by_alias=True)
                            for evidence in seed.evidence
                            if evidence.id in candidate.evidence_ids
                        ],
                        ensure_ascii=False,
                    ),
                    conflict_ids_json="[]",
                    status=candidate.status,
                    created_at=_parse_datetime(candidate.created_at),
                    reviewed_at=(
                        _parse_datetime(candidate.reviewed_at) if candidate.reviewed_at else None
                    ),
                    version=1,
                )
            )
        session.commit()

    def public_snapshot(self, session: Session) -> KnowledgeSnapshot:
        snapshot = self.load_seed()
        entity_rows = session.scalars(
            select(KnowledgeEntityRecord).order_by(
                KnowledgeEntityRecord.entity_type,
                KnowledgeEntityRecord.id,
            )
        ).all()
        if entity_rows:
            snapshot.entities = [
                Entity.model_validate_json(row.payload_json) for row in entity_rows
            ]
            previous_importance = {node.entity_id: node.importance for node in snapshot.graph.nodes}
            snapshot.graph.nodes = [
                GraphNode(
                    id=f"node-{entity.id}",
                    entity_id=entity.id,
                    type=entity.type,
                    importance=previous_importance.get(
                        entity.id,
                        1.0 if entity.family_id is None else 0.72,
                    ),
                )
                for entity in snapshot.entities
            ]

            timeline_rows = session.scalars(
                select(KnowledgeTimelineRecord).order_by(
                    KnowledgeTimelineRecord.event_date,
                    KnowledgeTimelineRecord.id,
                )
            ).all()
            timeline: dict[str, list[TimelineEntry]] = {}
            for row in timeline_rows:
                timeline.setdefault(row.entity_id, []).append(
                    TimelineEntry.model_validate_json(row.payload_json)
                )
            snapshot.timeline = timeline

            relation_rows = session.scalars(
                select(KnowledgeRelationRecord).order_by(KnowledgeRelationRecord.id)
            ).all()
            snapshot.graph.edges = [
                GraphEdge.model_validate_json(row.payload_json) for row in relation_rows
            ]
            snapshot.graph.captured_at = datetime.now(UTC).isoformat()

        jobs = session.scalars(select(ReviewJobRecord)).all()
        blocked_claim_ids = {
            job.claim_id
            for job in jobs
            if job.status in OPEN_REVIEW_STATUSES | {"rejected"}
            or job.lifecycle_status != "current"
            or job.publication_action == "merged-evidence"
        }
        snapshot.claims = [claim for claim in snapshot.claims if claim.id not in blocked_claim_ids]
        claim_ids = {claim.id for claim in snapshot.claims}
        evidence_ids = {evidence.id for evidence in snapshot.evidence}
        for job in jobs:
            if (
                job.status != "approved"
                or job.publication_action == "merged-evidence"
                or job.lifecycle_status != "current"
            ):
                continue
            claim = self.approved_claim(job)
            if job.claim_id in claim_ids:
                snapshot.claims = [
                    claim if existing.id == job.claim_id else existing
                    for existing in snapshot.claims
                ]
            else:
                snapshot.claims.append(claim)
                claim_ids.add(job.claim_id)
            for evidence in self.approved_evidence(job):
                if evidence.id in evidence_ids:
                    snapshot.evidence = [
                        evidence if existing.id == evidence.id else existing
                        for existing in snapshot.evidence
                    ]
                else:
                    snapshot.evidence.append(evidence)
                    evidence_ids.add(evidence.id)
        snapshot.claims = [
            claim.model_copy(update={"entity_id": resolved_entity_id})
            if not claim.entity_id
            and (resolved_entity_id := resolve_claim_entity_reference(claim, snapshot.entities))
            else claim
            for claim in snapshot.claims
        ]
        snapshot.review_candidates = []
        snapshot.sync_runs = []
        snapshot.meta.mode = self.data_mode
        snapshot.meta.freshness = "cached" if self.data_mode == "demo" else "fresh"
        snapshot.meta.retrieved_at = datetime.now(UTC).isoformat()
        snapshot.meta.message = LocalizedText(
            zh=(
                "来自本地 API 的明确标记演示种子；待审核内容已从公共快照隔离。"
                if self.data_mode == "demo"
                else "来自可信 API；待审核内容已从公共快照隔离。"
            ),
            en=(
                "Explicitly labelled demo seed served by the local API; pending review data is isolated."
                if self.data_mode == "demo"
                else "Served by the trusted API; pending review data is isolated."
            ),
        )
        return snapshot

    def queue(
        self,
        session: Session,
        *,
        scope: Literal["open", "history", "all"] = "all",
        limit: int = 500,
    ) -> list[ReviewQueueItem]:
        statement = select(ReviewJobRecord)
        if scope == "open":
            statement = statement.where(ReviewJobRecord.status.in_(OPEN_REVIEW_STATUSES))
        elif scope == "history":
            statement = statement.where(ReviewJobRecord.status.not_in(OPEN_REVIEW_STATUSES))
        rows = session.scalars(
            statement.order_by(ReviewJobRecord.created_at.desc()).limit(limit)
        ).all()
        items: list[ReviewQueueItem] = []
        for row in rows:
            try:
                items.append(self.to_queue_item(row))
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                logger.warning(
                    "Skipping malformed review row %s while loading %s queue: %s",
                    row.id,
                    scope,
                    error,
                )
        return items

    def approved_claim(self, row: ReviewJobRecord) -> Claim:
        claim = Claim.model_validate_json(row.claim_json)
        updates: dict[str, object] = {"confidence": "verified"}
        if row.entity_id:
            updates["entity_id"] = row.entity_id
        if row.reviewed_at:
            updates["updated_at"] = row.reviewed_at.date().isoformat()
        return claim.model_copy(update=updates)

    def approved_evidence(self, row: ReviewJobRecord) -> list[Evidence]:
        verified_at = (
            row.reviewed_at.isoformat()
            if row.reviewed_at
            and row.reviewed_by
            and row.reviewed_by != "automation@ai-radar.local"
            else None
        )
        evidence_items: list[Evidence] = []
        for raw_evidence in json.loads(row.evidence_json or "[]"):
            evidence = Evidence.model_validate(raw_evidence)
            evidence = evidence.model_copy(update={"verified_at": verified_at})
            evidence_items.append(evidence)
        return evidence_items

    def persist_approved_verification(self, row: ReviewJobRecord) -> None:
        row.claim_json = self.approved_claim(row).model_dump_json(by_alias=True)
        row.evidence_json = json.dumps(
            [item.model_dump(mode="json", by_alias=True) for item in self.approved_evidence(row)],
            ensure_ascii=False,
        )

    def to_queue_item(self, row: ReviewJobRecord) -> ReviewQueueItem:
        claim = (
            self.approved_claim(row)
            if row.status == "approved"
            else Claim.model_validate_json(row.claim_json)
        )
        candidate = ReviewCandidate.model_validate(
            {
                "id": row.id,
                "entityId": row.entity_id,
                "claim": claim.model_dump(mode="json", by_alias=True),
                "evidenceIds": json.loads(row.evidence_ids_json),
                "status": row.status,
                "createdAt": row.created_at.isoformat(),
                "reviewedAt": row.reviewed_at.isoformat() if row.reviewed_at else None,
            }
        )
        return ReviewQueueItem(
            **candidate.model_dump(),
            version=row.version,
            review_reason=row.review_reason,
            review_method=(
                "automation"
                if row.reviewed_by == "automation@ai-radar.local"
                else "human"
                if row.reviewed_by
                else None
            ),
            evidence_items=self.approved_evidence(row),
            conflict_claim_ids=json.loads(row.conflict_ids_json or "[]"),
            lifecycle_status=row.lifecycle_status,
            publication_action=row.publication_action,
            target_claim_id=row.target_claim_id,
            superseded_by_claim_id=row.superseded_by_claim_id,
        )

    def publication_history(self, session: Session) -> list[PublicationRecord]:
        rows = session.scalars(
            select(PublicationRecordRow).order_by(PublicationRecordRow.published_at.desc())
        ).all()
        return [
            PublicationRecord(
                id=row.id,
                review_job_id=row.review_job_id,
                claim_id=row.claim_id,
                published_at=row.published_at,
                actor=row.actor,
            )
            for row in rows
        ]
