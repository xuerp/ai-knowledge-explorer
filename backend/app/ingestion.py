from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from .database import (
    DocumentSnapshotRecord,
    IngestionRunRecord,
    ReviewJobRecord,
    SourceRecord,
)
from .fetching import PERMANENT_FETCH_FAILURE_KINDS, classify_fetch_failure_message
from .schemas import (
    CandidateCreate,
    DocumentIngestRequest,
    IngestionResult,
    IngestionRunView,
    SourceCreate,
    SourceUpdate,
    SourceView,
)

AUTOMATIC_SOURCE_IDS = {
    "s-openai-api-changelog",
    "s-openai-models",
    "s-openai-deprecations",
    "s-mcp-architecture",
    "s-langchain-overview",
    "s-anthropic-company",
    "s-cursor-docs",
    "s-qwen-models",
    "s-swebench",
}

MANUAL_SOURCE_IDS = {
    "s-openai-about",
    "s-openai-gpt5",
    "s-openai-codex",
}


def source_collection_policy(source_id: str) -> tuple[str, str]:
    if source_id in AUTOMATIC_SOURCE_IDS:
        return "automatic", "已验证为体积可控、无需凭据的官方机器入口。"
    if source_id in MANUAL_SOURCE_IDS:
        return "manual", "目标官网拒绝 Render 云服务器访问，保留人工采集与审核。"
    return "unverified", "尚未完成自动采集入口验证，需先核验域名、体积与内容稳定性。"


def _load_fallback_urls(row: SourceRecord) -> list[str]:
    try:
        raw_urls = json.loads(row.fallback_urls_json or "[]")
    except json.JSONDecodeError:
        return []
    return [str(url) for url in raw_urls if isinstance(url, str) and url]


def source_fetch_urls(row: SourceRecord) -> list[str]:
    candidates = [
        row.last_successful_fetch_url,
        row.fetch_url or row.url,
        *_load_fallback_urls(row),
    ]
    urls: list[str] = []
    for candidate in candidates:
        if not candidate:
            continue
        normalized = normalize_source_url(candidate)
        if normalized not in urls:
            urls.append(normalized)
    return urls


