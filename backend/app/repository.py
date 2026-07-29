from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import (
    KnowledgeEntityRecord,
    KnowledgeRelationRecord,
    KnowledgeTimelineRecord,
    PublicationRecordRow,
    ReviewJobRecord,
)
from .schemas import (
    Claim,
    Entity,
    Evidence,
    GraphEdge,
    GraphNode,
    KnowledgeSnapshot,
    LocalizedText,
    PublicationRecord,
    ReviewCandidate,
    ReviewQueueItem,
    TimelineEntry,
)

OPEN_REVIEW_STATUSES = {"pending", "needs-more-evidence"}


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
        self.data_mode = data_mode
        self._seed: KnowledgeSnapshot | None = None

    def load_seed(self) -> KnowledgeSnapshot:
        if self._seed is None:
            payload = json.loads(self.seed_snapshot_path.read_text(encoding="utf-8"))
            self._seed = KnowledgeSnapshot.model_validate(payload)
        return self._seed.model_copy(deep=True)

    def seed_catalog(self, session: Session) -> None:
        if session.scalar(select(KnowledgeEntityRecord.id).limit(1)):
            return

        seed = self.load_seed()
        now = datetime.now(UTC)
        families = [entity for entity in seed.entities if entity.family_id is None]
        versions = [entity for entity in seed.entities if entity.family_id is not None]
        for entity in [*families, *versions]:
            session.add(self._entity_record(entity, now))

        for entity_id, entries in seed.timeline.items():
            for entry in entries:
                session.add(
                    KnowledgeTimelineRecord(
                        id=entry.id,
                        entity_id=entity_id,
                        event_date=entry.date,
                        payload_json=entry.model_dump_json(by_alias=True),
                        updated_at=now,
                    )
                )

        for edge in seed.graph.edges:
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
            job.claim_id for job in jobs if job.status in OPEN_REVIEW_STATUSES | {"rejected"}
        }
        snapshot.claims = [claim for claim in snapshot.claims if claim.id not in blocked_claim_ids]
        claim_ids = {claim.id for claim in snapshot.claims}
        evidence_ids = {evidence.id for evidence in snapshot.evidence}
        for job in jobs:
            if job.status != "approved":
                continue
            if job.claim_id not in claim_ids:
                snapshot.claims.append(Claim.model_validate_json(job.claim_json))
                claim_ids.add(job.claim_id)
            for raw_evidence in json.loads(job.evidence_json or "[]"):
                evidence = Evidence.model_validate(raw_evidence)
                if evidence.id not in evidence_ids:
                    snapshot.evidence.append(evidence)
                    evidence_ids.add(evidence.id)
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

    def queue(self, session: Session) -> list[ReviewQueueItem]:
        rows = session.scalars(
            select(ReviewJobRecord).order_by(ReviewJobRecord.created_at.desc())
        ).all()
        return [self.to_queue_item(row) for row in rows]

    def to_queue_item(self, row: ReviewJobRecord) -> ReviewQueueItem:
        candidate = ReviewCandidate.model_validate(
            {
                "id": row.id,
                "entityId": row.entity_id,
                "claim": json.loads(row.claim_json),
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
            conflict_claim_ids=json.loads(row.conflict_ids_json or "[]"),
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
