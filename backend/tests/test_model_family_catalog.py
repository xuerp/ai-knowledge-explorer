import hashlib
import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.catalog_changes import catalog_changes, catalog_release_changes
from app.config import Settings
from app.database import Base, KnowledgeRelationRecord, KnowledgeTimelineRecord
from app.entity_aliases import apply_entity_aliases
from app.main import create_app
from app.repository import KnowledgeRepository
from app.schemas import KnowledgeSnapshot, TimelineEntry

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
ROOT = DATA_DIR.parent.parent
SEED = DATA_DIR / "demo_snapshot.json"


def test_minimax_legacy_listing_does_not_relax_weight_license_or_invent_dates():
    snapshot = KnowledgeRepository(SEED).load_seed()
    entities = {entity.id: entity for entity in snapshot.entities}
    m27, m25 = entities["e-minimax-m2-7"], entities["e-minimax-m2-5"]
    assert m27.release.released_at == "2026-03-18"
    assert m25.release.released_at == "2026-02-12"
    assert m25.release.catalog_current and m25.release.stage != "retired"
    assert "legacy" in m25.summary.en and "retirement" in m25.summary.en
    for entity in (m27, m25):
        assert entity.family_id == "e-minimax" and len(entity.knowledge.key_points) >= 3
        assert entity.specs.input_price is None and entity.specs.output_price is None
        assert entity.specs.context_window is None
        assert all(
            claim.valid_from is None and claim.observed_at
            for claim in snapshot.claims
            if claim.entity_id == entity.id and claim.predicate != "release"
        )
    license_claim = next(
        claim
        for claim in snapshot.claims
        if claim.entity_id == m27.id and claim.predicate == "licensed-under"
    )
    assert "Non-commercial" in license_claim.object_or_value
    assert "prior written authorization" in license_claim.object_or_value
    source = next(row for row in snapshot.evidence if row.id == license_claim.source_ids[0])
    assert source.published_at == "2026-04-14" != m27.release.released_at
    assert "NON-COMMERCIAL LICENSE" in source.source_excerpt
    assert not any(
        claim.entity_id == m25.id and claim.predicate == "licensed-under"
        for claim in snapshot.claims
    )


def test_reviewed_intake_keeps_unknown_release_dates_and_family_evidence():
    snapshot = KnowledgeRepository(SEED).load_seed()
    entities = {entity.id: entity for entity in snapshot.entities}
    assert snapshot.meta.retrieved_at.startswith("2026-10-08")
    glm = entities["e-glm-5-3"]
    hy = entities["e-hy4-preview"]
    assert glm.family_id == "e-glm" and glm.release.released_at == "2026-08-14"
    assert glm.latest_version is None and hy.latest_version is None
    assert hy.family_id == "e-hunyuan" and hy.release.released_at == "2026-08-28"
    assert any(
        event.release_entity_id == hy.id
        and event.date_kind == "release"
        and event.date == "2026-08-28"
        for event in snapshot.timeline[hy.family_id]
    )
    changes = catalog_changes(snapshot)
    assert any(change.entity_id == hy.id and change.date == "2026-08-28" for change in changes)
    assert any(
        change.entity_id == glm.id and change.kind == "new" and change.date == "2026-08-14"
        for change in changes
    )
    assert entities["e-glm-5-3-flash"].release.released_at is None
    sources = {source.id for source in snapshot.evidence}
    for id in ("e-workbuddy", "e-traecode", "e-traework", "e-glm", "e-hunyuan"):
        assert all(
            point.source_ids and set(point.source_ids) <= sources
            for point in entities[id].knowledge.key_points
        )


