from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .database import DocumentSnapshotRecord, IngestionRunRecord, SourceRecord
from .fetching import SafeHttpFetcher
from .ingestion import IngestionService
from .schemas import DocumentIngestRequest, SchedulerRunSummary


class IngestionScheduler:
    def __init__(self, fetcher: SafeHttpFetcher, ingestion: IngestionService):
        self.fetcher = fetcher
        self.ingestion = ingestion

    def run_due(
        self,
        session: Session,
        *,
        now: datetime | None = None,
        limit: int = 20,
    ) -> SchedulerRunSummary:
        current = now or datetime.now(UTC)
        sources = session.scalars(
            select(SourceRecord)
            .where(
                SourceRecord.active.is_(True),
                SourceRecord.fetch_enabled.is_(True),
                or_(SourceRecord.next_fetch_at.is_(None), SourceRecord.next_fetch_at <= current),
            )
            .order_by(SourceRecord.next_fetch_at)
            .limit(limit)
        ).all()
        succeeded = unchanged = failed = 0
        for source in sources:
            started = datetime.now(UTC)
            try:
                document = self.fetcher.fetch(
                    source.url,
                    etag=source.etag,
                    last_modified=source.last_modified,
                )
                source.etag = document.etag
                source.last_modified = document.last_modified
                if document.not_modified:
                    snapshot = session.scalars(
                        select(DocumentSnapshotRecord)
                        .where(DocumentSnapshotRecord.source_id == source.id)
                        .order_by(DocumentSnapshotRecord.observed_at.desc())
                        .limit(1)
                    ).first()
                    session.add(
                        IngestionRunRecord(
                            id=str(uuid4()),
                            source_id=source.id,
                            started_at=started,
                            finished_at=datetime.now(UTC),
                            status="succeeded",
                            change_type="unchanged",
                            snapshot_id=snapshot.id if snapshot else None,
                        )
                    )
                    unchanged += 1
                else:
                    result = self.ingestion.ingest_document(
                        session,
                        source.id,
                        DocumentIngestRequest(content=document.content),
                    )
                    if result and result.change_type == "unchanged":
                        unchanged += 1
                    else:
                        succeeded += 1
            except Exception as error:  # noqa: BLE001 - one failed source must not stop the batch
                session.rollback()
                source = session.get(SourceRecord, source.id)
                session.add(
                    IngestionRunRecord(
                        id=str(uuid4()),
                        source_id=source.id,
                        started_at=started,
                        finished_at=datetime.now(UTC),
                        status="failed",
                        change_type="unchanged",
                        error=str(error)[:2000],
                    )
                )
                failed += 1
            source.next_fetch_at = current + timedelta(minutes=source.fetch_interval_minutes)
            session.commit()
        return SchedulerRunSummary(
            due=len(sources),
            succeeded=succeeded,
            unchanged=unchanged,
            failed=failed,
        )
