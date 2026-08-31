from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

from app.entity_aliases import apply_entity_aliases, load_entity_alias_catalog
from app.schemas import KnowledgeSnapshot

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts/eval_hybrid_retrieval.py"
SPEC = importlib.util.spec_from_file_location("eval_hybrid_retrieval", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
eval_hybrid_retrieval = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(eval_hybrid_retrieval)


def test_hybrid_evaluation_preflight_is_bound_to_fixed_workload():
    snapshot_path = REPO_ROOT / "docs/eval/snapshots/public_snapshot_2026-08-30.json"
    golden_path = REPO_ROOT / "docs/eval/retrieval_golden_set.jsonl"
    alias_path = REPO_ROOT / "backend/data/entity_aliases_v1.json"
    snapshot = KnowledgeSnapshot.model_validate_json(snapshot_path.read_bytes())
    _, aliases, _ = load_entity_alias_catalog(alias_path)
    apply_entity_aliases(snapshot.entities, aliases)
    samples = [
        json.loads(line)
        for line in golden_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]

    documents = eval_hybrid_retrieval.build_document_texts(snapshot)
    all_inputs = documents + [str(item["query"]) for item in samples]

    assert len(documents) == 195
    assert len(samples) == 80
    assert sum(len(text) for text in all_inputs) == 69_750


def test_committed_production_hybrid_result_is_complete_and_guarded():
    result_path = (
        REPO_ROOT / "docs/eval/results/"
        "v1.0.0_8978fef80e19_sqlite_hybrid_cloudflare_-cf-baai-bge-m3_top8.json"
    )
    raw = result_path.read_bytes()
    report = json.loads(raw)

    canonical_raw = raw.replace(b"\r\n", b"\n")
    assert hashlib.sha256(canonical_raw).hexdigest() == (
        "6a789336381864a0a4188cf65eb7c139d8c358cdedb075d607ac776cb8da909e"
    )
    assert report["metadata"] == {
        **report["metadata"],
        "goldenSetVersion": "1.0.0",
        "sampleCount": 80,
        "snapshotSha256": ("8978fef80e19ef9fdd167fdbbca4d2746f5a4c5edf558966484443eebfe1f66e"),
        "retrievalMode": "hybrid",
        "databaseDialect": "sqlite",
        "embeddingProvider": "cloudflare",
        "embeddingModel": "@cf/baai/bge-m3",
        "embeddingVersion": ("cloudflare-managed:@cf/baai/bge-m3:2026-08-31-baseline"),
        "embeddingDimension": 1024,
        "topK": 8,
        "rrfK": 60,
        "evaluationCommit": "8a6b0b7ac37bf94e715c261bf325b9314e6d2987",
    }
    assert report["preflight"] == {
        "documentCount": 195,
        "expectedApiCalls": 82,
        "conservativeTokenUpperBound": 69_750,
        "estimatedNeurons": 74.9813,
    }
    assert report["usage"]["apiCalls"] == 82
    assert report["usage"]["dailyApiCallBudget"] == 100
    assert report["usage"]["estimatedNeurons"] == 74.9813
    assert report["usage"]["dailyNeuronBudget"] == 100.0
    assert report["metrics"]["overall"] == {
        "samples": 80,
        "recallAtK": 1.0,
        "precisionAtK": 0.1422,
        "entityRecallAtK": 0.9875,
        "passRatio": 1.0,
    }
    assert len(report["results"]) == 80
    assert all(item["passed"] for item in report["results"])
    assert all(item["diagnostics"]["fallbackReason"] is None for item in report["results"])
