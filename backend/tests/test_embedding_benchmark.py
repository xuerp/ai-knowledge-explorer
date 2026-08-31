from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "benchmark_embeddings.py"
SPEC = importlib.util.spec_from_file_location("benchmark_embeddings", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
benchmark_embeddings = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(benchmark_embeddings)


def test_rrf_fuses_union_and_uses_claim_id_for_deterministic_ties():
    assert benchmark_embeddings.rrf_fuse(
        ["claim-a", "claim-b"],
        ["claim-c", "claim-b"],
        60,
    ) == ["claim-b", "claim-a", "claim-c"]


def test_openai_backend_refuses_calls_without_explicit_paid_authorization(monkeypatch):
    monkeypatch.setenv("TEST_OPENAI_API_KEY", "not-a-real-key")

    with pytest.raises(ValueError, match="--allow-paid-api"):
        benchmark_embeddings.OpenAIEmbeddingBackend(
            "text-embedding-3-small",
            512,
            "TEST_OPENAI_API_KEY",
            monthly_budget_usd=0.01,
            price_per_million_tokens=0.02,
            allow_paid_api=False,
        )


def test_committed_bge_benchmark_is_version_bound_and_zero_cost():
    report_path = (
        Path(__file__).resolve().parents[2]
        / "docs/eval/results/embedding_fastembed_BAAI-bge-small-zh-v1-5_8978fef80e19.json"
    )
    report = json.loads(report_path.read_text(encoding="utf-8"))
    metadata = report["metadata"]

    assert metadata["evaluationCommit"] == "900e115201738cf8db52ce1319a3f739930e8b74"
    assert metadata["goldenSetVersion"] == "1.0.0"
    assert metadata["snapshotSha256"].startswith("8978fef80e19")
    assert metadata["aliasCatalogVersion"] == "1.0.0"
    assert metadata["provider"] == "fastembed"
    assert metadata["modelName"] == "BAAI/bge-small-zh-v1.5"
    assert metadata["modelArtifactSha256"] == (
        "1294ea4b6331115a353d81f96b85e8c8d7fdcc284453d5b2fab5b016230aad38"
    )
    assert report["usage"]["apiCalls"] == 0
    assert report["usage"]["estimatedCostUsd"] == 0
    assert report["metrics"]["vector"]["overall"]["recallAtK"] == 0.85
    assert report["metrics"]["hybrid"]["overall"]["recallAtK"] == 1.0
