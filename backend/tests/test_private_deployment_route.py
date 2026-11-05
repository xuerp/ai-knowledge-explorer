"""Source-qualified self-hosting is a setup route, not a verified deployment."""

from collections import defaultdict
from pathlib import Path

from app.decision_candidates import discover_candidates
from app.decision_constraints import current_claims
from app.decision_dialogue import analysis_context, normalize_context
from app.decision_guidance import build_guidance
from app.decision_resolution import reconcile_resolution
from app.engagement import EngagementService
from app.repository import KnowledgeRepository
from app.schemas import DecisionContext


def research(snapshot):
    context = analysis_context(
        normalize_context(
            DecisionContext(
                workflow_version=2,
                priority="balanced",
                task="为团队知识库选择在自有服务器运行的文本生成模型，不能调用外部 API。",
                task_type="model-api",
                deployment="private",
                candidate_entity_ids=["e-qwen-3-235b"],
            )
        )
    )
    current = current_claims(snapshot.claims, snapshot)
    by_entity = defaultdict(list)
    for claim in current:
        by_entity[claim.entity_id].append(claim)
    ids, _ = discover_candidates(context, snapshot, by_entity, "zh")
    result = EngagementService._build_decision(
        context, [c for c in current if c.entity_id in ids], ids, snapshot, "zh"
    )
    result.guidance = build_guidance(result, context, snapshot, "zh")
    return context, reconcile_resolution(result, context, "zh")


def snapshot():
    return KnowledgeRepository(
        Path(__file__).resolve().parents[1] / "data/demo_snapshot.json"
    ).load_seed()


def test_documented_self_hosting_requires_environment_qualification_before_business_trial():
    context, result = research(snapshot())
    guidance = result.guidance
    assert guidance.outcome == "conditional"
    assert guidance.recommendation.primary_entity_id == "e-qwen-3-235b"
    assert {"access", "deployment", "commercial-use"} <= {
        item.dimension for item in guidance.recommendation.reasons
    }
    assert all(item.claim_ids for item in guidance.recommendation.reasons)
    assert not result.plan.trial_candidate_ids
    assert result.plan.trial.executed is False
    prompt = guidance.next_action.execution_prompt
    assert "显存" in prompt and "嵌入" in prompt and "网络流量" in prompt
    assert context.task in prompt and "不能调用外部 API" in prompt
    assert "未运行" in prompt


def test_weights_and_license_do_not_substitute_for_missing_deployment_evidence():
    data = snapshot()
    data.claims = [
        c
        for c in data.claims
        if not (c.entity_id == "e-qwen-3-235b" and c.predicate == "deployment")
    ]
    context, result = research(data)
    assert context.deployment == "private"
    assert result.guidance.recommendation.primary_entity_id is None
    assert not result.plan.trial_candidate_ids
    assert any(gap.requirement == "deployment" and gap.decisive for gap in result.guidance.unknowns)


def test_focused_report_omits_other_candidates_price_channels_but_preserves_real_unknowns():
    from datetime import UTC, datetime

    from app.research_report import build_report, report_markdown
    from app.schemas import (
        DecisionComparison,
        DecisionComparisonCell,
        DecisionTradeoff,
        ResearchView,
    )

    data = snapshot()
    context, result = research(data)
    selected = "e-qwen-3-235b"
    price = DecisionTradeoff(dimension="api-price", finding="Synthetic channel quote")
    result.comparisons = [
        DecisionComparison(
            id="api-price-foreign-basis",
            dimension="Foreign provider-specific channel",
            cells=[
                DecisionComparisonCell(entity_id=selected, state="unknown"),
                DecisionComparisonCell(
                    entity_id="e-gemini-3-1-pro", state="supported", facts=[price]
                ),
            ],
        ),
        DecisionComparison(
            id="context",
            dimension="Selected candidate context unknown",
            cells=[DecisionComparisonCell(entity_id=selected, state="unknown")],
        ),
    ]
    record = ResearchView(
        id="scoped-report",
        question=context.task,
        summary="Synthetic report fixture",
        claim_ids=[],
        citations=[],
        steps=[],
        status="ready",
        created_at=datetime.now(UTC),
        decision_context=context,
        decision=result,
    )
    text = report_markdown(build_report(record, data, "en"))
    assert "Foreign provider-specific channel" not in text
    assert "Selected candidate context unknown" in text
    # A price actually belonging to the selected candidate must not disappear.
    result.comparisons[0].cells[0] = DecisionComparisonCell(
        entity_id=selected, state="supported", facts=[price]
    )
    assert "Synthetic channel quote" in report_markdown(build_report(record, data, "en"))
