"""Plans and exports must not expand a user's permitted inputs or operations."""

import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

from .test_decision_input_preparation import MethodInterpreter


@pytest.mark.parametrize("language", ["zh", "en"])
def test_operation_and_sample_scope_survive_api_save_and_report(tmp_path, language):
    interpreter = MethodInterpreter()
    settings = Settings(
        database_url="sqlite:///" + (tmp_path / "operation-scope.db").as_posix(),
        seed_snapshot_path=Path(__file__).parents[1] / "data/demo_snapshot.json",
        environment="test",
        admin_token=None,
        cors_origins=(),
        jwt_secret="operation-scope-isolated-test-secret-at-least-32",
        rag_generation_enabled=False,
        embedding_provider="none",
    )
    cases = [
        (
            "coding-workspace",
            "我们已有 Claude Code，只审查获准的合成函数，指出错误位置与依据，不修改文件，不运行命令",
        ),
        (
            "coding-workspace",
            "我们已有 Claude Code，在隔离副本修复一个合成函数的边界错误，允许运行附带测试，不新增功能",
        ),
        ("general-text", "仅用三条合成通知改写成简短介绍，不使用真实人员资料"),
    ]
    with TestClient(create_app(settings, task_interpreter=interpreter)) as client:
        auth = client.post(
            "/api/v2/auth/register",
            json={
                "email": "operations@example.com",
                "password": "isolated-operation-test-password",
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
                        "taskType": "coding-product"
                        if route == "coding-workspace"
                        else "unspecified",
                        "priority": "balanced",
                        "deployment": "undecided",
                    },
                },
            )
            assert response.status_code == 200, response.text
            result = response.json()
            assert result["decisionContext"]["taskMeaning"]["status"] == "validated"
            trial = result["decision"]["plan"]["trial"]
            assert trial and trial["executed"] is False
            protocol = "\n".join([trial["sample"], *trial["procedure"], *trial["acceptance"]])
            assert task in protocol
            if route == "coding-workspace":
                assert (
                    "仅在原题明确允许时"
                    if language == "zh"
                    else "only when explicitly allowed by the task"
                ) in protocol
                assert (
                    "只读审查不要求生成补丁"
                    if language == "zh"
                    else "Read-only reviews do not require a patch"
                ) in protocol
                assert "先复现问题并确认修改方案，再进行最小改动" not in protocol
                assert (
                    "reproduce the issue and confirm the plan before a minimal change"
                    not in protocol
                )
                guidance = result["decision"]["guidance"]
                assert guidance["recommendation"]["primaryEntityId"] == "e-claude-code"
                assert guidance["nextAction"]["instruction"] == " ".join(trial["procedure"])
                assert task in guidance["nextAction"]["executionPrompt"]
            else:
                assert (
                    "可用真实或合成" not in protocol
                    and "using real or synthetic samples" not in protocol
                )
                assert (
                    "仅使用原题允许"
                    if language == "zh"
                    else "Use only materials and sample types permitted by the task"
                ) in protocol
            reopened = client.get("/api/v2/research/" + result["id"], headers=headers)
            assert reopened.status_code == 200
            assert reopened.json()["decision"]["plan"]["trial"] == trial
            report = client.get(
                "/api/v2/research/" + result["id"] + "/report?format=md&language=" + language,
                headers=headers,
            )
            assert report.status_code == 200
            normalized = re.sub(r"\s+", " ", report.text)
            assert task in normalized
            if route == "coding-workspace":
                for step in trial["procedure"]:
                    assert re.sub(r"\s+", " ", step) in normalized
    assert interpreter.calls == len(cases)
