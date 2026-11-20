from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import text

from app.catalog_revision import DetailSnapshotCache
from app.database import Database
from app.entity_detail import project_entity_detail
from app.repository import KnowledgeRepository


def test_detail_projection_retains_page_dependencies_and_removes_unrelated_data():
    snapshot = KnowledgeRepository(
        Path(__file__).resolve().parents[1] / "data/demo_snapshot.json"
    ).load_seed()
    for target in [
        snapshot.entities[0],
        next(item for item in snapshot.entities if item.family_id),
        next(item for item in snapshot.entities if item.type != "model"),
    ]:
        page = project_entity_detail(snapshot, target.type, target.slug)
        assert page is not None
        assert target in page.entities
        assert page.timeline[target.id] == snapshot.timeline.get(target.id, [])
        assert page.claims == [item for item in snapshot.claims if item.entity_id == target.id]
        assert all(
            item.from_id == target.id or item.to_id == target.id for item in page.graph.edges
        )
        kept_ids = {item.id for item in page.entities}
        if target.family_id:
            assert target.family_id in kept_ids
        assert {
            item.id
            for item in snapshot.entities
            if item.family_id == (target.family_id or target.id)
        } <= kept_ids
        assert all(
            source in {item.id for item in page.evidence}
            for claim in page.claims
            for source in claim.source_ids
        )
        for field in (
            "following",
            "interest_profile",
            "research_answers",
            "review_candidates",
            "notifications",
            "sync_runs",
        ):
            assert getattr(page, field) == []
        assert len(page.model_dump_json()) < len(snapshot.model_dump_json()) / 2
    assert project_entity_detail(snapshot, "model", "missing-object") is None


def test_revision_tracks_committed_catalog_edits_across_connections(tmp_path):
    path = tmp_path / "catalog.db"
    database = Database(f"sqlite:///{path.as_posix()}")
    database.create_all()
    repository = KnowledgeRepository(
        Path(__file__).resolve().parents[1] / "data/demo_snapshot.json"
    )
    services = SimpleNamespace(
        app_settings=SimpleNamespace(data_mode="demo"),
        get_public_snapshot=repository.public_snapshot,
    )
    caches = [DetailSnapshotCache(), DetailSnapshotCache()]
    with database.session() as session:
        repository.seed_catalog(session)
        repository.seed_review_jobs(session)
        entity = next(
            item for item in repository.public_snapshot(session).entities if item.family_id
        )
        scope = (entity.type, entity.slug)
        first = [cache.load_page(services, session, *scope) for cache in caches]
        tags = [entry[1] for entry in first]
        assert tags[0] == tags[1]
        assert caches[0].load_page(services, session, *scope) is first[0]
    with database.session() as session:
        session.execute(text("DELETE FROM knowledge_entities WHERE id = :id"), {"id": entity.id})
        session.rollback()
    with database.session() as session:
        assert caches[0].load_page(services, session, *scope) is first[0]
    with database.session() as session:
        repository.upsert_entity(
            session, entity.model_copy(update={"tags": [*entity.tags, "edit"]})
        )
        session.commit()
    for cache in caches:
        with database.session() as session:
            updated, tag = cache.load_page(services, session, *scope)
            assert tag != tags[0]
            assert "edit" in next(item for item in updated.entities if item.id == entity.id).tags
    with database.session() as session:
        session.execute(text("DELETE FROM knowledge_entities WHERE id = :id"), {"id": entity.id})
        session.commit()
    with database.session() as session:
        assert caches[0].load_page(services, session, *scope) is None
