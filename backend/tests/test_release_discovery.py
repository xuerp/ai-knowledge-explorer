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
        id="s-google-model-card-index",
        url="https://deepmind.google/models/model-cards/",
        publisher="Google DeepMind",
    )
    response = FetchedDocument(
        content="Official document index",
        content_type="text/html",
        etag=None,
        last_modified=None,
        links=(
            ("/models/model-cards/gemini-next/", "Future example"),
            ("/models/model-cards/gemini-next/#release", "Same example"),
            ("https://external.invalid/models/model-cards/gemini-next", "Untrusted host"),
            ("/models/model-cards/gemini-next/?query=redirect", "Out of scope"),
            ("/models/model-cards/gemini-next%2Fother/", "Escaped path"),
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
        assert request.source_url == "https://deepmind.google/models/model-cards/gemini-next/"


def test_discovery_finishes_deferred_links_before_accepting_unchanged_index(tmp_path):
    database = Database(f"sqlite:///{(tmp_path / 'deferred.db').as_posix()}")
    database.create_all()
    now = datetime.now(UTC)
    url = "https://deepmind.google/models/model-cards/"
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
                (f"/models/model-cards/gemini-qa-{number}/", f"Synthetic release {number}")
                for number in range(6)
            )
            if not (etag or last_modified)
            else (),
        )

    scheduler = IngestionScheduler(
        SimpleNamespace(fetch=fetch), IngestionService(("deepmind.google",))
    )
    with database.session() as session:
        session.add(
            SourceRecord(
                id="s-google-model-card-index",
                url=url,
                title="Test index",
                publisher="Google DeepMind",
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
