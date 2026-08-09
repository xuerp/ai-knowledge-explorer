from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .database import DocumentSnapshotRecord, IngestionRunRecord, SourceRecord
from .fetching import SafeHttpFetcher
from .ingestion import IngestionService
from .schemas import DocumentIngestRequest, SchedulerRunSummary


class IngestionScheduler:
    def __init__(
        self,
        fetcher: SafeHttpFetcher,
        ingestion: IngestionService,
        *,
        retry_base_minutes: int = 15,
        retry_max_minutes: int = 360,
        lease_minutes: int = 5,
    ):
        self.fetcher = fetcher
        self.ingestion = ingestion
        self.retry_base_minutes = retry_base_minutes
        self.retry_max_minutes = retry_max_minutes
        self.lease_minutes = lease_minutes

    def run_due(
        self,
        session: Session,
        *,
        now: datetime | None = None,
        limit: int = 20,
        progress: Callable[[], None] | None = None,
    ) -> SchedulerRunSummary:
        current = now or datetime.now(UTC)
        due = succeeded = unchanged = failed = 0
        for _ in range(limit):
            source = session.scalars(
                select(SourceRecord)
                .where(
                    SourceRecord.active.is_(True),
                    SourceRecord.fetch_enabled.is_(True),
                    or_(
                        SourceRecord.next_fetch_at.is_(None),
                        SourceRecord.next_fetch_at <= current,
                    ),
                    or_(
                        SourceRecord.fetch_lease_token.is_(None),
                        SourceRecord.fetch_lease_expires_at.is_(None),
                        SourceRecord.fetch_lease_expires_at <= current,
                    ),
                )
                .order_by(SourceRecord.next_fetch_at.asc().nullsfirst())
                .limit(1)
                .with_for_update(skip_locked=True)
            ).first()
            if source is None:
                break
            lease_token = str(uuid4())
            source_id = source.id
            source_url = source.url
            etag = source.etag
            last_modified = source.last_modified
            source.fetch_lease_token = lease_token
            source.fetch_lease_expires_at = current + timedelta(minutes=self.lease_minutes)
            session.commit()
            due += 1

            started = datetime.now(UTC)
            try:
                document = self.fetcher.fetch(
                    source_url,
                    etag=etag,
                    last_modified=last_modified,
                )
                source = session.scalars(
                    select(SourceRecord)
                    .where(
                        SourceRecord.id == source_id,
                        SourceRecord.fetch_lease_token == lease_token,
                    )
                    .with_for_update()
                ).first()
                if source is None:
                    session.rollback()
                    failed += 1
                    if progress:
                        progress()
                    continue
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
                        commit=False,
                    )
                    if result and result.change_type == "unchanged":
                        unchanged += 1
                    else:
                        succeeded += 1
                source.last_seen_at = datetime.now(UTC)
                source.consecutive_failures = 0
                source.last_fetch_error = None
                source.next_fetch_at = current + timedelta(minutes=source.fetch_interval_minutes)
                source.fetch_lease_token = None
                source.fetch_lease_expires_at = None
                session.commit()
            except Exception as error:  # noqa: BLE001 - one failed source must not stop the batch
                session.rollback()
                source = session.scalars(
                    select(SourceRecord)
                    .where(
                        SourceRecord.id == source_id,
                        SourceRecord.fetch_lease_token == lease_token,
                    )
                    .with_for_update()
                ).first()
                if source is not None:
                    source.consecutive_failures += 1
                    source.last_fetch_error = str(error)[:2000]
                    retry_minutes = min(
                        self.retry_base_minutes * (2 ** (source.consecutive_failures - 1)),
                        self.retry_max_minutes,
                        source.fetch_interval_minutes,
                    )
                    source.next_fetch_at = current + timedelta(minutes=retry_minutes)
                    source.fetch_lease_token = None
                    source.fetch_lease_expires_at = None
                    session.add(
                        IngestionRunRecord(
                            id=str(uuid4()),
                            source_id=source_id,
                            started_at=started,
                            finished_at=datetime.now(UTC),
                            status="failed",
                            change_type="failed",
                            error=str(error)[:2000],
                        )
                    )
                    session.commit()
                else:
                    session.rollback()
                failed += 1
            if progress:
                progress()
        return SchedulerRunSummary(
            due=due,
            succeeded=succeeded,
            unchanged=unchanged,
            failed=failed,
        )
