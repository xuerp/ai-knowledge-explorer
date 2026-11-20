"""Database revision for collections that feed the published detail snapshot."""

from collections import OrderedDict
from hashlib import sha256
from threading import Lock
from time import monotonic

from sqlalchemy import text

from .entity_detail import project_entity_detail
from .schemas import KnowledgeSnapshot

CATALOG_TABLES = ("knowledge_entities", "knowledge_relations", "knowledge_timeline", "review_jobs")
DETAIL_CACHE_LIMIT = 64


def install_revision_triggers(connection):
    connection.execute(
        text(
            "INSERT INTO catalog_revision (id, revision) VALUES (1, 0) ON CONFLICT (id) DO NOTHING"
        )
    )
    if connection.dialect.name == "sqlite":
        for table in CATALOG_TABLES:
            for action in ("insert", "update", "delete"):
                connection.execute(
                    text(
                        f"CREATE TRIGGER IF NOT EXISTS catalog_revision_{table}_{action} "
                        f"AFTER {action} ON {table} BEGIN "
                        "UPDATE catalog_revision SET revision = revision + 1 WHERE id = 1; END"
                    )
                )
    else:
        connection.execute(
            text(
                "CREATE FUNCTION bump_catalog_revision() RETURNS trigger LANGUAGE plpgsql AS $$ "
                "BEGIN UPDATE catalog_revision SET revision = revision + 1 WHERE id = 1; RETURN NULL; END; $$"
            )
        )
        for table in CATALOG_TABLES:
            connection.execute(
                text(
                    f"CREATE TRIGGER catalog_revision_{table} AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE "
                    f"ON {table} FOR EACH STATEMENT EXECUTE FUNCTION bump_catalog_revision()"
                )
            )


class DetailSnapshotCache:
    def __init__(self):
        self._lock = Lock()
        self._revision = None
        self._built_at = 0.0
        self._snapshot = None
        self._pages: OrderedDict[tuple[str, str], tuple[KnowledgeSnapshot, str]] = OrderedDict()

    def load_page(self, services, session, entity_type, slug):
        if services.app_settings.data_mode == "live":
            # The live quality gate includes time-sensitive evidence checks.
            return self._project(services.get_public_snapshot(session), entity_type, slug)
        key = (entity_type, slug)
        with self._lock:
            snapshot = self._load_snapshot(services, session)
            if snapshot is not self._snapshot:
                return self._project(snapshot, entity_type, slug)
            if key in self._pages:
                self._pages.move_to_end(key)
                return self._pages[key]
            page = self._project(snapshot, entity_type, slug)
            if page is not None:
                self._pages[key] = page
                if len(self._pages) > DETAIL_CACHE_LIMIT:
                    self._pages.popitem(last=False)
            return page

    def _load_snapshot(self, services, session):
        revision_sql = text("SELECT revision FROM catalog_revision WHERE id = 1")
        revision = session.scalar(revision_sql)
        if (
            self._snapshot is not None
            and revision == self._revision
            and monotonic() - self._built_at < 30
        ):
            return self._snapshot
        snapshot = services.get_public_snapshot(session)
        if session.scalar(revision_sql) == revision:
            self._revision, self._snapshot, self._built_at = revision, snapshot, monotonic()
            self._pages.clear()
        return snapshot

    @staticmethod
    def _project(snapshot, entity_type, slug):
        page = project_entity_detail(snapshot, entity_type, slug)
        return None if page is None else (page, detail_etag(page))


def detail_etag(snapshot):
    # Retrieval/graph collection timestamps describe the request, not a
    # publication. Include all actual page content in the validator.
    payload = snapshot.model_dump_json(
        exclude={
            "meta": {"retrieved_at", "cached_at"},
            "graph": {"captured_at"},
        }
    )
    return 'W/"' + sha256(payload.encode()).hexdigest() + '"'
