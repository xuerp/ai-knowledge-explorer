from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest

from app.database import Database, SourceRecord
from app.fetching import FetchedDocument, FetchPolicyError, SafeHttpFetcher
from app.ingestion import IngestionService
from app.scheduler import IngestionScheduler
from app.schemas import SourceCreate, SourceUpdate


def test_safe_fetcher_enforces_allowlist_public_dns_and_content_policy():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["user-agent"].startswith("AI-Radar-Collector/")
        return httpx.Response(
            200,
            headers={"content-type": "text/html; charset=utf-8", "etag": '"v1"'},
            text="<html><script>ignore()</script><article><h1>Release</h1>"
            "<p>Evidence-linked graph query is now available.</p></article></html>",
        )

    fetcher = SafeHttpFetcher(
        ("example.com",),
        10_000,
        resolver=lambda _: ("8.8.8.8",),
        transport=httpx.MockTransport(handler),
    )
    document = fetcher.fetch("https://docs.example.com/release")
    assert document.etag == '"v1"'
    assert "Evidence-linked graph query" in document.content
    assert "ignore()" not in document.content

    with pytest.raises(FetchPolicyError, match="not in"):
        fetcher.fetch("https://other.example.net/release")
    with pytest.raises(FetchPolicyError, match="HTTPS"):
        fetcher.fetch("http://docs.example.com/release")

    private_fetcher = SafeHttpFetcher(
        ("example.com",),
        10_000,
        resolver=lambda _: ("127.0.0.1",),
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(FetchPolicyError, match="non-public"):
        private_fetcher.fetch("https://example.com/release")


def test_safe_fetcher_reports_valid_canonical_redirect_without_following_it():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(307, headers={"location": "/docs/2026-07-28/learn/architecture"})

    fetcher = SafeHttpFetcher(
        ("example.com",),
        10_000,
        resolver=lambda _: ("8.8.8.8",),
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(
        FetchPolicyError,
        match=r"https://docs\.example\.com/docs/2026-07-28/learn/architecture",
    ):
        fetcher.fetch("https://docs.example.com/docs/learn/architecture")


def test_automatic_source_requires_allowlisted_https_host(tmp_path: Path):
    database = Database(f"sqlite:///{(tmp_path / 'source-policy.db').as_posix()}")
    database.create_all()
    ingestion = IngestionService(("openai.com",))
    try:
        with database.session() as session:
            with pytest.raises(ValueError, match="connection preflight"):
                ingestion.create_source(
                    session,
                    SourceCreate(
                        id="blocked-source",
                        url="https://example.com/releases",
                        title="Blocked source",
                        publisher="Example",
                        fetch_enabled=True,
                    ),
                )
            source = ingestion.create_source(
                session,
                SourceCreate(
                    id="manual-source",
                    url="https://example.com/releases",
                    title="Manual source",
                    publisher="Example",
                ),
            )
            with pytest.raises(ValueError, match="AI_RADAR_FETCH_ALLOWED_HOSTS"):
                ingestion.update_source(
                    session,
                    source.id,
                    SourceUpdate(fetch_enabled=True),
                )
            allowed_source = ingestion.create_source(
                session,
                SourceCreate(
                    id="allowed-manual-source",
                    url="https://openai.com/releases",
                    title="Allowed manual source",
                    publisher="OpenAI",
                ),
            )
            with pytest.raises(ValueError, match="within 24 hours"):
                ingestion.update_source(
                    session,
                    allowed_source.id,
                    SourceUpdate(fetch_enabled=True),
                )
    finally:
        database.dispose()


def _mark_probe_passed(session, source_id: str) -> None:
    source = session.get(SourceRecord, source_id)
    assert source is not None
    source.last_probe_at = datetime.now(UTC)
    source.last_probe_status = "passed"
    session.commit()


class _SequenceFetcher:
    def __init__(self):
        self.calls = 0

    def fetch(self, url: str, **_: object) -> FetchedDocument:
        self.calls += 1
        if self.calls == 1:
            return FetchedDocument(
                content="A sufficiently long official release document for the first snapshot.",
                content_type="text/plain",
                etag='"v1"',
                last_modified=None,
            )
        return FetchedDocument(
            content="",
            content_type="",
            etag='"v1"',
            last_modified=None,
            not_modified=True,
        )


class _FailThenSucceedFetcher:
    def __init__(self):
        self.calls = 0

    def fetch(self, url: str, **_: object) -> FetchedDocument:
        self.calls += 1
        if self.calls == 1:
            raise httpx.ConnectTimeout(f"Temporary timeout for {url}")
        return FetchedDocument(
            content="A recovered official release document with enough content to ingest.",
            content_type="text/plain",
            etag='"recovered"',
            last_modified=None,
        )


def test_scheduler_runs_due_sources_and_records_not_modified(tmp_path: Path):
    database = Database(f"sqlite:///{(tmp_path / 'scheduler.db').as_posix()}")
    database.create_all()
    ingestion = IngestionService(("example.com",))
    fetcher = _SequenceFetcher()
    scheduler = IngestionScheduler(fetcher, ingestion)  # type: ignore[arg-type]
    start = datetime.now(UTC)

    with database.session() as session:
        ingestion.create_source(
            session,
            SourceCreate(
                id="scheduled-source",
                url="https://example.com/releases",
                title="Scheduled release source",
                publisher="Example",
                fetch_interval_minutes=120,
            ),
        )
        _mark_probe_passed(session, "scheduled-source")
        ingestion.update_source(session, "scheduled-source", SourceUpdate(fetch_enabled=True))
        first = scheduler.run_due(session, now=start)
        assert first.due == 1
        assert first.succeeded == 1

        forced = scheduler.run_due(
            session,
            now=start + timedelta(minutes=1),
            source_id="scheduled-source",
            force=True,
            limit=1,
        )
        assert forced.due == 1
        assert forced.unchanged == 1

        second = scheduler.run_due(session, now=start + timedelta(minutes=121))
        assert second.due == 1
        assert second.unchanged == 1
        assert fetcher.calls == 3
        runs = ingestion.list_runs(session, "scheduled-source")
        assert [run.change_type for run in runs] == ["unchanged", "unchanged", "created"]

    database.dispose()


def test_scheduler_retries_failures_early_and_clears_failure_state(tmp_path: Path):
    database = Database(f"sqlite:///{(tmp_path / 'retry.db').as_posix()}")
    database.create_all()
    ingestion = IngestionService(("example.com",))
    fetcher = _FailThenSucceedFetcher()
    scheduler = IngestionScheduler(
        fetcher,  # type: ignore[arg-type]
        ingestion,
        retry_base_minutes=15,
        retry_max_minutes=60,
    )
    start = datetime(2026, 8, 9, 3, 0, tzinfo=UTC)

    with database.session() as session:
        ingestion.create_source(
            session,
            SourceCreate(
                id="retry-source",
                url="https://example.com/retry",
                title="Retry release source",
                publisher="Example",
                fetch_interval_minutes=120,
            ),
        )
        _mark_probe_passed(session, "retry-source")
        ingestion.update_source(session, "retry-source", SourceUpdate(fetch_enabled=True))
        failed = scheduler.run_due(session, now=start)
        assert failed.model_dump() == {
            "due": 1,
            "succeeded": 0,
            "unchanged": 0,
            "failed": 1,
        }
        source = ingestion.list_sources(session)[0]
        assert source.consecutive_failures == 1
        assert "Temporary timeout" in (source.last_fetch_error or "")
        assert source.next_fetch_at is not None
        assert source.next_fetch_at.replace(tzinfo=UTC) == start + timedelta(minutes=15)
        assert ingestion.list_runs(session, "retry-source")[0].change_type == "failed"

        not_due = scheduler.run_due(session, now=start + timedelta(minutes=14))
        assert not_due.due == 0
        recovered = scheduler.run_due(session, now=start + timedelta(minutes=15))
        assert recovered.succeeded == 1
        source = ingestion.list_sources(session)[0]
        assert source.consecutive_failures == 0
        assert source.last_fetch_error is None
        assert source.next_fetch_at is not None
        assert source.next_fetch_at.replace(tzinfo=UTC) == start + timedelta(minutes=135)

    database.dispose()


def test_manual_source_retry_respects_active_fetch_lease(tmp_path: Path):
    database = Database(f"sqlite:///{(tmp_path / 'source-lease.db').as_posix()}")
    database.create_all()
    ingestion = IngestionService(("example.com",))
    now = datetime.now(UTC)

    with database.session() as session:
        ingestion.create_source(
            session,
            SourceCreate(
                id="leased-source",
                url="https://example.com/leased",
                title="Leased release source",
                publisher="Example",
            ),
        )
        _mark_probe_passed(session, "leased-source")
        ingestion.update_source(session, "leased-source", SourceUpdate(fetch_enabled=True))
        row = session.get(SourceRecord, "leased-source")
        assert row is not None
        row.fetch_lease_token = "active-lease"
        row.fetch_lease_expires_at = now + timedelta(minutes=5)
        session.commit()

        with pytest.raises(ValueError, match="state changed"):
            ingestion.queue_source_retry(session, row.id, expected_failure_count=0)

        row.fetch_lease_expires_at = now - timedelta(seconds=1)
        session.commit()
        retried = ingestion.queue_source_retry(session, row.id, expected_failure_count=0)
        assert retried is not None
        assert retried.fetch_lease_expires_at is None
        assert row.fetch_lease_token is None

    database.dispose()
