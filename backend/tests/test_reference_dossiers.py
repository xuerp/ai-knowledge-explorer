from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.repository import KnowledgeRepository

SEED = Path(__file__).resolve().parents[1] / "data/demo_snapshot.json"


def test_every_non_model_has_distinct_sourced_reference_sections():
    snapshot = KnowledgeRepository(SEED).load_seed()
    sources = {s.id: s for s in snapshot.evidence}
    references = [e for e in snapshot.entities if e.type != "model"]
    assert len(references) == 32
    for entity in references:
        sections = entity.knowledge.sections
        assert len(sections) >= 3, entity.id
        assert len({s.id for s in sections}) == len(sections)
        assert all(
            s.title.zh and s.title.en and s.summary.zh and s.summary.en and len(s.items) >= 2
            for s in sections
        )
        assert all(
            s.source_ids
            and all(id in sources and sources[id].url.startswith("https://") for id in s.source_ids)
            for s in sections
        )
    bodies = {e.id: " ".join(s.summary.zh for s in e.knowledge.sections) for e in references}
    assert bodies["e-traecode"] != bodies["e-traework"]
    assert "协议" in bodies["e-mcp"] and "500" in " ".join(
        i.zh
        for s in next(e for e in references if e.id == "e-swebench").knowledge.sections
        for i in s.items
    )


def test_reference_sections_and_new_model_lines_round_trip_through_api(tmp_path):
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'reference.db').as_posix()}",
        seed_snapshot_path=SEED,
        environment="test",
        admin_token=None,
        cors_origins=("http://localhost:8082",),
    )
    seed = KnowledgeRepository(SEED).load_seed()
    with TestClient(create_app(settings)) as client:
        for entity in seed.entities:
            if entity.type == "model":
                continue
            response = client.get(f"/api/v2/entities/{entity.type}/{entity.slug}")
            assert response.status_code == 200
            assert response.json()["knowledge"]["sections"] == [
                s.model_dump(mode="json", by_alias=True) for s in entity.knowledge.sections
            ]
        for family_id, minimum in [
            ("e-glm", 5),
            ("e-hunyuan", 3),
            ("e-minimax", 2),
            ("e-mistral", 2),
            ("e-grok", 4),
        ]:
            versions = client.get(f"/api/v2/model-families/{family_id}/versions").json()
            assert len(versions) >= minimum
            assert all(
                v["release"]["productLine"] and len(v["knowledge"]["keyPoints"]) >= 3
                for v in versions
            )
        medium = client.get("/api/v2/entities/model/mistral-medium-3-5").json()
        assert medium["release"]["releasedAt"] is None
        assert medium["release"]["stage"] == "stable"
        restricted = client.get("/api/v2/entities/model/minimax-m3-1-flash-preview").json()
        assert restricted["release"]["releasedAt"] is None
        assert restricted["release"]["apiModelIds"] == []
        assert {c["type"] for c in restricted["release"]["accessChannels"]} == {
            "restricted-access",
            "first-party-product",
        }
        fast = client.get("/api/v2/entities/model/grok-4-7-fast").json()
        assert fast["release"]["apiModelIds"] == []
        # The September 21 official announcement explicitly includes fast serving.
        # Public API IDs/access channels remain separately constrained below.
        assert fast["release"]["releasedAt"] == "2026-09-21"
        assert fast["release"]["catalogCurrent"] is True
        assert {c["provider"] for c in fast["release"]["accessChannels"]} == {
            "Grok Build",
            "Cursor",
        }
        grok = client.get("/api/v2/entities/model/grok-4-7").json()
        assert grok["release"]["releasedAt"] == "2026-09-21"
        assert grok["release"]["apiModelIds"] == ["grok-4.7"]
        assert "500K" in grok["specs"]["contextWindow"]
        assert "200K" in grok["specs"]["inputPrice"]
