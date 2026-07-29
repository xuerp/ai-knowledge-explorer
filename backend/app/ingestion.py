from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import (
    DocumentSnapshotRecord,
    IngestionRunRecord,
    ReviewJobRecord,
    SourceRecord,
)
from .schemas import (
    CandidateCreate,
    DocumentIngestRequest,
    IngestionResult,
    IngestionRunView,
    SourceCreate,
    SourceView,
)


def normalize_source_url(value: str) -> str:
    parsed = urlsplit(value)
    path = parsed.path.rstrip("/") or "/"
    return urlunsplit(
        (
            parsed.scheme.lower(),
            parsed.netloc.lower(),
            path,
            parsed.query,
            "",
        )
    )


def normalize_content(value: str) -> str:
    return "\n".join(line.rstrip() for line in value.replace("\r\n", "\n").split("\n")).strip()


class IngestionService:
    def create_source(self, session: Session, payload: SourceCreate) -> SourceView:
        now = datetime.now(UTC)
        record = SourceRecord(
            id=payload.id,
            url=normalize_source_url(str(payload.url)),
            title=payload.title.strip(),
            publisher=payload.publisher.strip(),
            active=True,
            fetch_enabled=payload.fetch_enabled,
            fetch_interval_minutes=payload.fetch_interval_minutes,
            next_fetch_at=now if payload.fetch_enabled else None,
            created_at=now,
        )
        session.add(record)
        session.commit()
        return self.to_source_view(record)

    def list_sources(self, session: Session) -> list[SourceView]:
        rows = session.scalars(select(SourceRecord).order_by(SourceRecord.created_at)).all()
        return [self.to_source_view(row) for row in rows]

    def ingest_document(
        self,
        session: Session,
        source_id: str,
        payload: DocumentIngestRequest,
    ) -> IngestionResult | None:
        source = session.get(SourceRecord, source_id)
        if not source:
            return None
        started_at = datetime.now(UTC)
        content = normalize_content(payload.content)
        content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
        previous = session.scalars(
            select(DocumentSnapshotRecord)
            .where(DocumentSnapshotRecord.source_id == source_id)
            .order_by(DocumentSnapshotRecord.observed_at.desc())
            .limit(1)
        ).first()

        if previous and previous.content_hash == content_hash:
            snapshot = previous
            change_type = "unchanged"
        else:
            snapshot = DocumentSnapshotRecord(
                id=str(uuid4()),
                source_id=source_id,
                content_hash=content_hash,
                content_text=content,
                observed_at=started_at,
                published_at=payload.published_at,
                previous_snapshot_id=previous.id if previous else None,
            )
            session.add(snapshot)
            change_type = "updated" if previous else "created"

        finished_at = datetime.now(UTC)
        run = IngestionRunRecord(
            id=str(uuid4()),
            source_id=source_id,
            started_at=started_at,
            finished_at=finished_at,
            status="succeeded",
            change_type=change_type,
            snapshot_id=snapshot.id,
        )
        source.last_seen_at = finished_at
        session.add(run)
        session.commit()
        return IngestionResult(
            run_id=run.id,
            source_id=source_id,
            change_type=change_type,
            snapshot_id=snapshot.id,
            content_hash=content_hash,
            previous_snapshot_id=previous.id if previous and change_type == "updated" else None,
        )

    def list_runs(
        self,
        session: Session,
        source_id: str | None = None,
    ) -> list[IngestionRunView]:
        statement = select(IngestionRunRecord).order_by(IngestionRunRecord.started_at.desc())
        if source_id:
            statement = statement.where(IngestionRunRecord.source_id == source_id)
        rows = session.scalars(statement).all()
        return [
            IngestionRunView(
                id=row.id,
                source_id=row.source_id,
                started_at=row.started_at,
                finished_at=row.finished_at,
                status=row.status,
                change_type=row.change_type,
                snapshot_id=row.snapshot_id,
                error=row.error,
            )
            for row in rows
        ]

    def submit_candidate(
        self,
        session: Session,
        payload: CandidateCreate,
        *,
        queue_status: str = "pending",
        conflict_claim_ids: list[str] | None = None,
        review_reason: str | None = None,
    ) -> ReviewJobRecord | None:
        if session.get(ReviewJobRecord, payload.id):
            return None
        created_at = payload.created_at or datetime.now(UTC)
        row = ReviewJobRecord(
            id=payload.id,
            entity_id=payload.entity_id,
            claim_id=payload.claim.id,
            claim_json=payload.claim.model_dump_json(by_alias=True),
            evidence_ids_json=json.dumps([item.id for item in payload.evidence]),
            evidence_json=json.dumps(
                [item.model_dump(mode="json", by_alias=True) for item in payload.evidence],
                ensure_ascii=False,
            ),
            conflict_ids_json=json.dumps(conflict_claim_ids or []),
            status=queue_status,
            created_at=created_at,
            review_reason=review_reason,
            version=1,
        )
        session.add(row)
        session.commit()
        return row

    @staticmethod
    def to_source_view(row: SourceRecord) -> SourceView:
        return SourceView(
            id=row.id,
            url=row.url,
            title=row.title,
            publisher=row.publisher,
            active=row.active,
            fetch_enabled=row.fetch_enabled,
            fetch_interval_minutes=row.fetch_interval_minutes,
            next_fetch_at=row.next_fetch_at,
            created_at=row.created_at,
            last_seen_at=row.last_seen_at,
        )
