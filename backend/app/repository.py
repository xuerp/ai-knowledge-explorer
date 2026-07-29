from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import PublicationRecordRow, ReviewJobRecord
from .schemas import (
    Claim,
    Evidence,
    KnowledgeSnapshot,
    LocalizedText,
    PublicationRecord,
    ReviewCandidate,
    ReviewQueueItem,
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