def test_legacy_catalog_formats_upgrade_without_overwriting_admin_changes():
    old = {
        "id": "release-event",
        "date": "2026-09-02",
        "kind": "release",
        "title": {"zh": "发布", "en": "Release"},
        "summary": {"zh": "原始内容", "en": "Original content"},
        "sourceIds": ["official-source"],
        "confidence": "verified",
    }
    current = {
        **old,
        "dateKind": "release",
        "releaseEntityId": "version-id",
        "detail": None,
        "changeKind": None,
    }
    row = SimpleNamespace(payload_json=json.dumps(old))
    upgraded = KnowledgeRepository._catalog_seed_payload(row, current, None)
    assert json.loads(upgraded)["releaseEntityId"] == "version-id"

    revised = {**current, "date": "2026-09-01"}
    baseline = {**old, "dateKind": None, "releaseEntityId": None, "detail": None}
    assert (
        json.loads(KnowledgeRepository._catalog_seed_payload(row, revised, baseline))["date"]
        == "2026-09-01"
    )

    for edited in (
        {**old, "summary": {"zh": "管理员内容", "en": "Admin content"}},
        {**old, "sourceIds": ["different-source"]},
        {**old, "dateKind": None, "releaseEntityId": None},
    ):
        assert (
            KnowledgeRepository._catalog_seed_payload(
                SimpleNamespace(payload_json=json.dumps(edited)), current, None
            )
            is None
        )

    historical_hash = hashlib.sha256(
        json.dumps(old, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()
    revised_wording = {**current, "title": {"zh": "新目录标题", "en": "Revised catalog title"}}
    assert KnowledgeRepository._catalog_seed_payload(row, revised_wording, None, {historical_hash})
    changed_row = SimpleNamespace(payload_json=json.dumps({**old, "date": "2026-09-03"}))
    assert (
        KnowledgeRepository._catalog_seed_payload(
            changed_row, revised_wording, None, {historical_hash}
        )
        is None
    )


def test_public_changes_match_all_confirmed_catalog_releases(tmp_path):
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'changes.db').as_posix()}",
        seed_snapshot_path=SEED,
        environment="test",
        admin_token=None,
        cors_origins=("http://localhost:8082",),
    )
    seed = KnowledgeRepository(SEED).load_seed()
    expected = catalog_changes(seed)
    # Includes the now-confirmed Gemini 4 Argon release; the existing ID remains stable.
    assert len(catalog_release_changes(seed)) == 203
    assert len(expected) == 264
    with TestClient(create_app(settings)) as client:
        snapshot = client.get("/api/v2/snapshot").json()
        for key in (
            "following",
            "interestProfile",
            "researchAnswers",
            "notifications",
            "reviewCandidates",
            "syncRuns",
        ):
            assert snapshot[key] == [], key
        assert len(snapshot["entities"]) == len(seed.entities)
        assert len(snapshot["evidence"]) == len(seed.evidence)
        assert snapshot["researchQuestions"]
        changes = snapshot["changes"]
        assert changes == [item.model_dump(mode="json", by_alias=True) for item in expected]
        assert changes[0]["date"] == "2026-10-13"
        for change in changes:
            version = next(
                item for item in snapshot["entities"] if item["id"] == change["entityId"]
            )
            if change["kind"] == "new":
                assert change["date"] == version["release"]["releasedAt"]
            else:
                assert change["detail"]["before"] and change["detail"]["after"]
            assert change["date"] != "2026-10-01"
            assert all(
                any(source["id"] == source_id for source in snapshot["evidence"])
                for source_id in change["sourceIds"]
            )


def test_frontend_and_backend_compose_the_same_catalog():
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node is required for cross-runtime catalog parity")
    result = subprocess.run(
        [
            node,
            "--input-type=module",
            "-e",
            """
import fs from 'node:fs';
import {applyCatalogOverlays} from './src/data/catalog-overlay.mjs';
const read=(name)=>JSON.parse(fs.readFileSync(`backend/data/${name}.json`,'utf8'));
process.stdout.write(JSON.stringify(applyCatalogOverlays(read('demo_snapshot'),read('catalog_extension'),read('frontier_catalog_v1'))));
""",
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    frontend = KnowledgeSnapshot.model_validate_json(result.stdout)
    repository = KnowledgeRepository(SEED)
    backend = repository.load_seed()
    # Alias enrichment is a separate backend catalog, independent of composition.
    apply_entity_aliases(frontend.entities, repository._alias_definitions)
    assert frontend.model_dump() == backend.model_dump()


def test_peer_families_and_every_release_resolve_through_public_api(tmp_path):
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'catalog.db').as_posix()}",
        seed_snapshot_path=SEED,
        admin_token=None,
        cors_origins=("http://localhost:8082",),
        environment="test",
    )
    manifest = json.loads((ROOT / "product/core-models.v1.json").read_text(encoding="utf-8"))
    with TestClient(create_app(settings)) as client:
        snapshot = client.get("/api/v2/snapshot").json()
        sources = {source["id"]: source for source in snapshot["evidence"]}
        expected = KnowledgeRepository(SEED).load_seed()
        expected_by_id = {entity.id: entity for entity in expected.entities}
        total = 0
        for family in manifest["models"]:
            family_id = family["entityId"]
            family_detail = client.get(f"/api/v2/entities/model/{family['slug']}")
            assert family_detail.status_code == 200
            versions = client.get(f"/api/v2/model-families/{family_id}/versions").json()
            dates = [
                version["release"]["releasedAt"] or version["firstReleasedAt"] or ""
                for version in versions
            ]
            assert dates == sorted(dates)
            assert {item["id"] for item in versions} == {
                entity.id for entity in expected.entities if entity.family_id == family_id
            }
            for version in versions:
                response = client.get(f"/api/v2/entities/model/{version['slug']}")
                assert response.status_code == 200
                assert response.json()["release"] == expected_by_id[
                    version["id"]
                ].release.model_dump(mode="json", by_alias=True)
                events = client.get(f"/api/v2/entities/{version['id']}/timeline").json()
                assert events or not version["release"]["releasedAt"], version["id"]
                for event in events:
                    assert all(source_id in sources for source_id in event["sourceIds"])
                total += 1
        assert total == sum(
            entity.family_id in {family["entityId"] for family in manifest["models"]}
            for entity in expected.entities
        )
        assert total >= 190
        timeline = client.get("/api/v2/entities/e-claude/timeline").json()
        assert next(event for event in timeline if event["id"] == "t-c-2")["date"] == "2025-09-29"
        comparison = client.post(
            "/api/v2/model-versions/compare",
            json={"versionIds": ["e-deepseek-v41-flash", "e-kimi-k27-code", "e-ernie-51"]},
        )
        assert comparison.status_code == 200
        assert len(comparison.json()) == 3


