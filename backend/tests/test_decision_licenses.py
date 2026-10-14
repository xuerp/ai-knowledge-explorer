"""Scoped licensing software fixtures, not market facts or business/legal clearance."""

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.decision_licenses import commercial_policy
from app.engagement import EngagementService
from app.schemas import Claim, DecisionContext, Evidence, KnowledgeSnapshot


def fixture():
    today = datetime.now(UTC).date().isoformat()
    snapshot = KnowledgeSnapshot.model_validate_json(
        (Path(__file__).resolve().parents[1] / "data/demo_snapshot.json").read_bytes()
    )
    entity = next(item for item in snapshot.entities if item.id == "e-gpt").model_copy(
        update={"id": "licensed-fixture", "family_id": "e-gpt", "release": None}
    )
    snapshot.entities.append(entity)
    snapshot.evidence = [
        Evidence(
            id="license-fixture-source",
            title={"zh": "合成软件测试", "en": "Synthetic software test"},
            url="https://example.test/scoped-terms",
            publisher="Software fixture",
            type="official",
            collected_at=today,
            published_at=today,
        )
    ]
    policy = {
        "permission": "allowed",
        "scope": "api-service",
        "channel": "fixture-direct",
        "tier": "paid",
        "serviceRegions": ["US", "JP", "SG"],
        "deployment": "cloud-api",
    }
    snapshot.claims = [
        Claim(
            id=f"license-fixture-{i}",
            entity_id=entity.id,
            predicate=predicate,
            object_or_value=value,
            text={
                "zh": "合成软件验收数据，不是真实厂商许可。",
                "en": "Synthetic software acceptance data, not supplier permission.",
            },
            confidence="verified",
            source_ids=["license-fixture-source"],
            updated_at=today,
            valid_from=today,
        )
        for i, (predicate, value) in enumerate(
            [
                ("workflow-feature", "text-generation"),
                ("deployment", "cloud-api"),
                ("commercial_use", json.dumps(policy)),
            ]
        )
    ]
    context = DecisionContext(
        workflow_version=2,
        task="写作与客服对话选择模型",
        task_type="model-api",
        priority="quality",
        deployment="cloud-api",
        commercial_use_required=True,
        candidate_entity_ids=[entity.id],
        service_access={"channel": "fixture-direct", "tier": "paid", "region": "US"},
    )
    return snapshot, context


def decide(snapshot, context):
    return EngagementService._build_decision(
        context, snapshot.claims, context.candidate_entity_ids, snapshot, "zh"
    )


def test_matching_scoped_terms_support_trial_but_not_measured_performance_or_data_residency():
    snapshot, context = fixture()
    decision = decide(snapshot, context)
    assert decision.candidates[0].eligibility == "eligible"
    assert decision.plan.state == "ready-to-validate"
    assert "fixture-direct" in " ".join(decision.conditions)
    assert any(gap.reason == "requires-poc" for gap in decision.candidates[0].gaps)
    # A country where a service can be used is NOT a hosting/data residency fact.
    with_region = decide(snapshot, context.model_copy(update={"region": "US"}))
    assert with_region.candidates[0].eligibility == "unknown"
    assert any(gap.dimension == "region" for gap in with_region.candidates[0].gaps)


def test_another_channel_quote_cannot_establish_budget_fit_for_the_actual_service():
    snapshot, context = fixture()
    context.budget = context.budget.model_copy(
        update={
            "mode": "range",
            "max": 20,
            "currency": "USD",
            "channel": "another-direct-service",
            "monthly_input_tokens": 1000000,
            "monthly_output_tokens": 1000000,
        }
    )
    decision = decide(snapshot, context)
    assert decision.candidates[0].eligibility == "unknown"
    assert "api-price" not in decision.candidates[0].covered_dimensions
    assert decision.plan.state == "needs-input"
    assert decision.plan.trial_candidate_ids == []
    assert "matching-service-channel" in decision.missing_inputs
    assert any("计费渠道不一致" in reason for reason in decision.candidates[0].reasons)


@pytest.mark.parametrize(
    "access,deployment",
    [
        (None, "cloud-api"),
        ({"channel": "fixture-direct", "tier": "unknown", "region": "US"}, "cloud-api"),
        ({"channel": "fixture-direct", "tier": "paid"}, "cloud-api"),
        ({"channel": "gateway", "tier": "paid", "region": "US"}, "cloud-api"),
        ({"channel": "fixture-direct", "tier": "free", "region": "US"}, "cloud-api"),
        ({"channel": "fixture-direct", "tier": "paid", "region": "CN"}, "cloud-api"),
        ({"channel": "fixture-direct", "tier": "paid", "region": "US"}, "undecided"),
        ({"channel": "fixture-direct", "tier": "paid", "region": "US"}, "private"),
    ],
)
def test_a_different_or_unknown_service_scope_never_inherits_vendor_permission(access, deployment):
    snapshot, context = fixture()
    values = context.model_dump(by_alias=True)
    values.update(serviceAccess=access, deployment=deployment)
    decision = decide(snapshot, DecisionContext.model_validate(values))
    assert decision.candidates[0].eligibility == "unknown"
    assert decision.plan.trial_candidate_ids == []
    if (
        access is None
        or access.get("tier") == "unknown"
        or not access.get("region")
        or deployment == "undecided"
    ):
        assert decision.plan.state == "needs-input"
        assert any(action.id == "clarify-commercial-scope" for action in decision.plan.actions)


@pytest.mark.parametrize(
    "update",
    [
        {"permission": []},
        {"tier": {}},
        {"scope": "all-products"},
        {"serviceRegions": []},
        {"serviceRegions": ["China"]},
        {"serviceRegions": [None]},
        {"channel": " "},
        {"extraCondition": "requires-written-authorization"},
        {"deployment": "private"},
    ],
)
def test_malformed_or_additionally_conditional_records_cannot_be_read_as_permission(update):
    snapshot, context = fixture()
    claim = snapshot.claims[-1]
    policy = json.loads(claim.object_or_value)
    policy.update(update)
    claim.object_or_value = json.dumps(policy)
    assert commercial_policy(claim) is None
    assert decide(snapshot, context).candidates[0].eligibility == "unknown"


@pytest.mark.parametrize("change", ["pending", "expired", "withdrawn", "conflicting"])
def test_review_validity_withdrawal_and_conflicts_remain_authoritative(change):
    snapshot, context = fixture()
    claim = snapshot.claims[-1]
    if change == "pending":
        claim.confidence = "unverified"
    elif change == "expired":
        claim.valid_to = datetime.now(UTC).date().isoformat()
    elif change == "withdrawn":
        snapshot.claims.pop()
    else:
        policy = json.loads(claim.object_or_value)
        policy["permission"] = "prohibited"
        snapshot.claims.append(
            claim.model_copy(
                update={"id": "license-conflict", "object_or_value": json.dumps(policy)}
            )
        )
    decision = decide(snapshot, context)
    assert decision.candidates[0].eligibility != "eligible"
    assert decision.plan.trial_candidate_ids == []
    if change == "conflicting":
        assert decision.candidates[0].eligibility == "conflict"
