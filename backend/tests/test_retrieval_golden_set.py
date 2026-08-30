import hashlib
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


def test_postgresql_retrieval_baseline_is_bound_to_the_golden_set_and_snapshot():
    root = Path(__file__).resolve().parents[2]
    snapshot_path = root / "docs/eval/snapshots/public_snapshot_2026-08-30.json"
    report_path = root / "docs/eval/results/v1.0.0_8978fef80e19_postgresql_lexical_top8.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    sqlite_report = json.loads(
        (root / "docs/eval/results/v1.0.0_8978fef80e19_sqlite_lexical_top8.json").read_text(
            encoding="utf-8"
        )
    )
    metadata = report["metadata"]

    assert metadata["goldenSetVersion"] == "1.0.0"
    assert metadata["sampleCount"] == 80
    assert metadata["snapshotSha256"] == hashlib.sha256(snapshot_path.read_bytes()).hexdigest()
    assert metadata["databaseDialect"] == "postgresql"
    assert metadata["retrievalMode"] == "lexical"
    assert metadata["topK"] == 8
    assert metadata["evaluationCommit"] == sqlite_report["metadata"]["evaluationCommit"]
    assert len(report["results"]) == 80
    assert report["metrics"]["overall"] == {
        "samples": 80,
        "recallAtK": 0.9938,
        "precisionAtK": 0.1406,
        "entityRecallAtK": 0.9938,
        "passRatio": 0.9875,
    }
    assert report["metrics"] == sqlite_report["metrics"]
