"""Raw route recognition from authored prompts, not an independent user study."""

import json
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app import decision_constraints
from app.decision_candidates import discover_candidates, feature_ids, interpret_scenario
from app.decision_constraints import current_claims
from app.decision_intent import requested_feature_ids
from app.engagement import EngagementService
from app.repository import KnowledgeRepository
from app.schemas import DecisionContext

CASES = json.loads(
    (Path(__file__).resolve().parents[1] / "data/decision_first_use_cases.v1.json").read_text(
        "utf-8"
    )
)["cases"]


@pytest.fixture
def reviewed_catalog(monkeypatch):
    class PublicationClock(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2026, 10, 16, 10, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant.replace(tzinfo=None)

    # Frozen publication regression. The CLI audit separately uses the real clock.
    monkeypatch.setattr(decision_constraints, "datetime", PublicationClock)
    return KnowledgeRepository(
        Path(__file__).resolve().parents[1] / "data/demo_snapshot.json"
    ).load_seed()


@pytest.mark.parametrize("case", CASES, ids=lambda row: row["id"])
def test_recognized_contract_can_produce_cited_advice_or_honest_recovery(case, reviewed_catalog):
    # Browser recognition is independently checked from raw input in the frontend tests.
    context = DecisionContext(
        workflow_version=2,
        task=case["task"],
        task_type=case.get("type", "unspecified"),
        priority="quality",
        deployment="undecided",
        input_modalities=["image"] if case.get("image") else [],
    )
    if case["kind"] == "strict":
        context.deployment = "on-device"
        context.minimum_context_tokens = 2000000
        context.commercial_use_required = True
    if case["kind"] == "cost-unconfirmed":
        context.budget.mode = "range"
        context.budget.max = 100
        context.budget.currency = "CNY"
    current = current_claims(reviewed_catalog.claims, reviewed_catalog)
    by_entity = defaultdict(list)
    for claim in current:
        by_entity[claim.entity_id].append(claim)
    ids, _ = discover_candidates(context, reviewed_catalog, by_entity, "zh")
    decision = EngagementService._build_decision(
        context, [claim for claim in current if claim.entity_id in ids], ids, reviewed_catalog, "zh"
    )
    assert decision.scenario.id == case["scenario"]
    if case["kind"] == "qualified":
        assert decision.plan.state == "ready-to-validate" and decision.plan.trial_candidate_ids
    if case["kind"] in {"strict", "clarify"}:
        assert (
            not decision.plan.trial_candidate_ids and not decision.recommendation.primary_entity_id
        )
    if case["kind"] == "cost-unconfirmed":
        assert decision.recommendation.basis != "comparable-cost"
    claim_ids = {claim.id for claim in current}
    assert all(
        key in claim_ids
        for row in decision.candidates
        for finding in row.strengths
        for key in finding.claim_ids
    )


@pytest.mark.parametrize("case", CASES, ids=lambda row: row["id"])
def test_raw_task_has_the_same_route_as_frontend(case):
    context = DecisionContext(task=case["task"], priority="quality", deployment="undecided")
    scenario = interpret_scenario(context, "zh")
    assert scenario.id == case["scenario"]
    assert set(case.get("features", [])) <= set(scenario.required_features)


def test_actions_outrank_incidental_topics_without_rewriting_explicit_scope():
    mixed = DecisionContext(
        task="RAG应用，检索已有，只选择底层模型", priority="quality", deployment="undecided"
    )
    assert interpret_scenario(mixed, "zh").id == "knowledge-assistant"
    for task in [
        "请起草一篇介绍 RAG 的文章，选择写作模型",
        "Draft an article about multi-agent orchestration using supplied facts",
    ]:
        context = DecisionContext(task=task, priority="quality", deployment="undecided")
        assert interpret_scenario(context, "zh").id == "general-text"
    context = DecisionContext(
        task="选择代码模型", task_type="coding-product", priority="quality", deployment="undecided"
    )
    assert interpret_scenario(context, "zh").id == "coding-workspace"
    context = DecisionContext(
        task="把合同字段转成 JSON，输入已经转成纯文本", priority="quality", deployment="undecided"
    )
    assert "document-input" not in interpret_scenario(context, "zh").required_features


def test_request_paraphrases_do_not_manufacture_vendor_feature_evidence():
    for task, requested in [
        ("选择文档问答模型，需要自带检索", True),
        ("选择文档问答模型，不需要自带检索", False),
    ]:
        context = DecisionContext(task=task, priority="quality", deployment="undecided")
        assert ("retrieval" in interpret_scenario(context, "zh").required_features) == requested
    text = "重要操作由人点确认，失败从上一步继续"
    assert {"human-approval", "failure-recovery"} <= requested_feature_ids(text)
    assert not {"human-approval", "failure-recovery"}.intersection(feature_ids(text))
    context = DecisionContext(
        task="Agent framework; human approval not required",
        priority="quality",
        deployment="undecided",
    )
    assert "human-approval" not in interpret_scenario(context, "en").required_features
