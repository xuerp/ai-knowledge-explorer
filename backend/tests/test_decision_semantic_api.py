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