def source_collection_policy_for_record(row: SourceRecord) -> tuple[str, str]:
    effective_url = row.fetch_url or row.url
    if row.id in MANUAL_SOURCE_IDS and normalize_source_url(effective_url) == normalize_source_url(
        row.url
    ):
        return source_collection_policy(row.id)
    if row.id in AUTOMATIC_SOURCE_IDS:
        return source_collection_policy(row.id)
    if row.last_probe_status == "passed":
        return "automatic", "连接预检已通过，入口可按安全采集策略自动运行。"
    return source_collection_policy(row.id)


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
    PROBE_VALID_HOURS = 24

    def __init__(self, allowed_hosts: tuple[str, ...] = ()) -> None:
        self.allowed_hosts = tuple(host.casefold() for host in allowed_hosts)

    def _validate_fetch_enabled(self, url: str, fetch_enabled: bool) -> None:
        if not fetch_enabled:
            return
        parsed = urlsplit(url)
        host = (parsed.hostname or "").casefold()
        if parsed.scheme != "https" or not host:
            raise ValueError("Automatic collection requires a valid HTTPS source URL.")
        if not any(
            host == allowed or host.endswith(f".{allowed}") for allowed in self.allowed_hosts
        ):
            raise ValueError(
                "Add the source hostname to AI_RADAR_FETCH_ALLOWED_HOSTS before enabling "
                "automatic collection."
            )

    def _validate_collection_policy(self, source_id: str, fetch_enabled: bool) -> None:
        if not fetch_enabled:
            return
        strategy, reason = source_collection_policy(source_id)
        if strategy == "manual":
            raise ValueError(reason)

    def _validate_record_collection_policy(
        self,
        record: SourceRecord,
        fetch_enabled: bool,
    ) -> None:
        if not fetch_enabled:
            return
        strategy, reason = source_collection_policy_for_record(record)
        if strategy == "manual":
            raise ValueError(reason)

    def create_source(self, session: Session, payload: SourceCreate) -> SourceView:
        now = datetime.now(UTC)
        normalized_url = normalize_source_url(str(payload.url))
        if payload.fetch_enabled:
            raise ValueError(
                "Register the source first, run a successful connection preflight, then enable "
                "automatic collection."
            )
        record = SourceRecord(
            id=payload.id,
            url=normalized_url,
            title=payload.title.strip(),
            publisher=payload.publisher.strip(),
            fetch_url=(
                normalize_source_url(str(payload.fetch_url))
                if payload.fetch_url is not None
                else None
            ),
            fallback_urls_json=json.dumps(
                [normalize_source_url(str(url)) for url in payload.fallback_urls],
                ensure_ascii=False,
            ),
            active=True,
            fetch_enabled=payload.fetch_enabled,
            fetch_interval_minutes=payload.fetch_interval_minutes,
            # A newly enabled source is intentionally unscheduled so the next
            # scheduler tick treats it as immediately due, independent of
            # sub-millisecond clock ordering between API and worker processes.
            next_fetch_at=None,
            created_at=now,
        )
        session.add(record)
        session.commit()
        return self.to_source_view(record)

    def list_sources(self, session: Session) -> list[SourceView]:
        rows = session.scalars(select(SourceRecord).order_by(SourceRecord.created_at)).all()
        return [self.to_source_view(row) for row in rows]

    def reconcile_historical_permanent_failures(self, session: Session) -> int:
        """将旧版本遗留的永久失败信源纳入熔断，避免继续无限退避。"""
        rows = session.scalars(
            select(SourceRecord).where(
                SourceRecord.fetch_enabled.is_(True),
                SourceRecord.auto_paused_at.is_(None),
                SourceRecord.consecutive_failures >= 3,
                SourceRecord.last_fetch_error.is_not(None),
            )
        ).all()
        paused = 0
        current = datetime.now(UTC)
        for row in rows:
            failure_kind = classify_fetch_failure_message(row.last_fetch_error or "")
            row.failure_kind = failure_kind
            if failure_kind not in PERMANENT_FETCH_FAILURE_KINDS:
                continue
            row.auto_paused_at = current
            row.next_fetch_at = None
            paused += 1
        if rows:
            session.commit()
        return paused

    def update_source(
        self,
        session: Session,
        source_id: str,
        payload: SourceUpdate,
    ) -> SourceView | None:
        record = session.get(SourceRecord, source_id)
        if not record:
            return None

        was_fetch_enabled = record.fetch_enabled
        endpoint_changed = False
        if "fetch_url" in payload.model_fields_set:
            next_fetch_url = (
                normalize_source_url(str(payload.fetch_url))
                if payload.fetch_url is not None
                else None
            )
            endpoint_changed = next_fetch_url != record.fetch_url
            record.fetch_url = next_fetch_url
        if "fallback_urls" in payload.model_fields_set:
            next_fallback_urls = [
                normalize_source_url(str(url)) for url in (payload.fallback_urls or [])
            ]
            endpoint_changed = endpoint_changed or next_fallback_urls != _load_fallback_urls(record)
            record.fallback_urls_json = json.dumps(next_fallback_urls, ensure_ascii=False)
        if endpoint_changed:
            record.etag = None
            record.last_modified = None
            record.last_successful_fetch_url = None
            record.consecutive_failures = 0
            record.last_fetch_error = None
            record.failure_kind = None
            record.auto_paused_at = None
            record.last_probe_at = None
            record.last_probe_status = None
            record.last_probe_error = None
            record.fetch_enabled = False
            record.next_fetch_at = None
        if payload.fetch_enabled:
            self._validate_record_collection_policy(record, True)
            for source_url in source_fetch_urls(record):
                self._validate_fetch_enabled(source_url, True)
            probe_at = record.last_probe_at
            if probe_at and probe_at.tzinfo is None:
                probe_at = probe_at.replace(tzinfo=UTC)
            if (
                record.last_probe_status != "passed"
                or probe_at is None
                or probe_at < datetime.now(UTC) - timedelta(hours=self.PROBE_VALID_HOURS)
            ):
                raise ValueError(
                    "Run a successful source connection preflight within 24 hours before "
                    "enabling automatic collection."
                )
        if payload.active is not None:
            record.active = payload.active
        if payload.fetch_enabled is not None:
            record.fetch_enabled = payload.fetch_enabled
        if payload.fetch_interval_minutes is not None:
            record.fetch_interval_minutes = payload.fetch_interval_minutes

        # A disabled source must never remain schedulable. Newly enabling a
        # source clears its schedule so the next worker tick picks it up now.
        if not record.active:
            record.fetch_enabled = False
            record.next_fetch_at = None
            record.fetch_lease_token = None
            record.fetch_lease_expires_at = None
        elif record.fetch_enabled and not was_fetch_enabled:
            record.next_fetch_at = None

        session.commit()
        return self.to_source_view(record)

    def queue_source_retry(
        self,
        session: Session,
        source_id: str,
        expected_failure_count: int,
    ) -> SourceView | None:
        current = datetime.now(UTC)
        statement = (
            update(SourceRecord)
            .where(
                SourceRecord.id == source_id,
                SourceRecord.active.is_(True),
                SourceRecord.fetch_enabled.is_(True),
                SourceRecord.consecutive_failures == expected_failure_count,
                or_(
                    SourceRecord.fetch_lease_token.is_(None),
                    SourceRecord.fetch_lease_expires_at.is_(None),
                    SourceRecord.fetch_lease_expires_at <= current,
                ),
            )
            .values(
                next_fetch_at=None,
                fetch_lease_token=None,
                fetch_lease_expires_at=None,
                auto_paused_at=None,
                failure_kind=None,
                consecutive_failures=0,
                last_fetch_error=None,
            )
            .returning(SourceRecord)
        )
        record = session.scalars(statement.execution_options(populate_existing=True)).first()
        if record is None:
            existing = session.get(SourceRecord, source_id)
            if existing is None:
                return None
            raise ValueError("The source state changed and it can no longer be requeued.")
        session.flush()
        return self.to_source_view(record)

    def ingest_document(
        self,
        session: Session,
        source_id: str,
        payload: DocumentIngestRequest,
        *,
        commit: bool = True,
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
            .order_by(
                DocumentSnapshotRecord.observed_at.desc(),
                DocumentSnapshotRecord.id.desc(),
            )
            .limit(1)
        ).first()

        if previous and previous.content_hash == content_hash:
            snapshot = previous
            change_type = "unchanged"
        else:
            observed_at = started_at
            if previous:
                previous_observed_at = previous.observed_at
                if previous_observed_at.tzinfo is None:
                    previous_observed_at = previous_observed_at.replace(tzinfo=UTC)
                if observed_at <= previous_observed_at:
                    observed_at = previous_observed_at + timedelta(microseconds=1)
            snapshot = DocumentSnapshotRecord(
                id=str(uuid4()),
                source_id=source_id,
                content_hash=content_hash,
                content_text=content,
                observed_at=observed_at,
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
        if commit:
            session.commit()
        else:
            session.flush()
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
        limit: int = 200,
    ) -> list[IngestionRunView]:
        statement = select(IngestionRunRecord).order_by(IngestionRunRecord.started_at.desc())
        if source_id:
            statement = statement.where(IngestionRunRecord.source_id == source_id)
        rows = session.scalars(statement.limit(limit)).all()
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
        strategy, reason = source_collection_policy_for_record(row)
        fallback_urls = _load_fallback_urls(row)
        if strategy == "manual":
            health_state = "manual"
        elif row.auto_paused_at is not None:
            health_state = "paused"
        elif row.consecutive_failures > 0:
            health_state = "retrying"
        elif strategy == "unverified":
            health_state = "unverified"
        else:
            health_state = "healthy"
        return SourceView(
            id=row.id,
            url=row.url,
            title=row.title,
            publisher=row.publisher,
            fetch_url=row.fetch_url,
            effective_fetch_url=row.fetch_url or row.url,
            fallback_urls=fallback_urls,
            last_successful_fetch_url=row.last_successful_fetch_url,
            active=row.active,
            fetch_enabled=row.fetch_enabled,
            fetch_interval_minutes=row.fetch_interval_minutes,
            next_fetch_at=row.next_fetch_at,
            created_at=row.created_at,
            last_seen_at=row.last_seen_at,
            consecutive_failures=row.consecutive_failures,
            last_fetch_error=row.last_fetch_error,
            failure_kind=row.failure_kind,
            auto_paused_at=row.auto_paused_at,
            health_state=health_state,
            fetch_lease_expires_at=row.fetch_lease_expires_at,
            last_probe_at=row.last_probe_at,
            last_probe_status=row.last_probe_status,
            last_probe_error=row.last_probe_error,
            last_probe_content_type=row.last_probe_content_type,
            last_probe_readable_characters=row.last_probe_readable_characters,
            collection_strategy=strategy,
            collection_reason=reason,
        )
