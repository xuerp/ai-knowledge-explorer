"""End-to-end local API contracts with fake interpretation, no supplier calls."""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.decision_semantics import task_digest
from app.main import create_app

TASK = "把法文保修卡转为中文，型号原样保留，也不要写代码"


class FakeInterpreter:
    def __init__(self):
        self.calls = 0

    def interpret(self, request):
        self.calls += 1
        clarified = "semantic-choice:" in request["task"]
        return json.dumps(
            {
                "version": 1,
                "source_sha256": task_digest(request["task"]),
                "state": "understood" if clarified else "ambiguous",
                "scenario": "general-text" if clarified else None,
                "method": "translation" if clarified else None,
                "ambiguity": None if clarified else "译给客户还是技术人员阅读？",
                "items": [
                    {"quote": "把法文保修卡转为中文", "role": "goal"},
                    {"quote": "法文保修卡", "role": "material"},
                    {"quote": "型号原样保留", "role": "condition"},
                    {"quote": "也不要写代码", "role": "prohibition"},
                ],
            },
            ensure_ascii=False,
        )


def test_interpretation_runs_in_real_api_and_revision_retry_does_not_call_again(tmp_path):
    interpreter = FakeInterpreter()
    settings = Settings(
        database_url="sqlite:///" + (tmp_path / "semantic-api.db").as_posix(),
        seed_snapshot_path=Path(__file__).parents[1] / "data/demo_snapshot.json",
        admin_token=None,
        cors_origins=(),
        environment="test",
        jwt_secret="semantic-api-isolated-secret-at-least-32",
        rag_generation_enabled=False,
        embedding_provider="none",
    )
    with TestClient(create_app(settings, task_interpreter=interpreter)) as client:
        login = client.post(
            "/api/v2/auth/register",
            json={
                "email": "semantic-api@example.com",
                "password": "isolated semantic test password",
            },
        )
        assert login.status_code == 201
        headers = {"Authorization": "Bearer " + login.json()["accessToken"]}
        created = client.post(
            "/api/v2/research",
            headers=headers,
            json={
                "question": TASK,
                "decisionContext": {
                    "workflowVersion": 2,
                    "task": TASK,
                    "priority": "balanced",
                    "deployment": "undecided",
                    "taskMeaning": {"status": "unavailable"},
                },
            },
        )
        assert created.status_code == 200, created.text
        original = created.json()
        assert original["decisionContext"]["taskMeaning"]["status"] == "validated"
        assert original["decision"]["guidance"]["clarification"]["id"] == "semantic-choice"
        payload = {
            "question": TASK,
            "parentResearchId": original["id"],
            "clarificationAnswer": {"questionId": "semantic-choice", "text": "译给客户看"},
        }
        revised = client.post("/api/v2/research", headers=headers, json=payload)
        assert revised.status_code == 200, revised.text
        result = revised.json()
        assert result["decision"]["scenario"]["id"] == "general-text"
        assert result["decision"]["guidance"]["clarification"] is None
        assert result["decision"]["guidance"]["nextAction"]["instruction"] == " ".join(
            result["decision"]["plan"]["trial"]["procedure"]
        )
        repeated = client.post("/api/v2/research", headers=headers, json=payload)
        assert repeated.status_code == 200
        assert repeated.json()["id"] == result["id"]
        assert interpreter.calls == 2
        saved = client.get("/api/v2/research/" + result["id"], headers=headers)
        assert saved.status_code == 200
        assert (
            saved.json()["decisionContext"]["taskMeaning"]
            == result["decisionContext"]["taskMeaning"]
        )
        assert saved.json()["decision"]["guidance"] == result["decision"]["guidance"]


