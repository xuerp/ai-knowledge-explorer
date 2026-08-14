from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest

from app.database import Database, SourceRecord
from app.fetching import FetchedDocument, FetchPolicyError, SafeHttpFetcher
from app.ingestion import IngestionService, source_collection_policy
from app.scheduler import IngestionScheduler
from app.schemas import SourceCreate, SourceUpdate


def test_seeded_source_collection_policy_separates_automatic_and_manual_entries():
    assert source_collection_policy("s-qwen-models")[0] == "automatic"
    assert source_collection_policy("s-swebench")[0] == "automatic"
    assert source_collection_policy("s-openai-about")[0] == "manual"
    assert source_collection_policy("custom-source")[0] == "unverified"


def test_manual_only_source_cannot_enable_automatic_collection(tmp_path: Path):
    database = Database(f"sqlite:///{(tmp_path / 'manual-policy.db').as_posix()}")
    database.create_all()
    ingestion = IngestionService(("openai.com",))
    try:
        with database.session() as session:
            source = ingestion.create_source(
                session,
                SourceCreate(
                    id="s-openai-about",
                    url="https://openai.com/our-structure/",
                    title="OpenAI",
                    publisher="OpenAI",
                ),
            )
            _mark_probe_passed(session, source.id)
            with pytest.raises(ValueError, match="Render"):
                ingestion.update_source(
                    session,
                    source.id,
                    SourceUpdate(fetch_enabled=True),
                )
    finally:
        database.dispose()


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


def test_safe_fetcher_follows_allowlisted_canonical_redirect():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/docs/learn/architecture":
            return httpx.Response(
                307, headers={"location": "/docs/2026-07-28/learn/architecture"}
            )
        return httpx.Response(
            200,
            headers={"content-type": "text/plain"},
            text="A canonical official architecture document with enough readable content.",
        )

    fetcher = SafeHttpFetcher(
        ("example.com",),
        10_000,
        resolver=lambda _: ("8.8.8.8",),
        transport=httpx.MockTransport(handler),
    )
    document = fetcher.fetch("https://docs.example.com/docs/learn/architecture")
    assert document.final_url == (
        "https://docs.example.com/docs/2026-07-28/learn/architecture"
    )
    assert "canonical official architecture" in document.content


def test_safe_fetcher_rejects_redirect_outside_allowlist():
    fetcher = SafeHttpFetcher(
        ("example.com",),
        10_000,
        resolver=lambda _: ("8.8.8.8",),
        transport=httpx.MockTransport(
            lambda _: httpx.Response(302, headers={"location": "https://attacker.test/path"})
        ),
    )
    with pytest.raises(FetchPolicyError, match="not in"):
        fetcher.fetch("https://docs.example.com/old-path")


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


class _RecordingFetcher:
    def __init__(self):
        self.urls: list[str] = []

    def fetch(self, url: str, **_: object) -> FetchedDocument:
        self.urls.append(url)
        return FetchedDocument(
            content=f"A sufficiently long official release document collected from {url}.",
            content_type="text/plain",
            etag=f'"{len(self.urls)}"',
            last_modified=None,
        )


class _LeaseInspectingFetcher:
    def __init__(self, database: Database, source_id: str):
        self.database = database
        self.source_id = source_id
        self.lease_expires_at: datetime | None = None

    def fetch(self, url: str, **_: object) -> FetchedDocument:
        with self.database.session() as session:
            source = session.get(SourceRecord, self.source_id)
            assert source is not None
            self.lease_expires_at = source.fetch_lease_expires_at
        return FetchedDocument(
            content=f"A sufficiently long official release document collected from {url}.",
            content_type="text/plain",
            etag='"lease"',
            last_modified=None,
        )


def test_scheduler_fetch_lease_uses_claim_time_instead_of_stale_cycle_time(tmp_path: Path):
    database = Database(f"sqlite:///{(tmp_path / 'fresh-lease.db').as_posix()}")
    database.create_all()
    ingestion = IngestionService(("example.com",))
    source_id = "fresh-lease-source"
    stale_cycle_time = datetime.now(UTC) - timedelta(hours=1)
    fetcher = _LeaseInspectingFetcher(database, source_id)
    scheduler = IngestionScheduler(fetcher, ingestion, lease_minutes=5)  # type: ignore[arg-type]

    try:
        with database.session() as session:
            ingestion.create_source(
                session,
                SourceCreate(
                    id=source_id,
                    url="https://example.com/fresh-lease",
                    title="Fresh lease source",
                    publisher="Example",
                ),
            )
            _mark_probe_passed(session, source_id)
            ingestion.update_source(session, source_id, SourceUpdate(fetch_enabled=True))

            result = scheduler.run_due(session, now=stale_cycle_time, limit=1, force=True)

        assert result.succeeded == 1
        assert fetcher.lease_expires_at is not None
        assert fetcher.lease_expires_at.replace(tzinfo=UTC) > datetime.now(UTC)
    finally:
        database.dispose()


def test_scheduler_processes_multiple_due_sources_in_one_batch(tmp_path: Path):
    database = Database(f"sqlite:///{(tmp_path / 'scheduler-batch.db').as_posix()}")
    database.create_all()
    ingestion = IngestionService(("example.com",))
    fetcher = _RecordingFetcher()
    scheduler = IngestionScheduler(fetcher, ingestion)  # type: ignore[arg-type]
    start = datetime(2026, 8, 14, 2, 0, tzinfo=UTC)

    with database.session() as session:
        for source_id in ("batch-source-a", "batch-source-b"):
            ingestion.create_source(
                session,
                SourceCreate(
                    id=source_id,
                    url=f"https://example.com/{source_id}",
                    title=source_id,
                    publisher="Example",
                    fetch_interval_minutes=120,
                ),
            )
            _mark_probe_passed(session, source_id)
            ingestion.update_source(session, source_id, SourceUpdate(fetch_enabled=True))

        result = scheduler.run_due(session, now=start, limit=20)

        assert result.model_dump() == {
            "due": 2,
            "succeeded": 2,
            "unchanged": 0,
            "failed": 0,
        }
        assert set(fetcher.urls) == {
            "https://example.com/batch-source-a",
            "https://example.com/batch-source-b",
        }

    database.dispose()


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
