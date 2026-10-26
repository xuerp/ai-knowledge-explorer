import json
from pathlib import Path

from app.repository import KnowledgeRepository


def test_parameter_change_preserves_history_and_links_specific_model_scope():
    root = Path(__file__).resolve().parents[1] / "data"
    snapshot = KnowledgeRepository(root / "demo_snapshot.json").load_seed()
    claim = next(c for c in snapshot.claims if c.id == "c-change-gemini-sampling-deprecated")
    assert claim.valid_from == "2026-07-21"
    assert all(
        part in claim.text.en
        for part in ("temperature", "top_p", "top_k", "3.6 Flash", "3.5 Flash-Lite")
    )
    assert "s-change-gemini-sampling-guide-20261026" in claim.source_ids
    evidence = next(
        s for s in snapshot.evidence if s.id == "s-change-gemini-sampling-guide-20261026"
    )
    assert "whats-new-gemini-3.6" in evidence.url
    assert not evidence.published_at  # Review date is not a fabricated publication date.
    catalog = json.loads((root / "frontier_catalog_v1.json").read_text(encoding="utf-8"))
    event = next(
        t
        for entries in catalog["timeline"].values()
        for t in entries
        if t["id"] == "t-change-gemini-sampling-deprecated"
    )
    assert event["summary"]["en"] == claim.text.en
    assert event["detail"]["description"]["en"] == claim.text.en
    assert "3.6 Flash" in event["detail"]["affected"]["en"]
    assert evidence.id in event["sourceIds"]
