"""Frozen constraint cases: no catalog price or coverage count proves fitness."""

import json
from pathlib import Path

import pytest

from app.decision_constraints import constraint_failures, current_claims
from app.engagement import EngagementService
from app.schemas import Claim, DecisionContext

SEED_PATH = Path(__file__).resolve().parents[1] / "data/demo_snapshot.json"
from app.engagement import revalidate_research
from app.schemas import KnowledgeSnapshot, ResearchCitation, ResearchView


def fixture():
    snapshot = KnowledgeSnapshot.model_validate_json(SEED_PATH.read_bytes())
    entity = next(e for e in snapshot.entities if e.id == "e-gpt")
    fact = Claim(
        id="price-36h",
        entity_id=entity.id,
        text={"zh": "测试价格", "en": "Fixture price"},
        confidence="verified",
        source_ids=[snapshot.evidence[0].id],
        updated_at="2026-10-06",
        predicate="api_price",
        valid_from="2026-10-01",
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
    snapshot.claims = [fact]
    context = DecisionContext(
        task="Choose a model API",
        task_type="model-api",
        priority="cost",
        deployment="undecided",
        budget={
            "mode": "range",
            "max": 11,
            "currency": "USD",
            "channel": "official",
            "monthlyInputTokens": 1_000_000,
            "monthlyOutputTokens": 1_000_000,
        },
    )
    return snapshot, entity, fact, context


@pytest.mark.parametrize(
    "case,expected",
    [
        ("valid", []),
        ("over-budget", ["over-budget"]),
        ("wrong-currency", ["price-unverified-or-conflicting"]),
        ("wrong-channel", ["price-unverified-or-conflicting"]),
        ("no-workload", ["workload-missing"]),
        ("no-channel", ["budget-assumptions-missing"]),
        ("no-ceiling", ["budget-assumptions-missing"]),
        ("excluded-id", ["excluded"]),
        ("excluded-name", ["excluded"]),
        ("private", ["deployment-unverified"]),
        ("on-device", ["deployment-unverified"]),
        ("region", ["region-unverified"]),
        ("coding", ["different-task-type"]),
        ("agent", ["different-task-type"]),
        ("expired", ["price-unverified-or-conflicting"]),
        ("future", ["price-unverified-or-conflicting"]),
        ("inferred", ["price-unverified-or-conflicting"]),
        ("not-public", ["price-unverified-or-conflicting"]),
        ("invalid-rate", ["price-unverified-or-conflicting"]),
        ("wrong-unit", ["price-unverified-or-conflicting"]),
    ],
)
def test_frozen_hard_constraints(case, expected):
    snapshot, entity, fact, context = fixture()
    if case == "over-budget":
        context.budget.max = 9
    if case == "wrong-currency":
        context.budget.currency = "CNY"
    if case == "wrong-channel":
        context.budget.channel = "reseller"
    if case == "no-workload":
        context.budget.monthly_output_tokens = None
    if case == "no-channel":
        context.budget.channel = None
    if case == "no-ceiling":
        context.budget.max = None
    if case == "excluded-id":
        context.exclusions = [entity.id]
    if case == "excluded-name":
        context.exclusions = [entity.name.en.upper()]
    if case in {"private", "on-device"}:
        context.deployment = case
    if case == "region":
        context.region = "CN"
    if case == "coding":
        context.task_type = "coding-product"
    if case == "agent":
        context.task_type = "agent-development"
    if case == "expired":
        fact.valid_to = "2026-10-01"
    if case == "future":
        fact.valid_from = "2099-01-01"
    if case == "inferred":
        fact.confidence = "inferred"
    if case == "not-public":
        snapshot.claims = []
    if case in {"invalid-rate", "wrong-unit"}:
        price = json.loads(fact.object_or_value)
        if case == "invalid-rate":
            price["input"] = -1
        else:
            price["unit"] = "per-token"
        fact.object_or_value = json.dumps(price)
    assert constraint_failures(entity, current_claims([fact], snapshot), context) == expected
    result = EngagementService._build_decision(context, [fact], [entity.id], snapshot, "en")
    assert result.recommendation.primary_entity_id == (None if expected else entity.id)
    assert set(result.claim_ids) <= {c.id for c in current_claims([fact], snapshot)}


@pytest.mark.parametrize("state", ["current", "updated", "unavailable"])
def test_saved_advice_revalidates_publication(state):
    snapshot, entity, fact, context = fixture()
    decision = EngagementService._build_decision(context, [fact], [entity.id], snapshot, "en")
    result = ResearchView(
        id="history-fixture",
        question="Choose a model API",
        summary="Old advice",
        claim_ids=[fact.id],
        steps=[],
        status="ready",
        citations=[
            ResearchCitation(claim=fact.model_copy(deep=True), evidence=[snapshot.evidence[0]])
        ],
        decision=decision,
        created_at="2026-10-06T00:00:00Z",
    )
    if state == "updated":
        fact.text.en = "Corrected price conditions"
    if state == "unavailable":
        snapshot.claims = []
    checked = revalidate_research(result, snapshot)
    assert checked.citation_states == {fact.id: state}
    assert result.summary == "Old advice"
    if state != "current":
        assert checked.status == "insufficient-evidence"
        assert checked.citations == []
        assert checked.claim_ids == []
        assert checked.decision.claim_ids == []
        assert checked.decision.recommendation.primary_entity_id is None
    else:
        assert checked.summary == "Old advice"
        assert checked.claim_ids == [fact.id]


@pytest.mark.parametrize(
    "field,value",
    [
        ("valid_from", "not-a-date"),
        ("valid_to", "invalid"),
        ("valid_from", "2999-01-01"),
        ("valid_to", "2000-01-01"),
    ],
)
def test_history_invalid_or_inactive_dates_remove_current_citations(field, value):
    snapshot, _entity, fact, _context = fixture()
    setattr(fact, field, value)
    result = ResearchView(
        id="invalid-date-history",
        question="Choose a model API",
        summary="Old advice",
        claim_ids=[fact.id],
        steps=[],
        status="ready",
        citations=[
            ResearchCitation(claim=fact.model_copy(deep=True), evidence=[snapshot.evidence[0]])
        ],
        created_at="2026-10-06T00:00:00Z",
    )
    checked = revalidate_research(result, snapshot)
    assert checked.citation_states[fact.id] == "unavailable"
    assert checked.claim_ids == []
    assert checked.citations == []
    assert checked.status == "insufficient-evidence"


@pytest.mark.parametrize("retrieved_conflict", [True, False])
def test_current_public_conflict_prevents_a_verified_fact_becoming_a_recommendation(
    retrieved_conflict,
):
    snapshot, entity, fact, context = fixture()
    conflict = fact.model_copy(deep=True, update={"id": "conflict-36h", "confidence": "conflict"})
    snapshot.claims.append(conflict)
    matched = [fact, conflict] if retrieved_conflict else [fact]
    result = EngagementService._build_decision(context, matched, [entity.id], snapshot, "en")
    assert result.status == "conflict"
    assert result.recommendation.primary_entity_id is None
    assert result.recommendation.alternative_entity_ids == []
    assert result.claim_ids == []


@pytest.mark.parametrize(
    "text,reason",
    [
        ("不接受闭源", "open-weights-unverified"),
        ("no closed source", "open-weights-unverified"),
        ("必须境内部署", "region-unverified"),
        ("必须支持我的特殊审计条件", "exclusion-needs-clarification"),
    ],
)
def test_free_text_constraints_cannot_silently_pass(text, reason):
    snapshot, entity, fact, context = fixture()
    context.exclusions = [text]
    assert reason in constraint_failures(entity, [fact], context)
    result = EngagementService._build_decision(context, [fact], [entity.id], snapshot, "zh")
    assert result.recommendation.primary_entity_id is None


def test_open_weights_constraint_passes_only_with_current_explicit_evidence():
    snapshot, entity, fact, context = fixture()
    access = fact.model_copy(
        update={"id": "access", "predicate": "access", "object_or_value": "open-weights"}
    )
    snapshot.claims.append(access)
    context.exclusions = ["不接受闭源"]
    assert constraint_failures(entity, current_claims([fact, access], snapshot), context) == []


@pytest.mark.parametrize(
    "field,value",
    [("valid_from", "not-a-date"), ("valid_to", "invalid"), ("valid_from", "2026-99-99")],
)
def test_invalid_dates_cannot_be_current_decision_evidence(field, value):
    snapshot, _entity, fact, _context = fixture()
    setattr(fact, field, value)
    assert current_claims([fact], snapshot) == []


def test_collection_date_cannot_replace_missing_fact_or_source_date():
    snapshot, _entity, fact, _context = fixture()
    fact.valid_from = None
    snapshot.evidence[0].published_at = ""
    assert current_claims([fact], snapshot) == []


@pytest.mark.parametrize(
    "change", ["new-conflict", "new-price", "source-correction", "expired", "removed"]
)
def test_saved_advice_invalidates_and_recovers_without_rewriting_history(change):
    snapshot, entity, fact, context = fixture()
    decision = EngagementService._build_decision(context, [fact], [entity.id], snapshot, "en")
    assert decision.recommendation.primary_entity_id == entity.id
    saved = ResearchView(
        id="history-recovery-drill",
        question=context.task,
        summary="Saved advice",
        claim_ids=[fact.id],
        steps=[],
        status="ready",
        decision=decision,
        decision_context=context,
        citations=[
            ResearchCitation(
                claim=fact.model_copy(deep=True),
                evidence=[snapshot.evidence[0].model_copy(deep=True)],
            )
        ],
        created_at="2026-10-06T00:00:00Z",
    )
    before = saved.model_dump_json()
    changed = snapshot.model_copy(deep=True)
    if change == "new-conflict":
        changed.claims.append(
            fact.model_copy(update={"id": "new-conflict", "confidence": "conflict"}, deep=True)
        )
    elif change == "new-price":
        changed.claims.append(
            fact.model_copy(
                update={
                    "id": "new-price",
                    "object_or_value": fact.object_or_value.replace('"input": 2', '"input": 20'),
                },
                deep=True,
            )
        )
    elif change == "source-correction":
        changed.evidence[0].source_excerpt = "Corrected source no longer supports the saved terms."
    elif change == "expired":
        changed.claims[0].valid_to = "2000-01-01"
    else:
        changed.claims = []
    visible = revalidate_research(saved, changed)
    assert visible.status == "insufficient-evidence"
    assert visible.decision.recommendation.primary_entity_id is None
    assert visible.decision.guidance is None
    assert visible.decision.plan is None
    assert not visible.claim_ids
    assert saved.model_dump_json() == before
    recovered = revalidate_research(saved, snapshot)
    assert recovered.status == "ready"
    assert recovered.decision.recommendation.primary_entity_id == entity.id
    assert saved.model_dump_json() == before


@pytest.mark.parametrize("unrelated", [True, False])
def test_unrelated_or_expired_conflict_does_not_invalidate_saved_advice(unrelated):
    snapshot, entity, fact, context = fixture()
    snapshot.claims.append(
        fact.model_copy(
            update={"id": "old-conflict", "confidence": "conflict", "valid_to": "2000-01-01"},
            deep=True,
        )
    )
    if unrelated:
        snapshot.claims[-1].entity_id = "another-entity"
        snapshot.claims[-1].valid_to = None
    decision = EngagementService._build_decision(context, [fact], [entity.id], snapshot, "en")
    assert decision.recommendation.primary_entity_id == entity.id
    saved = ResearchView(
        id="unrelated-conflict",
        question=context.task,
        summary="Saved advice",
        claim_ids=[fact.id],
        steps=[],
        status="ready",
        decision=decision,
        decision_context=context,
        citations=[ResearchCitation(claim=fact, evidence=[snapshot.evidence[0]])],
        created_at="2026-10-06T00:00:00Z",
    )
    assert revalidate_research(saved, snapshot).status == "ready"
