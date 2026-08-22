from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .database import DocumentSnapshotRecord, IngestionRunRecord, SourceRecord
from .fetching import (
    PERMANENT_FETCH_FAILURE_KINDS,
    SafeHttpFetcher,
    classify_fetch_failure,
)
from .ingestion import IngestionService, source_fetch_urls
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
        source_id: str | None = None,
        force: bool = False,
    ) -> SchedulerRunSummary:
        current = now or datetime.now(UTC)
        requested_source_id = source_id
        due = succeeded = unchanged = failed = 0
        failed_source_ids: list[str] = []
        for _ in range(limit):
            claim_time = datetime.now(UTC)
            conditions = [
                SourceRecord.active.is_(True),
                SourceRecord.fetch_enabled.is_(True),
                SourceRecord.auto_paused_at.is_(None),
                or_(
                    SourceRecord.fetch_lease_token.is_(None),
                    SourceRecord.fetch_lease_expires_at.is_(None),
                    SourceRecord.fetch_lease_expires_at <= claim_time,
                ),
            ]
            if not force:
                conditions.append(
                    or_(
                        SourceRecord.next_fetch_at.is_(None),
                        SourceRecord.next_fetch_at <= current,
                    )
                )
            if requested_source_id is not None:
                conditions.append(SourceRecord.id == requested_source_id)
            source = session.scalars(
                select(SourceRecord)
                .where(*conditions)
                .order_by(SourceRecord.next_fetch_at.asc().nullsfirst())
                .limit(1)
                .with_for_update(skip_locked=True)
            ).first()
            if source is None:
                break
            lease_token = str(uuid4())
            claimed_source_id = source.id
            fetch_urls = source_fetch_urls(source)
            etag = source.etag
            last_modified = source.last_modified
            last_successful_fetch_url = source.last_successful_fetch_url
            source.fetch_lease_token = lease_token
            source.fetch_lease_expires_at = claim_time + timedelta(minutes=self.lease_minutes)
            session.commit()
            due += 1

            started = datetime.now(UTC)
            try:
                document = None
                successful_fetch_url = None
                last_error: Exception | None = None
                for fetch_url in fetch_urls:
                    try:
                        document = self.fetcher.fetch(
                            fetch_url,
                            etag=etag if fetch_url == last_successful_fetch_url else None,
                            last_modified=(
                                last_modified if fetch_url == last_successful_fetch_url else None
                            ),
                        )
                        successful_fetch_url = document.final_url or fetch_url
                        break
                    except Exception as error:  # noqa: BLE001 - try vetted fallback entrypoints
                        last_error = error
                if document is None or successful_fetch_url is None:
                    raise last_error or RuntimeError("Source has no configured collection URL.")
                source = session.scalars(
                    select(SourceRecord)
                    .where(
                        SourceRecord.id == claimed_source_id,
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
                source.last_successful_fetch_url = successful_fetch_url
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
                source.failure_kind = None
                source.auto_paused_at = None
                source.next_fetch_at = current + timedelta(minutes=source.fetch_interval_minutes)
                source.fetch_lease_token = None
                source.fetch_lease_expires_at = None
                session.commit()
            except Exception as error:  # noqa: BLE001 - one failed source must not stop the batch
                session.rollback()
                source = session.scalars(
                    select(SourceRecord)
                    .where(
                        SourceRecord.id == claimed_source_id,
                        SourceRecord.fetch_lease_token == lease_token,
                    )
                    .with_for_update()
                ).first()
                if source is not None:
                    source.consecutive_failures += 1
                    source.last_fetch_error = str(error)[:2000]
                    source.failure_kind = classify_fetch_failure(error)
                    retry_minutes = min(
                        self.retry_base_minutes * (2 ** (source.consecutive_failures - 1)),
                        self.retry_max_minutes,
                        source.fetch_interval_minutes,
                    )
                    if (
                        source.failure_kind in PERMANENT_FETCH_FAILURE_KINDS
                        and source.consecutive_failures >= 3
                    ):
                        source.auto_paused_at = datetime.now(UTC)
                        source.next_fetch_at = None
                    else:
                        source.next_fetch_at = current + timedelta(minutes=retry_minutes)
                    source.fetch_lease_token = None
                    source.fetch_lease_expires_at = None
                    session.add(
                        IngestionRunRecord(
                            id=str(uuid4()),
                            source_id=claimed_source_id,
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
                failed_source_ids.append(claimed_source_id)
            if progress:
                progress()
            if requested_source_id is not None:
                break
        return SchedulerRunSummary(
            due=due,
            succeeded=succeeded,
            unchanged=unchanged,
            failed=failed,
            failed_source_ids=failed_source_ids,
        )
