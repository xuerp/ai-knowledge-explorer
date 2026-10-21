"""Existing-tool identities require a local, positive user source statement."""

from types import SimpleNamespace

import pytest

from app.decision_tool_context import tool_context
from app.schemas import DecisionContext

ORBIT = SimpleNamespace(
    id="synthetic-orbit", name=SimpleNamespace(zh="星台", en="Orbit"), aliases=["OrbitDesk"]
)


@pytest.mark.parametrize(
    "task,named,reuse",
    [
        ("我们已经有 Orbit 平台，本轮验收权限", True, True),
        ("We currently use OrbitDesk; check access", True, True),
        ("目前只有 Orbit 平台，先检查权限", True, True),
        ("已有内部问答服务，Orbit 是另一个候选", False, True),
        ("已有三份 PDF，需要选择 Orbit 平台", False, False),
        ("已有资料介绍 Orbit", False, False),
        ("我没有 Orbit 平台", False, False),
        ("目前考虑 Orbit 平台", False, False),
        ("如果已经有 Orbit 平台，就检查权限", False, False),
        ("是否已有 Orbit 平台", False, False),
        ("已经有 Orbit 平台吗", False, False),
        ("We currently use Orbit?", False, False),
        ("Do we already have Orbit?", False, False),
        ("我们已有 Orbit？", False, False),
        ("公司已有自建问答服务，别替我更换平台", False, True),
        ("已有内部问答服务，希望选择 Orbit 平台", False, False),
        ("已有 Orbit 平台，希望推荐另一平台", True, False),
    ],
)
def test_ownership_and_selection_minimal_pairs(task, named, reuse):
    context = DecisionContext(task=task, priority="balanced", deployment="undecided")
    result = tool_context(context, [ORBIT])
    assert (ORBIT.id in result.entity_ids) is named
    assert result.reuse is reuse
    assert all(quote in task for quote in result.references)


def test_alias_prefix_does_not_bind_a_different_product():
    context = DecisionContext(
        task="已经有 OrbitDeskPlus 平台，检查权限", priority="balanced", deployment="undecided"
    )
    result = tool_context(context, [ORBIT])
    assert result.reuse and not result.entity_ids


@pytest.mark.parametrize(
    "statement,reuse",
    [
        ("我们搭好了 Orbit 入口", True),
        ("如果搭好了 Orbit 入口", False),
        ("目前考虑 Orbit 入口", False),
        ("已有三份 PDF", False),
    ],
)
def test_semantic_existing_tool_role_is_conditional_without_a_proven_identity(statement, reuse):
    from app.decision_semantics import SourceItem, TaskMeaning, TaskMeaningReceipt, task_digest

    context = DecisionContext(
        task=statement,
        priority="balanced",
        deployment="undecided",
        task_meaning=TaskMeaningReceipt(
            status="validated",
            meaning=TaskMeaning(
                version=1,
                source_sha256=task_digest(statement),
                state="understood",
                scenario="knowledge-workspace",
                method=None,
                ambiguity=None,
                items=[SourceItem(quote=statement, role="existing-tool")],
            ),
        ),
    )
    result = tool_context(context, [ORBIT])
    assert result.reuse is reuse
    assert not result.entity_ids
    assert bool(result.interpreted_references) is reuse


def test_existing_service_trial_does_not_require_any_catalog_candidate():
    from datetime import UTC, datetime

    from app.decision_guidance import build_guidance
    from app.decision_plan import build_plan
    from app.decision_resolution import reconcile_resolution
    from app.schemas import (
        DecisionRecommendation,
        DecisionResult,
        DecisionScenario,
    )

    context = DecisionContext(
        task="已有内部问答服务，本轮验收权限与版本，不能外传资料",
        task_type="knowledge-product",
        priority="balanced",
        deployment="undecided",
    )
    snapshot = SimpleNamespace(entities=[])
    decision = DecisionResult(
        scenario=DecisionScenario(id="knowledge-workspace", name="问答服务"),
        status="insufficient-evidence",
        as_of=datetime.now(UTC),
        recommendation=DecisionRecommendation(summary="No catalog evidence"),
    )
    decision.plan = build_plan(decision, context, "zh", snapshot)
    assert decision.plan.trial and decision.plan.trial.executed is False
    decision.guidance = build_guidance(decision, context, snapshot, "zh")
    result = reconcile_resolution(decision, context, "zh")
    assert result.guidance.outcome == "conditional"
    assert result.guidance.recommendation.primary_entity_id is None
    assert result.guidance.next_action.target_ids == []
    assert result.plan.trial_candidate_ids == []
    assert "无答案" in result.guidance.next_action.execution_prompt
    assert "不能外传资料" in result.guidance.next_action.instruction
    assert not result.recommendation.primary_entity_id
    assert result.recommendation.reasons == result.guidance.recommendation.reasons


