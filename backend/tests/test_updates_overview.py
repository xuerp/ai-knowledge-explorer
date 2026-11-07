import json
from pathlib import Path

from app.schemas import KnowledgeSnapshot
from app.updates_overview import build_updates_overview


def test_updates_projection_preserves_events_filters_and_sources_without_unrelated_payloads():
    snapshot = KnowledgeSnapshot.model_validate_json(
        (Path(__file__).resolve().parents[2] / "src/data/generated/snapshot.json").read_text(
            encoding="utf-8"
        )
    )
    before = snapshot.model_dump_json(by_alias=True)
    result = build_updates_overview(snapshot).model_dump(
        mode="json", by_alias=True, exclude_none=True
    )
    assert result["changes"] == [
        item.model_dump(mode="json", by_alias=True, exclude_none=True) for item in snapshot.changes
    ]
    assert [e["id"] for e in result["entities"]] == [e.id for e in snapshot.entities]
    assert all("knowledge" not in e and "specs" not in e for e in result["entities"])
    expected_sources = {source_id for c in snapshot.changes for source_id in c.source_ids}
    assert [e["id"] for e in result["evidence"]] == [
        e.id for e in snapshot.evidence if e.id in expected_sources
    ]
    assert set(result) == {"meta", "entities", "changes", "evidence"}
    assert len(json.dumps(result, ensure_ascii=False).encode()) < len(before.encode()) * 0.25
    assert snapshot.model_dump_json(by_alias=True) == before
