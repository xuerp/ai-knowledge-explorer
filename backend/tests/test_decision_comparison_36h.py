import json
from pathlib import Path

import pytest

from app.engagement import EngagementService, revalidate_research
from app.schemas import Claim, DecisionContext, KnowledgeSnapshot, ResearchCitation, ResearchView

SEED = Path(__file__).resolve().parents[1] / "data/demo_snapshot.json"


def decision_fixture(priority="cost"):
    snapshot = KnowledgeSnapshot.model_validate_json(SEED.read_bytes())
    first = next(entity for entity in snapshot.entities if entity.id == "e-gpt")
    second = next(entity for entity in snapshot.entities if entity.id == "e-qwen")
    facts = [
        Claim(
            id=f"fixture-{entity.id}",
            entity_id=entity.id,
            text={
                "zh": f"{entity.name.zh} 仅限测试的价格",
                "en": f"{entity.name.en} fixture price",
            },
            confidence="verified",
            source_ids=[snapshot.evidence[0].id],
            updated_at="2026-10-07",
            valid_from="2026-10-01",
            predicate="api_price",
            object_or_value=json.dumps(
                {
                    "input": 2,
                    "output": 8,
                    "currency": "USD",
                    "unit": "per-million-tokens",
                    "channel": "official",
                }
            ),
        )
        for entity in (first, second)
    ]
    snapshot.claims = facts
    context = DecisionContext(
        task="Compare model API evidence",
        task_type="model-api",
        priority=priority,
        budget={"mode": "unknown"},
        deployment="undecided",
        candidate_entity_ids=[first.id, second.id],
    )
    return snapshot, facts, context


def decide(snapshot, facts, context, language="en"):
    return EngagementService._build_decision(
        context, facts, context.candidate_entity_ids, snapshot, language
    )


def test_two_prices_share_a_dimension_but_never_create_a_capability_ranking():
    snapshot, facts, context = decision_fixture()
    result = decide(snapshot, facts, context)
    assert result.recommendation.primary_entity_id is None
    assert len(result.comparisons) == 1
    row = result.comparisons[0]
    assert row.dimension == "API price (USD · official · per million tokens)"
    assert [cell.entity_id for cell in row.cells] == context.candidate_entity_ids
    assert all(cell.state == "supported" for cell in row.cells)
    assert [cell.facts[0].finding for cell in row.cells] == [fact.text.en for fact in facts]
    assert [cell.facts[0].claim_ids for cell in row.cells] == [[fact.id] for fact in facts]
    assert result.tradeoffs == []


@pytest.mark.parametrize("change", ["currency", "channel", "tier"])
def test_different_price_bases_remain_separate_with_explicit_unknown_cells(change):
    snapshot, facts, context = decision_fixture()
    price = json.loads(facts[1].object_or_value)
    price[change] = {"currency": "CNY", "channel": "reseller", "tier": "batch"}[change]
    facts[1].object_or_value = json.dumps(price)
    result = decide(snapshot, facts, context)
    assert len(result.comparisons) == 2
    assert len({row.id for row in result.comparisons}) == 2
    for row in result.comparisons:
        assert sorted(cell.state for cell in row.cells) == ["supported", "unknown"]
        assert all(not cell.facts for cell in row.cells if cell.state == "unknown")


def test_parameter_count_and_benchmark_prose_do_not_become_speed_evidence():
    snapshot, facts, context = decision_fixture("speed")
    facts[0].predicate, facts[0].object_or_value = "total parameters", "671B"
    facts[0].text.en = "671B total and 37B activated per token."
    facts[1].predicate, facts[1].object_or_value = "benchmarked-on", "SWE-bench"
    facts[1].text.en = "The vendor reports a historical SWE-bench result."
    result = decide(snapshot, facts, context)
    assert result.comparisons[0].dimension == "Speed (comparable tests)"
    assert all(cell.state == "unknown" for cell in result.comparisons[0].cells)
    size = result.comparisons[1]
    assert size.dimension == "Total parameters"
    assert size.cells[0].facts[0].finding == facts[0].text.en
    assert size.cells[1].state == "unknown"
    assert result.tradeoffs[0].dimension == "additional-evidence"
    assert result.tradeoffs[0].finding == facts[1].text.en


@pytest.mark.parametrize("state", ["pending", "expired", "future", "inferred", "not-public"])
def test_unavailable_evidence_cannot_fill_a_comparison_cell(state):
    snapshot, facts, context = decision_fixture()
    hidden = facts[1].model_copy(deep=True)
    if state in {"pending", "inferred"}:
        hidden.confidence = "inferred"
    if state == "expired":
        hidden.valid_to = "2026-10-01"
    if state == "future":
        hidden.valid_from = "2999-01-01"
    snapshot.claims = [facts[0]] + ([] if state in {"pending", "not-public"} else [hidden])
    result = decide(snapshot, [facts[0], hidden], context)
    assert {cell.entity_id for row in result.comparisons for cell in row.cells} == {
        facts[0].entity_id
    }
    assert {
        key
        for row in result.comparisons
        for cell in row.cells
        for fact in cell.facts
        for key in fact.claim_ids
    } == {facts[0].id}


def test_retracted_comparison_evidence_clears_the_entire_saved_comparison():
    snapshot, facts, context = decision_fixture()
    decision = decide(snapshot, facts, context)
    saved = ResearchView(
        id="comparison-history",
        question=context.task,
        summary="Fixture history",
        claim_ids=[fact.id for fact in facts],
        decision=decision,
        status="ready",
        steps=[],
        citations=[
            ResearchCitation(claim=fact.model_copy(deep=True), evidence=[snapshot.evidence[0]])
            for fact in facts
        ],
        created_at="2026-10-07T00:00:00Z",
    )
    snapshot.claims = facts[:1]
    checked = revalidate_research(saved, snapshot)
    assert checked.status == "insufficient-evidence"
    assert checked.decision.comparisons == []
    assert checked.decision.recommendation.primary_entity_id is None
    assert saved.decision.comparisons


@pytest.mark.parametrize(
    "value",
    [
        "[]",
        "null",
        "bad JSON",
        '{"input": true,"output":8,"currency":"USD","channel":"official","unit":"per-million-tokens"}',
    ],
)
def test_invalid_machine_price_does_not_become_known_cost(value):
    snapshot, facts, context = decision_fixture()
    for fact in facts:
        fact.object_or_value = value
    result = decide(snapshot, facts, context)
    assert result.comparisons[0].dimension == "API price"
    assert all(cell.state == "unknown" and not cell.facts for cell in result.comparisons[0].cells)


def test_chinese_unknown_priority_row_and_legacy_history_default():
    snapshot, facts, context = decision_fixture("quality")
    result = decide(snapshot, facts, context, "zh")
    assert result.comparisons[0].dimension == "任务效果（同口径测试）"
    assert all(cell.state == "unknown" for cell in result.comparisons[0].cells)
    legacy = result.model_dump()
    legacy.pop("comparisons")
    assert type(result).model_validate(legacy).comparisons == []
