"""Synthetic contract cases, not a provider quote or a measured bill."""

import json
from copy import deepcopy
from pathlib import Path

import pytest

from app.decision_constraints import constraint_failures, token_quote_bounds
from app.decision_explanation import cost_choice
from app.decision_workflow import conflicting_entities
from app.schemas import Claim, DecisionContext, KnowledgeSnapshot


def context(ceiling=30, scope="standard-token-only"):
    return DecisionContext(
        task="文档信息抽取选择模型",
        task_type="model-api",
        workflow_version=2,
        priority="cost",
        deployment="undecided",
        budget={
            "mode": "range",
            "max": ceiling,
            "currency": "USD",
            "channel": "fixture-official",
            "period": "month",
            "monthlyInputTokens": 1e6,
            "monthlyOutputTokens": 1e6,
            "costScope": scope,
        },
    )


def quote():
    return {
        "input": 2.0,
        "output": 12.0,
        "currency": "USD",
        "channel": "fixture-official",
        "unit": "per-million-tokens",
        "conditions": "standard-uncached-tokens-only",
        "tiers": [
            {"upToInputTokens": 200000, "input": 2.0, "output": 12.0},
            {"upToInputTokens": None, "input": 4.0, "output": 18.0},
        ],
    }


def claim(price):
    return Claim(
        id="fixture-price",
        entity_id="fixture-model",
        predicate="api_price",
        object_or_value=json.dumps(price),
        valid_from="2026-10-09",
        confidence="verified",
        source_ids=["fixture-source"],
        updated_at="2026-10-13",
        text={
            "zh": "合成分档价格合同测试；不是真实报价",
            "en": "Synthetic tiered price contract, not a supplier quote.",
        },
    )


@pytest.mark.parametrize(
    "ceiling, expected",
    [
        (25, []),
        (18, ["price-conditions-unverified"]),
        (10, ["over-budget"]),
    ],
)
def test_tiers_do_not_collapse_to_lowest_rate_or_false_budget_exclusion(ceiling, expected):
    snapshot = KnowledgeSnapshot.model_validate_json(
        (Path(__file__).resolve().parents[1] / "data/demo_snapshot.json").read_bytes()
    )
    entity = next(row for row in snapshot.entities if row.id == "e-gpt").model_copy(
        update={"id": "fixture-model", "family_id": "e-gpt", "release": None}
    )
    price = quote()
    assert token_quote_bounds(price, context(ceiling)) == (14, 22)
    assert constraint_failures(entity, [claim(price)], context(ceiling)) == expected
    # A condition-bearing quote cannot be treated as a flat-price cost winner.
    assert cost_choice(
        context(ceiling), ["a", "b"], {"a": [claim(price)], "b": [claim(price)]}
    ) == (None, [])


def test_explicit_token_scope_is_not_assumed_to_cover_all_costs():
    assert token_quote_bounds(quote(), context(scope="all-costs")) is None
    flat = quote()
    flat.pop("tiers")
    flat["input"] = 0.75
    flat["output"] = 3.75
    assert token_quote_bounds(flat, context()) == (4.5, 4.5)
    assert token_quote_bounds(flat, context(scope="all-costs")) is None


def test_known_maximum_request_input_resolves_short_tier_but_never_discards_reachable_long_tiers():
    ctx = context(18)
    ctx.budget.maximum_input_tokens_per_request = 200000
    assert token_quote_bounds(quote(), ctx) == (14, 14)
    ctx.budget.maximum_input_tokens_per_request = 200001
    assert token_quote_bounds(quote(), ctx) == (14, 22)


def test_different_rates_for_the_same_tier_boundaries_are_conflicting():
    a = quote()
    b = quote()
    b["tiers"][1]["output"] = 20
    assert conflicting_entities({"fixture-model": [claim(a), claim(b)]}) == {"fixture-model"}


@pytest.mark.parametrize(
    "change",
    [
        lambda p: p.update(conditions="unknown-pricing-mode"),
        lambda p: p.update(region="unspecified"),
        lambda p: p["tiers"][1].update(input=-1),
        lambda p: p["tiers"][1].update(output=True),
        lambda p: p["tiers"][1].update(upToInputTokens=999999),
        lambda p: p["tiers"].reverse(),
        lambda p: p["tiers"].append(deepcopy(p["tiers"][-1])),
        lambda p: p["tiers"][0].update(extra="unverified"),
    ],
)
def test_unrecognized_or_malformed_conditions_remain_unverified(change):
    price = quote()
    change(price)
    assert token_quote_bounds(price, context()) is None
