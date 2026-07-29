from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest

from app.database import Database
from app.fetching import FetchedDocument, FetchPolicyError, SafeHttpFetcher
from app.ingestion import IngestionService
from app.scheduler import IngestionScheduler
from app.schemas import SourceCreate


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


def test_scheduler_runs_due_sources_and_records_not_modified(tmp_path: Path):
    database = Database(f"sqlite:///{(tmp_path / 'scheduler.db').as_posix()}")
    database.create_all()
    ingestion = IngestionService()
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
                fetch_enabled=True,
                fetch_interval_minutes=120,
            ),
        )
        first = scheduler.run_due(session, now=start)
        assert first.due == 1
        assert first.succeeded == 1

        second = scheduler.run_due(session, now=start + timedelta(minutes=121))
        assert second.due == 1
        assert second.unchanged == 1
        assert fetcher.calls == 2
        runs = ingestion.list_runs(session, "scheduled-source")
        assert [run.change_type for run in runs] == ["unchanged", "created"]

    database.dispose()
