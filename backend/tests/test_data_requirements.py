import json
from pathlib import Path

from app.decision_constraints import constraint_failures
from app.decision_dialogue import analysis_context, clarification_for
from app.decision_requirements import context_requirements, requirement_checks
from app.repository import KnowledgeRepository
from app.schemas import DecisionContext, DecisionIntentAnswer


def context(task, **extra):
    return DecisionContext(
        task=task, priority="balanced", deployment=extra.pop("deployment", "private"), **extra
    )


def evidence():
    snapshot = KnowledgeRepository(
        Path(__file__).resolve().parents[1] / "data/demo_snapshot.json"
    ).load_seed()
    entity = next(item for item in snapshot.entities if item.family_id)
    claim = next(item for item in snapshot.claims if item.entity_id == entity.id)
    return entity, claim


def test_cross_border_is_not_proven_by_private_deployment_or_cn_region():
    entity, claim = evidence()
    ctx = context("给内部文档做问答，不能传到境外服务器。")
    claims = [
        claim.model_copy(update={"predicate": "deployment", "object_or_value": "private"}),
        claim.model_copy(update={"predicate": "region", "object_or_value": "CN"}),
    ]
    assert "data-boundary-unverified" in constraint_failures(entity, claims, ctx)
    assert context_requirements(ctx)[0].dimension == "cross-border"


def test_scoped_reviewed_policy_can_satisfy_boundary_and_conflict_cannot():
    _, claim = evidence()
    ctx = context("给内部文档做问答，数据不出境。")
    fact = {
        "dimension": "cross-border",
        "operator": "forbid",
        "value": "transfer",
        "scope": "all-processing",
        "deployment": "private",
        "channel": None,
        "satisfied": True,
    }
    allowed = claim.model_copy(
        update={
            "id": "reviewed-policy",
            "predicate": "data-handling",
            "object_or_value": json.dumps(fact),
        }
    )
    assert requirement_checks(ctx, [allowed])[0]["state"] == "satisfied"
    denied = allowed.model_copy(
        update={
            "id": "contradictory-policy",
            "object_or_value": json.dumps({**fact, "satisfied": False}),
        }
    )
    assert requirement_checks(ctx, [denied])[0]["state"] == "unsatisfied"
    assert requirement_checks(ctx, [allowed, denied])[0]["state"] == "unknown"
    assert (
        requirement_checks(ctx.model_copy(update={"deployment": "cloud-api"}), [allowed])[0][
            "state"
        ]
        == "unknown"
    )


def test_no_upload_does_not_imply_permission_to_upload_to_private_cloud():
    ctx = context("处理客户资料，但不能上传任何文件。")
    requirement = context_requirements(ctx)[0]
    assert requirement.dimension == "upload" and requirement.scope == "unspecified"
    assert requirement_checks(ctx, [])[0]["state"] == "unknown"
    explicit = context("处理客户资料，不能让文件离开本地设备。")
    assert context_requirements(explicit)[0].scope == "local-device"


def test_negated_and_optional_requirements_do_not_create_false_hard_blocks():
    assert context_requirements(context("处理公开文档，不要求数据不出境。")) == []
    assert context_requirements(context("处理公开文档，希望隐私保护比较好。")) == []


def test_clarification_preserves_hard_boundary_and_applies_selected_scope():
    ctx = context("把文档做成内部知识库，资料不能上传。")
    question = clarification_for(ctx, "zh")
    assert question.id == "upload-boundary"
    scoped = ctx.model_copy(
        update={
            "intent_answers": [
                DecisionIntentAnswer(question_id="upload-boundary", option_id="local-device")
            ],
        },
    )
    assert context_requirements(scoped)[0].scope == "local-device"
    assert context_requirements(scoped)[0].quote == "资料不能上传"
    assert requirement_checks(scoped, [])[0]["state"] == "unknown"


def test_focusing_one_deliverable_does_not_drop_original_data_boundary():
    task = "我想做文档问答；同时写文章。资料不出境。"
    ctx = context(task)
    choice = clarification_for(ctx, "zh")
    assert choice.id == "task-focus"
    selected = ctx.model_copy(
        update={
            "intent_answers": [
                DecisionIntentAnswer(question_id=choice.id, option_id=choice.options[0].id)
            ]
        },
    )
    focused = analysis_context(selected)
    assert any(item.dimension == "cross-border" for item in context_requirements(focused))