def test_catalog_refresh_corrects_old_seed_dates_and_protects_admin_edits(tmp_path):
    seed_path = tmp_path / "demo_snapshot.json"
    shutil.copyfile(SEED, seed_path)
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    baseline_repo = KnowledgeRepository(seed_path)
    with Session(engine) as session:
        baseline_repo.seed_catalog(session)
        frontier = json.loads((DATA_DIR / "frontier_catalog_v1.json").read_text(encoding="utf-8"))
        (tmp_path / "frontier_catalog_v1.json").write_text(json.dumps(frontier), encoding="utf-8")
        repository = KnowledgeRepository(seed_path)
        repository.seed_catalog(session)
        row = session.get(KnowledgeTimelineRecord, ("t-c-2", "e-claude"))
        assert row.event_date == "2025-09-29"
        assert "_catalogSeedHash" in json.loads(row.payload_json)
        relation = session.get(KnowledgeRelationRecord, "r36")
        assert json.loads(relation.payload_json)["confidence"] == "unverified"

        # A second catalog revision refreshes an unchanged catalog-owned record.
        entry = next(event for event in frontier["timeline"]["e-claude"] if event["id"] == "t-c-2")
        entry["summary"]["en"] = "Second catalog revision"
        (tmp_path / "frontier_catalog_v1.json").write_text(json.dumps(frontier), encoding="utf-8")
        updated_repo = KnowledgeRepository(seed_path)
        updated_repo.seed_catalog(session)
        assert json.loads(row.payload_json)["summary"]["en"] == "Second catalog revision"

        # Administrator writes have no seed ownership marker and survive restart.
        admin_event = TimelineEntry.model_validate(
            repository._public_catalog_payload(row.payload_json)
        )
        admin_event.summary.en = "Administrator maintained event"
        updated_repo.upsert_timeline(session, "e-claude", admin_event)
        session.commit()
        assert "_catalogSeedHash" not in json.loads(row.payload_json)
        KnowledgeRepository(seed_path).seed_catalog(session)
        assert json.loads(row.payload_json)["summary"]["en"] == "Administrator maintained event"

        # Even a retained marker cannot authorize overwriting a modified payload.
        relation_payload = json.loads(relation.payload_json)
        relation_payload["confidence"] = "inferred"
        relation.payload_json = json.dumps(relation_payload)
        session.commit()
        KnowledgeRepository(seed_path).seed_catalog(session)
        assert json.loads(relation.payload_json)["confidence"] == "inferred"


def test_gemini_video_limit_uses_direct_current_source_instead_of_unqualified_hours():
    snapshot = KnowledgeRepository(SEED).load_seed()
    claim = next(item for item in snapshot.claims if item.id == "c-gemini-video")
    assert "2-hour" not in claim.text.en
    assert "10 videos per request" in claim.text.en
    source = next(item for item in snapshot.evidence if item.id == claim.source_ids[0])
    assert source.url.startswith("https://ai.google.dev/gemini-api/docs/video-understanding")
    assert "maximum of 10 videos per request" in source.source_excerpt
    assert source.verified_at == "2026-10-25"
    assert not source.published_at


def test_gemini_october_lifecycle_preserves_history_and_identifies_replacements():
    snapshot = KnowledgeRepository(SEED).load_seed()
    entities = {entity.id: entity for entity in snapshot.entities}
    changes = catalog_changes(snapshot)
    for entity_id, date, replacement in (
        ("e-gemini-37-flash", "2026-10-08", "Gemini 3.8 Flash"),
        ("e-gemini-35-flash", "2026-10-08", "Gemini 3.6 Flash"),
        ("e-gemini-31-flash-image", "2026-10-06", "Gemini Nano Banana 2.1"),
    ):
        entity = entities[entity_id]
        assert entity.status == "deprecated" and entity.release.stage == "deprecated"
        assert entity.release.catalog_current is False
        assert replacement in entity.summary.en
        events = [e for e in changes if e.entity_id == entity_id and e.kind == "deprecated"]
        assert len(events) == 1 and events[0].date == date
    nano = entities["e-gemini-nano-banana-21"]
    assert nano.family_id == "e-gemini" and nano.release.stage == "stable"
    assert nano.release.released_at == "2026-10-06"
    assert nano.release.api_model_ids == ["gemini-nano-banana-2.1"]
    assert any(e.entity_id == nano.id and e.kind == "new" for e in changes)
