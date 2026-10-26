"""Planning must prepare missing inputs without turning prerequisites into facts."""

import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


class MethodInterpreter:
    """Supplies only a method and the user's words, never reference artifacts."""

    def __init__(self):
        self.route = "classification"
        self.calls = 0

    def interpret(self, request):
        self.calls += 1
        return json.dumps(
            {
                "version": 2,
                "source_sha256": request["source_sha256"],
                "state": "understood",
                "route": self.route,
                "ambiguity": None,
                "items": [{"quote": request["task"], "role": "goal"}],
            },
            ensure_ascii=False,
        )


@pytest.mark.parametrize("language", ["zh", "en"])
def test_optional_references_are_prepared_not_assumed_in_api_and_exports(tmp_path, language):
    interpreter = MethodInterpreter()
    settings = Settings(
        database_url="sqlite:///" + (tmp_path / "inputs.db").as_posix(),
        seed_snapshot_path=Path(__file__).parents[1] / "data/demo_snapshot.json",
        admin_token=None,
        cors_origins=(),
        environment="test",
        jwt_secret="input-preparation-isolated-secret-at-least-32",
        rag_generation_enabled=False,
        embedding_provider="none",
    )
    # Independent minimal pairs: nothing here depends on held-out task wording,
    # particular category counts, a supplier, or a task keyword routing patch.
    cases = [
        ("classification", "给六条合成通知分流，没有人工参考答案"),
        ("classification", "给六条合成通知分流，已有人工参考答案"),
        ("translation", "把这段合成介绍译成德语，没有术语表"),
        ("translation", "把这段合成介绍译成德语，已有术语表"),
        ("query-analysis", "审查一条脱敏 SQL，只有表结构，没有执行计划"),
        ("query-analysis", "审查一条脱敏 SQL，已有表结构和执行计划"),
    ]
    with TestClient(create_app(settings, task_interpreter=interpreter)) as client:
        auth = client.post(
            "/api/v2/auth/register",
            json={"email": "inputs@example.com", "password": "isolated-input-test-password"},
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
                        "priority": "balanced",
                        "deployment": "undecided",
                    },
                },
            )
            assert response.status_code == 200, response.text
            result = response.json()
            assert result["decisionContext"]["task"] == task
            receipt = result["decisionContext"]["taskMeaning"]
            assert receipt["status"] == "validated"
            items = receipt["meaning"]["items"]
            assert {"quote": task, "role": "goal"} in items
            # The validator may additionally retain a negated user clause;
            # no preparation instruction may become a sourced input fact.
            assert all(item["quote"] in task for item in items)
            guidance = result["decision"]["guidance"]
            assert guidance["outcome"] == "conditional"
            assert guidance["clarification"] is None
            trial = result["decision"]["plan"]["trial"]
            assert trial["executed"] is False
            instruction = guidance["nextAction"]["instruction"]
            assert instruction == " ".join(trial["procedure"])
            # These are product promises: the first step can actually start
            # with either member of each availability pair, without inventing
            # the missing reference or requiring optional data collection.
            if route == "classification":
                if language == "zh":
                    assert "已有人工参考标签先核对" in trial["procedure"][0]
                    assert "没有则先由人工逐条建立" in trial["procedure"][0]
                    assert "未确认" in instruction and "未覆盖" in instruction
                    assert "使用原题指定的已标注样本" not in instruction
                else:
                    assert "Verify existing human reference labels" in trial["procedure"][0]
                    assert "establish them first" in trial["procedure"][0]
                    assert "Do not score unconfirmed references" in instruction
                    assert "uncovered" in instruction
            elif route == "translation":
                assert (
                    "不把术语表作为开始翻译的前提" if language == "zh" else "without a glossary"
                ) in instruction
                assert (
                    "不确定术语" if language == "zh" else "uncertain terminology"
                ) in instruction
            else:
                assert (
                    "没有也可先审查 SQL" if language == "zh" else "otherwise start with SQL review"
                ) in instruction
                assert (
                    "不要求运行 EXPLAIN" if language == "zh" else "without requiring EXPLAIN"
                ) in instruction
                assert (
                    "没有则不编造节点" if language == "zh" else "do not invent nodes"
                ) in instruction
            prompt = guidance["nextAction"]["executionPrompt"]
            assert task in prompt
            reopened = client.get("/api/v2/research/" + result["id"], headers=headers)
            assert reopened.status_code == 200
            assert reopened.json()["decision"]["guidance"] == guidance
            report = client.get(
                "/api/v2/research/" + result["id"] + "/report?format=md&language=" + language,
                headers=headers,
            )
            assert report.status_code == 200
            assert re.sub(r"\s+", " ", prompt) in re.sub(r"\s+", " ", report.text)
            assert "measurements" not in result
    assert interpreter.calls == len(cases)
