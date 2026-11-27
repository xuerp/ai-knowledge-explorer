from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from sqlalchemy import select

from app.database import Database, EntryRequestRecord, SourceRecord
from app.fetching import FetchedDocument
from app.ingestion import IngestionService
from app.release_discovery import ReleaseDiscoveryResult, discover_release_leads
from app.scheduler import IngestionScheduler


def test_discovery_queues_scoped_links_once_and_keeps_them_unpublished(tmp_path):
    database = Database(f"sqlite:///{(tmp_path / 'discovery.db').as_posix()}")
    database.create_all()
    root = SimpleNamespace(
        id="s-moonshot-research-index",
        url="https://www.kimi.ai/blog/",
        publisher="Moonshot AI",
    )
    response = FetchedDocument(
        content="Official document index",
        content_type="text/html",
        etag=None,
        last_modified=None,
        links=(
            ("/blog/kimi-k9", "Future example"),
            ("/blog/kimi-k9#release", "Same example"),
            ("https://external.invalid/blog/kimi-k9", "Untrusted host"),
            ("/blog/kimi-k9?query=redirect", "Out of scope"),
            ("/blog/kimi-k9%2Fother", "Escaped path"),
        ),
    )
    with database.session() as session:
        assert discover_release_leads(session, root, response, datetime.now(UTC)) == (
            ReleaseDiscoveryResult(queued=1)
        )
        session.commit()
        assert discover_release_leads(session, root, response, datetime.now(UTC)) == (
            ReleaseDiscoveryResult()
        )
        request = session.scalar(select(EntryRequestRecord))
        assert request.status == "pending" and request.entity_id is None
        assert request.source_url == "https://www.kimi.ai/blog/kimi-k9"


def test_openai_markdown_changelog_queues_only_official_general_model_pages(tmp_path):
    database = Database(f"sqlite:///{(tmp_path / 'openai-discovery.db').as_posix()}")
    database.create_all()
    now = datetime.now(UTC)
    url = "https://developers.openai.com/api/docs/changelog.md"
    response = FetchedDocument(
        content=(
            "[GPT-6.2 Astra](https://developers.openai.com/api/docs/models/gpt-6.2-astra)\n"
            "[GPT-6.2 Sol](/api/docs/models/gpt-6.2-sol.md)\n"
            "[Same Sol](/api/docs/models/gpt-6.2-sol#pricing)\n"
            "[External](https://external.invalid/api/docs/models/gpt-6.2-terra)\n"
            "[Specialized](/api/docs/models/gpt-6.2-astra-law)\n"
            "[Out of scope](/api/docs/models/gpt-6.2-luna?redirect=1)"
        ),
        content_type="text/markdown",
        etag=None,
        last_modified=None,
        final_url=url,
    )
    scheduler = IngestionScheduler(
        SimpleNamespace(fetch=lambda *args, **kwargs: response),
        IngestionService(("developers.openai.com",)),
    )
    with database.session() as session:
        session.add(
            SourceRecord(
                id="s-openai-api-changelog",
                url=url,
                title="OpenAI API changelog",
                publisher="OpenAI",
                active=True,
                fetch_enabled=True,
                fetch_interval_minutes=120,
                created_at=now,
                next_fetch_at=now,
            )
        )
        session.commit()

        assert scheduler.run_due(session, now=now).succeeded == 1
        assert scheduler.run_due(session, now=now + timedelta(hours=2)).unchanged == 1
        requests = session.scalars(select(EntryRequestRecord)).all()
        assert {row.source_url for row in requests} == {
            "https://developers.openai.com/api/docs/models/gpt-6.2-astra",
            "https://developers.openai.com/api/docs/models/gpt-6.2-sol",
        }
        assert all(row.status == "pending" and row.entity_id is None for row in requests)


def test_discovery_finishes_deferred_links_before_accepting_unchanged_index(tmp_path):
    database = Database(f"sqlite:///{(tmp_path / 'deferred.db').as_posix()}")
    database.create_all()
    now = datetime.now(UTC)
    url = "https://www.kimi.ai/blog/"
    validator = '"same-index"'
    modified = "Wed, 18 Nov 2026 00:00:00 GMT"
    requests = []

    def fetch(url, *, etag=None, last_modified=None):
        requests.append((etag, last_modified))
        return FetchedDocument(
            content="Unchanged official document index",
            content_type="text/html",
            etag=validator,
            last_modified=modified,
            not_modified=bool(etag or last_modified),
            final_url=url,
            links=tuple(
                (f"/blog/kimi-k{number}", f"Synthetic release {number}") for number in range(6)
            )
            if not (etag or last_modified)
            else (),
        )

    scheduler = IngestionScheduler(SimpleNamespace(fetch=fetch), IngestionService(("www.kimi.ai",)))
    with database.session() as session:
        session.add(
            SourceRecord(
                id="s-moonshot-research-index",
                url=url,
                title="Test index",
                publisher="Moonshot AI",
                active=True,
                fetch_enabled=True,
                fetch_interval_minutes=240,
                created_at=now,
                next_fetch_at=now,
            )
        )
        session.commit()

        assert scheduler.run_due(session, now=now).succeeded == 1
        assert len(session.scalars(select(EntryRequestRecord)).all()) == 4
        assert scheduler.run_due(session, now=now + timedelta(hours=4)).unchanged == 1
        assert len(session.scalars(select(EntryRequestRecord)).all()) == 6
        assert scheduler.run_due(session, now=now + timedelta(hours=8)).unchanged == 1
        assert len(session.scalars(select(EntryRequestRecord)).all()) == 6

    assert requests == [(None, None), (None, None), (validator, modified)]
