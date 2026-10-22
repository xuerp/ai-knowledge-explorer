"""Product ties retain useful task actions; synthetic QA, not product measurements."""

import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.decision_guidance import build_guidance
from app.decision_plan import PROTOCOLS, build_plan
from app.decision_resolution import reconcile_resolution
from app.decision_semantics import SourceItem, TaskMeaning, TaskMeaningReceipt, task_digest
from app.main import create_app
from app.schemas import DecisionContext

from .test_decision_input_preparation import MethodInterpreter
from .test_decision_plan import candidate, result


@pytest.mark.parametrize("scene", list(PROTOCOLS))
@pytest.mark.parametrize("language", ["zh", "en"])
@pytest.mark.parametrize("order", [("alpha", "beta"), ("beta", "alpha")])
def test_equal_qualified_options_keep_a_task_without_selecting_a_winner(scene, language, order):
    task = "完成本次指定材料的处理，保留原始范围"
    context = DecisionContext(
        task=task,
        # The generic-text API comparison is distinct from the intentionally
        # conditional novice-writing route for a finished chat product.
        task_type="model-api" if scene == "general-text" else "unspecified",
        priority="balanced",
        deployment="undecided",
        task_meaning=TaskMeaningReceipt(
            status="validated",
            meaning=TaskMeaning(
                version=1,
                source_sha256=task_digest(task),
                state="understood",
                scenario=scene,
                method=None,
                ambiguity=None,
                items=[SourceItem(quote=task, role="goal")],
            ),
        ),
    )
    decision = result(*(candidate(key) for key in order), scenario=scene, status="ready")
    snapshot = SimpleNamespace(
        entities=[
            SimpleNamespace(id=key, name=SimpleNamespace(zh=key, en=key), aliases=[])
            for key in order
        ]
    )
    decision.plan = build_plan(decision, context, language)
    decision.guidance = build_guidance(decision, context, snapshot, language)
    reconcile_resolution(decision, context, language)
    guidance = decision.guidance
    assert guidance.outcome == "advice"
    assert guidance.recommendation.primary_entity_id is None
    assert set(guidance.recommendation.entity_ids) == set(order)
    assert guidance.next_action.kind == "start"
    assert guidance.next_action.instruction == " ".join(decision.plan.trial.procedure)
    assert task in guidance.next_action.execution_prompt
    assert guidance.recommendation.tradeoff
    assert decision.plan.trial.executed is False


@pytest.mark.parametrize("language", ["zh", "en"])
def test_equal_options_task_survives_api_save_and_report(tmp_path, language):
    interpreter = MethodInterpreter()
    settings = Settings(
        database_url="sqlite:///" + (tmp_path / "equal-options.db").as_posix(),
        seed_snapshot_path=Path(__file__).parents[1] / "data/demo_snapshot.json",
        environment="test",
        admin_token=None,
        cors_origins=(),
        jwt_secret="equal-options-isolated-test-secret-at-least-32",
        rag_generation_enabled=False,
        embedding_provider="none",
    )
    cases = [
        (
            "coding-workspace",
            "在隔离仓库修复一个响应格式缺陷，先用两条合成输入复现，再做最小修改并运行已有测试，不升级依赖，不发布",
        ),
        ("general-text", "让AI用给定的一段合成文字生成简洁答复，不发布"),
    ]
    with TestClient(create_app(settings, task_interpreter=interpreter)) as client:
        auth = client.post(
            "/api/v2/auth/register",
            json={
                "email": "equal-options@example.com",
                "password": "isolated-options-test-password",
            },
        )
        assert auth.status_code == 201
        headers = {"Authorization": "Bearer " + auth.json()["accessToken"]}
        for route, task in cases:
            interpreter.route = route
            response = client.post(
                "/api/v2/research",
                headers=headers,
                json={
                    "question": task,
                    "language": language,
                    "decisionContext": {
                        "workflowVersion": 2,
                        "task": task,
                        "taskType": "model-api" if route == "general-text" else "unspecified",
                        "priority": "balanced",
                        "deployment": "undecided",
                    },
                },
            )
            assert response.status_code == 200, response.text
            value = response.json()
            guidance = value["decision"]["guidance"]
            assert len(guidance["recommendation"]["entityIds"]) >= 2
            assert guidance["recommendation"]["primaryEntityId"] is None
            assert guidance["nextAction"]["kind"] == "start"
            assert guidance["nextAction"]["instruction"] == " ".join(
                value["decision"]["plan"]["trial"]["procedure"]
            )
            prompt = guidance["nextAction"]["executionPrompt"]
            assert task in prompt and "不发布" in prompt
            if route == "coding-workspace":
                assert ("复现问题" if language == "zh" else "reproduce the issue") in prompt
                assert ("最小修改" if language == "zh" else "minimal changes") in prompt
                assert "已有测试" in prompt and "不升级依赖" in prompt
            reopened = client.get("/api/v2/research/" + value["id"], headers=headers)
            assert (
                reopened.status_code == 200 and reopened.json()["decision"]["guidance"] == guidance
            )
            report = client.get(
                "/api/v2/research/" + value["id"] + "/report?format=md&language=" + language,
                headers=headers,
            )
            assert report.status_code == 200
            assert re.sub(r"\s+", " ", prompt) in re.sub(r"\s+", " ", report.text)
    assert interpreter.calls == len(cases)
