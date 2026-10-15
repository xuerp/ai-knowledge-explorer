"""Synthetic dated observations do not invent publication/effective dates."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.decision_constraints import api_price_value, current_claims, token_quote_bounds
from app.schemas import Claim, DecisionContext, Evidence, KnowledgeSnapshot


def quotation(days=0):
    observed = (datetime.now(UTC) - timedelta(days=days)).isoformat()
    price = {
        "input": 4,
        "output": 20,
        "currency": "CNY",
        "channel": "synthetic-paygo",
        "unit": "per-million-tokens",
        "conditions": "standard-uncached-tokens-only",
        "quoteBasis": "observed-list-price",
        "observedAt": observed,
        "sourceUrl": "https://supplier.example/pricing",
    }
    claim = Claim(
        id="synthetic-observed-quote",
        entityId="synthetic-model",
        confidence="verified",
        text={
            "zh": "合成观测报价，不是产品事实",
            "en": "Synthetic observed quote, not a product fact",
        },
        sourceIds=["synthetic-quote-source"],
        updatedAt=observed,
        observedAt=observed,
        predicate="api_price",
        objectOrValue=json.dumps(price),
    )
    source = Evidence(
        id="synthetic-quote-source",
        title={"zh": "测试", "en": "Fixture"},
        url=price["sourceUrl"],
        publisher="Synthetic fixture",
        type="official",
        publishedAt="",
        collectedAt=observed,
        verifiedAt=observed,
        sourceExcerpt="Synthetic price table: input 4; output 20. Not a real quote.",
    )
    snapshot = KnowledgeSnapshot.model_validate_json(
        (Path(__file__).parents[1] / "data/demo_snapshot.json").read_text("utf-8")
    )
    snapshot = snapshot.model_copy(update={"claims": [claim], "evidence": [source]})
    return claim, source, snapshot


def test_reviewed_recent_observation_can_estimate_without_fabricating_a_publication_date():
    claim, source, snapshot = quotation()
    assert current_claims([claim], snapshot) == [claim]
    assert claim.valid_from is None and source.published_at == ""
    context = DecisionContext.model_validate(
        {
            "task": "Synthetic API quote check",
            "priority": "cost",
            "deployment": "cloud-api",
            "budget": {
                "mode": "range",
                "max": 30,
                "currency": "CNY",
                "period": "month",
                "channel": "synthetic-paygo",
                "monthlyInputTokens": 1000000,
                "monthlyOutputTokens": 1000000,
                "costScope": "standard-token-only",
            },
        }
    )
    assert token_quote_bounds(api_price_value(claim), context) == (24, 24)
    context.budget.cost_scope = "all-costs"
    assert token_quote_bounds(api_price_value(claim), context) is None


@pytest.mark.parametrize("days", [-1, 7.1, 8, 90])
def test_future_or_stale_observed_quotes_do_not_become_current(days):
    claim, _, snapshot = quotation(days)
    assert current_claims([claim], snapshot) == []
    assert api_price_value(claim) is None


@pytest.mark.parametrize(
    "fault",
    [
        "unreviewed",
        "no-excerpt",
        "no-verification",
        "other-source",
        "not-official",
        "numeric-context",
    ],
)
def test_observation_does_not_bypass_review_source_or_other_fact_date_gates(fault):
    claim, source, snapshot = quotation()
    if fault == "unreviewed":
        claim.confidence = "unverified"
    if fault == "no-excerpt":
        source.source_excerpt = ""
    if fault == "no-verification":
        source.verified_at = None
    if fault == "other-source":
        source.url = "https://other.example/pricing"
    if fault == "not-official":
        source.type = "community"
    if fault == "numeric-context":
        claim.predicate = "context-window"
    assert current_claims([claim], snapshot) == []
