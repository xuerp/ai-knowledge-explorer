"""Decision actions must progress a choice without bypassing evidence gates."""

from datetime import UTC, datetime

import pytest

from app.decision_plan import PROTOCOLS, build_plan
from app.schemas import (
    DecisionCandidate,
    DecisionContext,
    DecisionGap,
    DecisionRecommendation,
    DecisionResult,
    DecisionScenario,
    DecisionTradeoff,
)


def result(*rows, scenario="general-text", missing=(), status="insufficient-evidence"):
    return DecisionResult(
        scenario=DecisionScenario(id=scenario, required_features=["text-generation"]),
        candidates=list(rows),
        missing_inputs=list(missing),
        status=status,
        as_of=datetime.now(UTC),
        recommendation=DecisionRecommendation(summary="fixture"),
    )


def candidate(key="a", eligibility="eligible", gap=None, described=True):
    return DecisionCandidate(
        entity_id=key,
        eligibility=eligibility,
        claim_ids=["claim-" + key],
        strengths=[
            DecisionTradeoff(
                dimension="text-generation", finding="description", claim_ids=["claim-" + key]
            )
        ]
        if described
        else [],
        gaps=[gap] if gap else [],
    )


@pytest.mark.parametrize(
    "task,language,forbidden,required",
    [
        (
            "我要做一个求职助手：从中文简历中提取工作经历、技能和教育背景，再与岗位要求匹配，输出固定 JSON 字段。目前只处理文本，优先考虑准确性，预算暂不确定，接受云 API。",
            "zh",
            ("扫描件", "页数"),
            ("岗位要求匹配", "JSON", "全部交付", "原文"),
        ),
        (
            "Extract invoice fields from plain text only, then compare totals with the purchase order and return JSON.",
            "en",
            ("scans", "pages"),
            ("compare totals", "JSON", "every requested deliverable", "source"),
        ),
    ],
)
def test_text_extraction_protocol_keeps_input_scope_and_all_deliverables(
    task, language, forbidden, required
):
    plan = build_plan(
        result(candidate(), scenario="document-extraction"),
        context().model_copy(update={"task": task}),
        language,
    )
    text = plan.trial.model_dump_json()
    assert all(word not in text for word in forbidden)
    assert all(word in text for word in required)
    assert not plan.trial.executed
    # Scanned input remains supported when it is actually requested.
    scan = build_plan(
        result(candidate(), scenario="document-extraction"),
        context().model_copy(update={"task": "提取扫描件中的发票字段"}),
        "zh",
    )
    assert "扫描件" in scan.trial.sample
    assert "页数" in scan.trial.procedure[0]


def test_saved_extraction_refreshes_only_unexecuted_instructions():
    from pathlib import Path

    from app.decision_guidance import build_guidance
    from app.engagement import revalidate_research
    from app.repository import KnowledgeRepository
    from app.schemas import ResearchView

    task = "仅处理文本，从简历提取技能，再与岗位要求匹配，输出 JSON。"
    settings = context().model_copy(update={"task": task, "workflow_version": 2})
    decision = result(candidate(), scenario="document-extraction")
    decision.plan = build_plan(decision, settings, "zh")
    decision.plan.trial.sample = "旧计划：扫描件"
    decision.plan.trial.procedure = ["旧计划：页数"]
    snapshot = KnowledgeRepository(
        Path(__file__).resolve().parents[1] / "data/demo_snapshot.json"
    ).load_seed()
    decision.guidance = build_guidance(decision, settings, snapshot, "zh")
    record = ResearchView(
        id="saved-text-extraction",
        question=task,
        summary="original",
        claim_ids=[],
        citations=[],
        steps=[],
        status="ready",
        created_at=datetime.now(UTC),
        decision_context=settings,
        decision=decision,
    )
    before = record.model_dump_json()
    refreshed = revalidate_research(record, snapshot)
    trial = refreshed.decision.plan.trial
    assert "扫描件" not in trial.sample
    assert "页数" not in " ".join(trial.procedure)
    assert "岗位要求匹配" in " ".join(trial.procedure)
    prompt = refreshed.decision.guidance.next_action.execution_prompt
    assert task in prompt
    assert trial.sample in prompt
    assert all(item in prompt for item in [*trial.procedure, *trial.metrics, *trial.acceptance])
    assert "未运行" in prompt
    assert refreshed.created_at == record.created_at
    assert refreshed.decision.candidates == record.decision.candidates
    assert refreshed.decision_context == settings
    assert record.model_dump_json() == before


def context(priority="quality"):
    return DecisionContext(task="text generation", priority=priority, deployment="undecided")


@pytest.mark.parametrize("scene", list(PROTOCOLS))
@pytest.mark.parametrize("language", ["zh", "en"])
def test_all_supported_scenarios_have_unexecuted_specific_protocols(scene, language):
    plan = build_plan(result(candidate(), scenario=scene), context(), language)
    assert plan.state == "ready-to-validate"
    assert plan.trial_candidate_ids == ["a"]
    assert plan.trial.executed is False
    assert plan.trial.sample and len(plan.trial.procedure) == 2
    assert plan.trial.metrics and plan.trial.acceptance
    assert plan.actions[0].kind == "test"


def test_excluded_and_undocumented_candidates_do_not_join_trial():
    rows = [
        candidate("excluded", "excluded"),
        candidate("unknown-feature", described=False),
        candidate("qualified"),
    ]
    plan = build_plan(result(*rows), context(), "en")
    assert plan.trial_candidate_ids == ["qualified"]
    assert all("excluded" not in action.candidate_ids for action in plan.actions)