def test_source_comparison_is_a_semantic_route_without_keyword_fallback(tmp_path):
    from app.decision_intent import task_workflow

    task = "并列两份手册的参数与原句，版本未知时留空，不要替工程师决定正确值"
    assert task_workflow(task) is None

    class CompareInterpreter:
        def interpret(self, request):
            return json.dumps(
                {
                    "version": 2,
                    "source_sha256": request["source_sha256"],
                    "state": "understood",
                    "route": "source-comparison",
                    "ambiguity": None,
                    "items": [{"quote": "并列两份手册的参数与原句", "role": "goal"}],
                },
                ensure_ascii=False,
            )

    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'compare.db'}",
        seed_snapshot_path=Path(__file__).resolve().parents[1] / "data/demo_snapshot.json",
        admin_token=None,
        cors_origins=(),
        environment="test",
        jwt_secret="comparison-isolated-secret-at-least-32",
        rag_generation_enabled=False,
        embedding_provider="none",
    )
    with TestClient(create_app(settings, task_interpreter=CompareInterpreter())) as client:
        auth = client.post(
            "/api/v2/auth/register",
            json={
                "email": "comparison@example.com",
                "password": "comparison test-only password",
            },
        )
        headers = {"Authorization": "Bearer " + auth.json()["accessToken"]}
        result = client.post(
            "/api/v2/research",
            headers=headers,
            json={
                "question": task,
                "language": "zh",
                "decisionContext": {
                    "workflowVersion": 2,
                    "task": task,
                    "priority": "balanced",
                    "deployment": "undecided",
                },
            },
        ).json()
        guidance = result["decision"]["guidance"]
        assert guidance["outcome"] == "conditional"
        assert "资料对照" in guidance["recommendation"]["headline"]
        prompt = guidance["nextAction"]["executionPrompt"]
        assert all(
            value in prompt
            for value in ["不从文件顺序猜新旧", "保留相互冲突的值", "不要替工程师决定正确值"]
        )
        assert result["decision"]["plan"]["trialCandidateIds"] == []
        reopened = client.get("/api/v2/research/" + result["id"], headers=headers).json()
        assert reopened["decision"]["guidance"] == guidance


def test_unverified_deadline_does_not_reach_saved_steps_or_report(tmp_path):
    import re

    task = "核对一张合成库存表；马上开始；不连接业务系统"

    class IncorrectTimeRole:
        def interpret(self, request):
            return json.dumps(
                {
                    "version": 2,
                    "source_sha256": request["source_sha256"],
                    "state": "understood",
                    "route": "table-normalization",
                    "ambiguity": None,
                    "items": [
                        {"quote": "核对一张合成库存表", "role": "goal"},
                        {"quote": "马上开始", "role": "deadline"},
                    ],
                },
                ensure_ascii=False,
            )

    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'time-api.db').as_posix()}",
        seed_snapshot_path=Path(__file__).parents[1] / "data/demo_snapshot.json",
        admin_token=None,
        cors_origins=(),
        environment="test",
        jwt_secret="time-api-isolated-secret-at-least-32",
        rag_generation_enabled=False,
        embedding_provider="none",
    )
    with TestClient(create_app(settings, task_interpreter=IncorrectTimeRole())) as client:
        auth = client.post(
            "/api/v2/auth/register",
            json={"email": "time-api@example.com", "password": "time-api-test-only-password"},
        )
        auth.raise_for_status()
        headers = {"Authorization": "Bearer " + auth.json()["accessToken"]}
        response = client.post(
            "/api/v2/research",
            headers=headers,
            json={
                "question": task,
                "language": "zh",
                "decisionContext": {
                    "workflowVersion": 2,
                    "task": task,
                    "priority": "balanced",
                    "deployment": "undecided",
                },
            },
        )
        response.raise_for_status()
        result = response.json()
        assert result["decisionContext"]["taskMeaning"]["status"] == "validated"
        assert (
            "unverified-deadline-role" in result["decisionContext"]["taskMeaning"]["normalizations"]
        )
        guidance = result["decision"]["guidance"]
        assert guidance["outcome"] == "conditional"
        assert not any(item["field"] == "time-limit" for item in guidance["intent"])
        instruction = guidance["nextAction"]["instruction"]
        assert "到 马上开始 停止" not in instruction and "不连接业务系统" in instruction
        assert instruction == " ".join(result["decision"]["plan"]["trial"]["procedure"])
        prompt = guidance["nextAction"]["executionPrompt"]
        assert task in prompt and "到 马上开始 停止" not in prompt
        reopened = client.get("/api/v2/research/" + result["id"], headers=headers)
        reopened.raise_for_status()
        assert reopened.json()["decision"]["guidance"] == guidance
        md = client.get(
            "/api/v2/research/" + result["id"] + "/report?format=md&language=zh", headers=headers
        )
        md.raise_for_status()
        assert re.sub(r"\s+", " ", prompt) in re.sub(r"\s+", " ", md.text)
