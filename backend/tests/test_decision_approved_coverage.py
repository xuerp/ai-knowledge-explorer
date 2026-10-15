"""Regression of the three facts actually approved on 2026-10-15.

The frozen review time tests publication behavior, not a claim that old quotes
remain current. Expiry is separately enforced by observed-quote tests.
"""

from datetime import UTC, datetime
from pathlib import Path

import pytest

from app import decision_constraints
from app.decision_candidates import discover_candidates
from app.decision_constraints import (
    api_price_value,
    constraint_failures,
    current_claims,
    token_quote_bounds,
)
from app.engagement import EngagementService
from app.repository import KnowledgeRepository
from app.schemas import DecisionContext

PREFIX = "claim-decision-critical-"


@pytest.fixture
def approved_catalog(monkeypatch):
    snapshot = KnowledgeRepository(
        Path(__file__).parents[1] / "data/demo_snapshot.json"
    ).load_seed()
    sources = [source for source in snapshot.evidence if source.id.startswith("source-critical-")]
    review_time = max(datetime.fromisoformat(source.verified_at) for source in sources)
    if review_time.tzinfo is None:
        review_time = review_time.replace(tzinfo=UTC)

    class ReviewClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return review_time.astimezone(tz) if tz else review_time.replace(tzinfo=None)

    monkeypatch.setattr(decision_constraints, "datetime", ReviewClock)
    return snapshot


def test_approved_source_scope_keeps_unknown_publication_dates(approved_catalog):
    claims = [claim for claim in approved_catalog.claims if claim.id.startswith(PREFIX)]
    assert len(claims) == 3
    assert current_claims(claims, approved_catalog) == claims
    assert all(claim.confidence == "verified" and not claim.valid_from for claim in claims)
    sources = {source.id: source for source in approved_catalog.evidence}
    for claim in claims:
        assert all(
            sources[key].verified_at and not sources[key].published_at for key in claim.source_ids
        )


def test_cloud_coding_and_codex_cli_gaps_are_resolved_by_their_own_citations(approved_catalog):
    current = current_claims(approved_catalog.claims, approved_catalog)
    by_entity = {}
    for claim in current:
        by_entity.setdefault(claim.entity_id, []).append(claim)
    for task, kind, deployment, required in [
        ("为代码生成选择编程模型", "model-api", "cloud-api", "e-gpt-61-sol"),
        ("代码编辑与开发工作台选型", "coding-product", "undecided", "e-codex"),
    ]:
        context = DecisionContext(
            workflow_version=2,
            task=task,
            task_type=kind,
            priority="quality",
            deployment=deployment,
        )
        ids, _ = discover_candidates(context, approved_catalog, by_entity, "zh")
        decision = EngagementService._build_decision(
            context,
            [claim for claim in current if claim.entity_id in ids],
            ids,
            approved_catalog,
            "zh",
        )
        assert required in decision.plan.trial_candidate_ids
        candidate = next(item for item in decision.candidates if item.entity_id == required)
        assert any(key.startswith(PREFIX) for key in candidate.claim_ids)
        # A public capability document never manufactures a business measurement.
        assert decision.plan.trial is not None and not decision.plan.trial.executed


@pytest.mark.parametrize(
    "maximum, expected", [(272000, (12, 12)), (272001, (12, 19)), (None, (12, 19))]
)
def test_approved_standard_quote_preserves_whole_request_tier_bounds(
    approved_catalog, maximum, expected
):
    claim = next(
        claim for claim in approved_catalog.claims if claim.id == PREFIX + "6c55a8f834e483e65551"
    )
    context = DecisionContext(
        task="选择云 API 模型",
        task_type="model-api",
        workflow_version=2,
        priority="cost",
        deployment="cloud-api",
        budget={
            "mode": "range",
            "max": 30,
            "currency": "USD",
            "channel": "OpenAI API",
            "costScope": "standard-token-only",
            "monthlyInputTokens": 1e6,
            "monthlyOutputTokens": 1e6,
            "maximumInputTokensPerRequest": maximum,
        },
    )
    assert token_quote_bounds(api_price_value(claim), context) == expected


@pytest.mark.parametrize(
    "channel, deployment", [("CCSub", "cloud-api"), ("OpenAI API", "on-device")]
)
def test_original_api_fact_does_not_prove_gateway_price_or_offline_deployment(
    approved_catalog, channel, deployment
):
    entity = next(entity for entity in approved_catalog.entities if entity.id == "e-gpt-61-sol")
    claims = [
        claim
        for claim in current_claims(approved_catalog.claims, approved_catalog)
        if claim.entity_id == entity.id
    ]
    context = DecisionContext(
        task="为代码生成选择模型",
        task_type="model-api",
        workflow_version=2,
        priority="cost",
        deployment=deployment,
        budget={
            "mode": "range",
            "max": 30,
            "currency": "USD",
            "channel": channel,
            "costScope": "standard-token-only",
            "monthlyInputTokens": 1e6,
            "monthlyOutputTokens": 1e6,
        },
    )
    failures = constraint_failures(entity, claims, context)
    assert failures
    if channel == "CCSub":
        assert "price-unverified-or-conflicting" in failures
