import json
from collections import Counter
from pathlib import Path

from app.schemas import KnowledgeSnapshot


def test_retrieval_golden_set_is_versioned_balanced_and_resolves_snapshot_ids():
    root = Path(__file__).resolve().parents[2]
    samples = [
        json.loads(line)
        for line in (root / "docs/eval/retrieval_golden_set.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]
    snapshot = KnowledgeSnapshot.model_validate_json(
        (root / "docs/eval/snapshots/public_snapshot_2026-08-30.json").read_bytes()
    )
    claim_ids = {claim.id for claim in snapshot.claims}
    verified_claim_ids = {claim.id for claim in snapshot.claims if claim.confidence == "verified"}
    entity_ids = {entity.id for entity in snapshot.entities}

    assert len(samples) == 80
    assert {sample["version"] for sample in samples} == {"1.0.0"}
    assert len({sample["id"] for sample in samples}) == 80
    assert Counter(sample["category"] for sample in samples) == {
        "entity": 30,
        "relation": 20,
        "timeline": 20,
        "comparison": 10,
    }
    assert all(set(sample["expected_claim_ids"]) <= claim_ids for sample in samples)
    assert all(set(sample["expected_claim_ids"]) <= verified_claim_ids for sample in samples)
    assert all(set(sample["expected_entity_ids"]) <= entity_ids for sample in samples)
