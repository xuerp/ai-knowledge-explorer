from __future__ import annotations

import importlib.util
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