def test_missing_input_and_conflicts_block_all_trial_actions():
    for value in [
        result(candidate(), missing=["budget-currency"]),
        result(candidate(), status="conflict"),
    ]:
        plan = build_plan(value, context(), "en")
        assert plan.state in {"needs-input", "conflict"}
        assert not plan.trial_candidate_ids
        assert not any(action.kind == "test" for action in plan.actions)
    assert (
        "currency"
        in build_plan(result(candidate(), missing=["budget-currency"]), context(), "en")
        .actions[0]
        .instruction
    )


def test_gap_causes_require_different_recovery_and_keep_source_links():
    rows = [
        candidate(
            str(i),
            "unknown",
            DecisionGap(dimension="context", reason=reason, detail="gap", claim_ids=[f"c{i}"]),
        )
        for i, reason in enumerate(["not-current", "not-structured", "not-recorded", "conflicting"])
    ]
    plan = build_plan(result(*rows), context(), "en")
    assert (
        plan.state == "needs-evidence"
    )  # Conflict gaps do not rewrite the authoritative eligibility.
    assert {action.id.split(":")[0] for action in plan.actions} == {
        "not-current",
        "not-structured",
        "not-recorded",
        "conflicting",
    }
    assert plan.actions[0].kind == "reconcile"
    assert all(action.claim_ids and action.unlocks for action in plan.actions)
    assert not plan.trial_candidate_ids


def test_all_excluded_and_empty_scope_do_not_propose_tests():
    excluded = build_plan(result(candidate(eligibility="excluded")), context(), "zh")
    assert excluded.state == "all-excluded" and excluded.trial is None
    assert excluded.actions[0].kind == "change-scope"
    empty = build_plan(result(), context(), "en")
    assert empty.state == "no-candidates" and empty.trial is None
    unspecified = build_plan(result(scenario="unspecified"), context(), "en")
    assert unspecified.state == "needs-input" and unspecified.actions[0].kind == "clarify"


def test_uncovered_qualification_reason_still_produces_an_action():
    row = candidate(eligibility="unknown")
    row.reasons = ["Prior written commercial authorization is required"]
    plan = build_plan(result(row), context(), "en")
    assert plan.actions[0].instruction == row.reasons[0]
    assert plan.actions[0].candidate_ids == ["a"]
    assert not plan.trial_candidate_ids


def test_named_candidates_without_a_business_task_have_a_concrete_clarification():
    value = result(candidate(), scenario="unspecified")
    value.scenario.required_features = []
    plan = build_plan(value, context(), "en")
    assert plan.state == "needs-input" and plan.actions[0].id == "clarify-business"
    assert "inputs" in plan.actions[0].instruction
    assert not plan.trial_candidate_ids
    value.candidates[0].eligibility = "excluded"
    assert build_plan(value, context(), "en").state == "all-excluded"


@pytest.mark.parametrize(
    "priority,word",
    [
        ("cost", "actual bills"),
        ("speed", "latency"),
        ("privacy", "destinations"),
        ("control", "destinations"),
    ],
)
def test_priority_changes_protocol_without_changing_product_facts(priority, word):
    value = result(candidate())
    before = value.model_dump_json()
    plan = build_plan(value, context(priority), "en")
    assert word in " ".join([*plan.trial.metrics, *plan.trial.acceptance])
    assert value.model_dump_json() == before


def test_failure_cannot_produce_a_trial_or_recommendation():
    plan = build_plan(result(candidate(), status="failed"), context(), "en")
    assert plan.state == "failed" and not plan.actions and plan.trial is None


def test_old_current_records_gain_a_plan_without_persisting_and_stale_sources_clear_it():
    from pathlib import Path

    from app.engagement import EngagementService, revalidate_research
    from app.schemas import Claim, KnowledgeSnapshot, ResearchCitation, ResearchView

    snapshot = KnowledgeSnapshot.model_validate_json(
        (Path(__file__).resolve().parents[1] / "data/demo_snapshot.json").read_bytes()
    )
    entity = next(item for item in snapshot.entities if item.id == "e-gpt").model_copy(
        update={"id": "test-version", "family_id": "e-gpt", "release": None, "status": "active"}
    )
    snapshot.entities.append(entity)
    date = datetime.now(UTC).date().isoformat()
    snapshot.evidence[0].published_at = date
    claim = Claim(
        id="test-capability",
        entity_id=entity.id,
        predicate="capability",
        text={"zh": "合成文本生成描述", "en": "Synthetic text generation description"},
        confidence="verified",
        source_ids=[snapshot.evidence[0].id],
        valid_from=date,
        updated_at=date,
    )
    snapshot.claims = [claim]
    settings = DecisionContext(
        task="text generation",
        task_type="model-api",
        workflow_version=2,
        priority="quality",
        deployment="undecided",
    )
    decision = EngagementService._build_decision(settings, [claim], [entity.id], snapshot, "en")
    decision.plan = None  # Previously saved record, without the additive field.
    record = ResearchView(
        id="saved",
        question="text generation",
        summary=decision.recommendation.summary,
        claim_ids=[claim.id],
        citations=[ResearchCitation(claim=claim, evidence=[snapshot.evidence[0]])],
        steps=[],
        status="ready",
        created_at=datetime.now(UTC),
        decision_context=settings,
        decision=decision,
    )
    before = record.model_dump_json()
    refreshed = revalidate_research(record, snapshot)
    assert refreshed.decision.plan is not None
    assert refreshed.decision.plan.trial.executed is False
    assert record.model_dump_json() == before
    snapshot.claims[0] = claim.model_copy(
        update={"text": claim.text.model_copy(update={"en": "changed"})}
    )
    stale = revalidate_research(refreshed, snapshot)
    assert stale.decision.plan is None
    assert not stale.decision.recommendation.primary_entity_id