@pytest.mark.parametrize("language", ["zh", "en"])
def test_existing_service_identity_and_scope_survive_api_save_and_export(tmp_path, language):
    import json
    import re
    from pathlib import Path

    from fastapi.testclient import TestClient

    from app.config import Settings
    from app.main import create_app

    from .test_decision_input_preparation import MethodInterpreter

    interpreter = MethodInterpreter()
    interpreter.route = "knowledge-workspace"
    settings = Settings(
        database_url="sqlite:///" + (tmp_path / "identity-api.db").as_posix(),
        seed_snapshot_path=Path(__file__).parents[1] / "data/demo_snapshot.json",
        environment="test",
        admin_token=None,
        cors_origins=(),
        jwt_secret="tool-context-isolated-test-secret-at-least-32",
        rag_generation_enabled=False,
        embedding_provider="none",
    )
    with TestClient(create_app(settings, task_interpreter=interpreter)) as client:
        auth = client.post(
            "/api/v2/auth/register",
            json={"email": "identity@example.com", "password": "isolated-identity-test-password"},
        )
        assert auth.status_code == 201
        headers = {"Authorization": "Bearer " + auth.json()["accessToken"]}
        for tool in ["内部知识库问答服务", "Orbit 制度问答服务", "Dify 知识库"]:
            task = f"我们已有{tool}，验收制度问答的权限与版本。仅用两种身份和五份合成制度，其中一份归档；无依据说不知道；不请求生产登录。"
            response = client.post(
                "/api/v2/research",
                headers=headers,
                json={
                    "question": task,
                    "language": language,
                    "decisionContext": {
                        "workflowVersion": 2,
                        "task": task,
                        "priority": "balanced",
                        "deployment": "undecided",
                    },
                },
            )
            assert response.status_code == 200, response.text
            result = response.json()
            guidance = result["decision"]["guidance"]
            assert guidance["outcome"] == "conditional"
            assert guidance["clarification"] is None
            assert any(
                tool in item["value"]
                for item in guidance["intent"]
                if item["field"] == "existing-tool"
            )
            if "Dify" not in task:
                assert guidance["recommendation"]["primaryEntityId"] is None
                assert guidance["nextAction"]["targetIds"] == []
                assert "Dify" not in json.dumps(guidance, ensure_ascii=False)
                assert not result["decision"]["recommendation"]["primaryEntityId"]
                assert (
                    result["decision"]["recommendation"]["reasons"]
                    == guidance["recommendation"]["reasons"]
                )
            instruction = guidance["nextAction"]["instruction"]
            assert instruction == " ".join(result["decision"]["plan"]["trial"]["procedure"])
            assert "不请求生产登录" in instruction
            for word in (
                ["允许访问", "禁止访问", "无答案", "不知道", "生效版本"]
                if language == "zh"
                else ["allowed", "denied", "unanswerable", "uncertainty", "effective versions"]
            ):
                assert word in instruction
            prompt = guidance["nextAction"]["executionPrompt"]
            assert task in prompt
            assert result["decision"]["plan"]["trial"]["executed"] is False
            reopened = client.get("/api/v2/research/" + result["id"], headers=headers)
            assert reopened.status_code == 200
            assert reopened.json()["decision"]["guidance"] == guidance
            report = client.get(
                "/api/v2/research/" + result["id"] + "/report?format=md&language=" + language,
                headers=headers,
            )
            assert report.status_code == 200
            assert re.sub(r"\s+", " ", prompt) in re.sub(r"\s+", " ", report.text)
    assert interpreter.calls == 3
