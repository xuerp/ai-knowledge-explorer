import json
from pathlib import Path

from app.repository import KnowledgeRepository

ROOT = Path(__file__).resolve().parents[2]


def test_exact_channel_prices_and_context_limits_survive_catalog_composition():
    snapshot = KnowledgeRepository(ROOT / "backend/data/demo_snapshot.json").load_seed()
    entities = {e.id: e for e in snapshot.entities}
    qwen = entities["e-qwen-35-flash"]
    assert qwen.specs.context_window == "1M · max output 65,536 tokens"
    assert qwen.specs.input_price == "¥0.2–1.2 / 1M tokens · Beijing · tiered"
    assert qwen.specs.output_price == "¥2–12 / 1M tokens · Beijing · tiered"
    assert entities["e-qwen-3-plus"].specs.context_window.startswith("131,072 total")
    assert "98304" not in entities["e-qwen-3-plus"].specs.context_window
    assert "configuration cap" in entities["e-deepseek-v25-1210"].specs.context_window
    assert entities["e-deepseek-v25-1210"].specs.context_window.startswith("163,840")
    # Qianfan's documented CNY/1K values must be normalized to CNY/1M.
    assert entities["e-ernie-51"].specs.input_price.startswith("¥4–6 / 1M")
    assert entities["e-ernie-51"].release.api_model_ids == ["ernie-5.1"]
    assert any(
        c.type == "first-party-product" for c in entities["e-ernie-51"].release.access_channels
    )
    assert "Self-hosted" in entities["e-qwen-25-72b"].specs.input_price
    assert (
        entities["e-qwen-3-coder-next"].specs.input_price == "¥1–2.5 / 1M tokens · Beijing · tiered"
    )
    assert entities["e-qwen-3-next"].specs.input_price.startswith("¥1 / 1M")
    assert "no generated-token" in entities["e-gemini-embedding-2"].specs.output_price
    assert entities["e-kimi-k27-code"].release.released_at == "2026-06-12"
    assert entities["e-grok-4-7-fast"].release.released_at == "2026-09-21"
    for id, source in (
        ("e-kimi-k27-code", "s-specs-kimi-code-releases"),
        ("e-grok-4-7-fast", "s-specs-grok47-release"),
    ):
        event = next(
            t for t in snapshot.timeline[entities[id].family_id] if t.id == "t-spec-release-" + id
        )
        assert event.source_ids == [source]


def test_every_enriched_field_keeps_official_provenance_and_conflicts_stay_unresolved():
    snapshot = KnowledgeRepository(ROOT / "backend/data/demo_snapshot.json").load_seed()
    entities = {e.id: e for e in snapshot.entities}
    sources = {s.id: s for s in snapshot.evidence}
    ledger = json.loads(
        (ROOT / "docs/model-spec-enrichment-20261005.json").read_text(encoding="utf-8")
    )
    for patch in ledger["entries"]:
        entity = entities[patch["entityId"]]
        for key, value in patch["specs"].items():
            assert entity.specs.model_dump(by_alias=True)[key] == value
        section = next(
            s for s in entity.knowledge.sections if s.id == "official-model-specifications"
        )
        assert section.source_ids
        for reference in patch["sources"]:
            source = sources["s-specs-" + reference["name"]]
            assert source.id in section.source_ids
            assert source.type == "official"
            assert source.source_excerpt and reference["excerpt"]
            assert len(reference["sha256"]) == 64
    assert sources["s-specs-qwen-models"].publisher == "Alibaba Cloud"
    for id in ledger["releaseConflicts"]:
        assert entities[id].release.released_at is None
        assert entities[id].first_released_at is None
    assert entities["e-deepseek-r2"].specs.context_window is None
    assert any(p["entityId"] == "e-deepseek-r2" for p in ledger["unresolved"])
