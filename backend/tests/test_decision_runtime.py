"""Configured app path and durable cost controls; all transport is synthetic."""

import json
import os
from dataclasses import replace
from pathlib import Path
from threading import Event, Thread
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.config import Settings
from app.database import AuditLogRecord, Database
from app.database import DecisionInterpretationBudgetRecord as Budget
from app.decision_runtime import BudgetedTaskInterpreter, configured_task_interpreter
from app.decision_semantics import TaskMeaningService
from app.main import create_app

TASK = "把各供应商的单价统一成每支人民币，使用我填写的汇率，缺包装数量先标待核实。"
SEED = Path(__file__).parents[1] / "data/demo_snapshot.json"


class Adapter:
    endpoint = "https://fixture.invalid/chat/completions"
    model = "fixture-parser"

    def __init__(self, output="valid", wait=None):
        self.calls = 0
        self.output = output
        self.wait = wait
        self.last_exchange = {}

    def interpret(self, request):
        self.calls += 1
        if self.wait:
            self.wait[0].set()
            assert self.wait[1].wait(5)
        if self.output == "timeout":
            self.last_exchange = {"errorType": "ReadTimeout"}
            raise httpx.ReadTimeout("private supplier message must not be stored")
        self.last_exchange = {
            "returnedModel": self.model,
            "totalTokens": 250,
            "promptTokens": 200,
            "completionTokens": 50,
            "finishReason": "stop",
        }
        if self.output == "invalid":
            return "{}"
        return json.dumps(
            {
                "version": 2,
                "source_sha256": request["source_sha256"],
                "state": "understood",
                "route": "table-normalization",
                "items": [{"role": "goal", "quote": request["task"]}],
                "ambiguity": None,
            }
        )


def make_runtime(tmp_path, adapter, limit=2, database=None):
    database = database or Database(f"sqlite:///{(tmp_path / 'budget.db').as_posix()}")
    database.create_all()
    return BudgetedTaskInterpreter(
        database, adapter, budget_id="approved-test", max_calls=limit, user_ids=("owner",)
    )


def settings(tmp_path, **values):
    return Settings(
        database_url=f"sqlite:///{(tmp_path / 'api.db').as_posix()}",
        seed_snapshot_path=SEED,
        admin_token="test-admin",
        cors_origins=(),
        environment="test",
        jwt_secret="runtime-test-signing-secret-32-characters",
        **values,
    )


def test_default_does_not_reuse_extraction_connection(tmp_path):
    config = settings(
        tmp_path,
        extraction_api_url="https://fixture.invalid/chat",
        extraction_api_key="existing-secret",
        extraction_model="fixture-parser",
    )
    assert configured_task_interpreter(config, Database(config.database_url)) is None
    with pytest.raises(ValueError, match="explicit connection"):
        replace(config, decision_interpretation_enabled=True)


def test_explicit_environment_profile_and_secret_repr(monkeypatch):
    values = {
        "ENABLED": "true",
        "API_URL": "https://fixture.invalid/chat/completions",
        "API_KEY": "fixture-secret-do-not-log",
        "MODEL": "fixture-parser",
        "BUDGET_ID": "one-time-approval",
        "MAX_CALLS": "3",
        "USER_IDS": "owner",
    }
    for name, value in values.items():
        monkeypatch.setenv("AI_RADAR_DECISION_INTERPRETATION_" + name, value)
    config = Settings.from_env()
    assert config.decision_interpretation_enabled and config.decision_interpretation_max_calls == 3
    assert config.decision_interpretation_user_ids == ("owner",)
    assert values["API_KEY"] not in repr(config)


def test_budget_survives_new_process_instance_and_rejects_profile_increase(tmp_path):
    first = make_runtime(tmp_path, Adapter())
    assert TaskMeaningService(first).understand(TASK, owner_id="other").status == "unavailable"
    assert first.adapter.calls == 0
    assert TaskMeaningService(first).understand(TASK, owner_id="owner").status == "validated"
    first.database.dispose()
    second = make_runtime(tmp_path, Adapter())
    assert TaskMeaningService(second).understand(TASK, owner_id="owner").status == "validated"
    assert TaskMeaningService(second).understand(TASK, owner_id="owner").status == "failed"
    assert second.adapter.calls == 1 and second.diagnostics()["usedCalls"] == 2
    raised = make_runtime(tmp_path, Adapter(), limit=3)
    assert TaskMeaningService(raised).understand(TASK, owner_id="owner").status == "failed"
    assert raised.adapter.calls == 0 and not raised.diagnostics()["profileMatches"]


@pytest.mark.parametrize("output,receipt", [("invalid", "invalid"), ("timeout", "failed")])
def test_errors_close_persistent_budget_and_keep_redacted_receipt(tmp_path, output, receipt):
    runtime = make_runtime(tmp_path, Adapter(output))
    assert TaskMeaningService(runtime).understand(TASK, owner_id="owner").status == receipt
    replacement = make_runtime(tmp_path, Adapter())
    assert TaskMeaningService(replacement).understand(TASK, owner_id="owner").status == "failed"
    assert replacement.adapter.calls == 0 and replacement.diagnostics()["blocked"]
    with replacement.database.session() as session:
        row = session.scalar(select(AuditLogRecord))
        detail = json.loads(row.detail_json)
        assert detail["status"] == receipt and detail["usageUnknown"] == (output == "timeout")
        assert TASK not in row.detail_json and "private supplier" not in row.detail_json
        assert runtime.adapter.endpoint not in row.detail_json


def test_concurrent_calls_and_interrupted_reservation_do_not_duplicate_spending(tmp_path):
    entered, release = Event(), Event()
    first = make_runtime(tmp_path, Adapter(wait=(entered, release)))
    second = make_runtime(tmp_path, Adapter())
    results = []
    thread = Thread(
        target=lambda: results.append(TaskMeaningService(first).understand(TASK, owner_id="owner"))
    )
    thread.start()
    assert entered.wait(5)
    try:
        assert TaskMeaningService(second).understand(TASK, owner_id="owner").status == "failed"
        assert second.adapter.calls == 0
    finally:
        release.set()
        thread.join(5)
    assert len(results) == 1 and results[0].status == "validated"
    assert first.diagnostics()["usedCalls"] == 1
    first._reserve(TASK)
    restarted = make_runtime(tmp_path, Adapter())
    assert restarted.diagnostics()["inFlightOrInterrupted"]
    assert TaskMeaningService(restarted).understand(TASK, owner_id="owner").status == "failed"
    assert restarted.adapter.calls == 0


def test_oversized_input_has_no_reservation_or_transport_call(tmp_path):
    runtime = make_runtime(tmp_path, Adapter())
    assert (
        TaskMeaningService(runtime).understand("很长的业务材料" * 2000, owner_id="owner").status
        == "failed"
    )
    assert runtime.adapter.calls == 0 and runtime.diagnostics()["usedCalls"] == 0


def test_real_configured_app_path_uses_budget_without_interpreter_injection(tmp_path, monkeypatch):
    import app.decision_runtime as module
    from app.decision_semantic_transport import ChatTaskInterpreter

    requests = []

    def handler(request):
        body = json.loads(request.content)
        payload = json.loads(body["messages"][1]["content"])
        assert body["max_completion_tokens"] == 4096
        assert "owner" not in payload and "user_id" not in payload
        requests.append(body)
        content = Adapter().interpret(payload)
        return httpx.Response(
            200,
            json={
                "model": "fixture-parser",
                "usage": {"total_tokens": 250, "prompt_tokens": 200, "completion_tokens": 50},
                "choices": [{"finish_reason": "stop", "message": {"content": content}}],
            },
        )

    monkeypatch.setattr(
        module,
        "ChatTaskInterpreter",
        lambda **kwargs: ChatTaskInterpreter(**kwargs, transport=httpx.MockTransport(handler)),
    )
    config = settings(tmp_path)
    with TestClient(create_app(config)) as client:
        signup = client.post(
            "/api/v2/auth/register",
            json={"email": "runtime@example.com", "password": "isolated-runtime-password"},
        )
        signup.raise_for_status()
        user = signup.json()["user"]["id"]
        token = signup.json()["accessToken"]
        other = client.post(
            "/api/v2/auth/register",
            json={"email": "unapproved@example.com", "password": "isolated-unapproved-password"},
        )
        other.raise_for_status()
        other_token = other.json()["accessToken"]
    config = replace(
        config,
        decision_interpretation_enabled=True,
        decision_interpretation_api_url="https://fixture.invalid/chat/completions",
        decision_interpretation_api_key="test-secret",
        decision_interpretation_model="fixture-parser",
        decision_interpretation_budget_id="explicit-api-test",
        decision_interpretation_max_calls=1,
        decision_interpretation_user_ids=(user,),
    )
    with TestClient(create_app(config)) as client:
        body = {
            "question": TASK,
            "language": "zh",
            "decisionContext": {
                "workflowVersion": 2,
                "task": TASK,
                "priority": "balanced",
                "deployment": "undecided",
            },
        }
        unapproved = client.post(
            "/api/v2/research", headers={"Authorization": "Bearer " + other_token}, json=body
        )
        assert unapproved.status_code == 200
        assert unapproved.json()["decisionContext"]["taskMeaning"]["status"] == "unavailable"
        assert requests == []
        assert client.get("/api/v2/decision-interpretation").status_code == 401
        assert client.get(
            "/api/v2/decision-interpretation", headers={"Authorization": "Bearer " + other_token}
        ).json() == {"enabled": False}
        response = client.post(
            "/api/v2/research", headers={"Authorization": "Bearer " + token}, json=body
        )
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["decisionContext"]["taskMeaning"]["status"] == "validated"
        assert result["decision"]["guidance"]["outcome"] == "conditional"
        assert client.get("/api/v2/admin/decision-interpretation").status_code == 401
        diagnostics = client.get(
            "/api/v2/admin/decision-interpretation", headers={"X-Admin-Token": "test-admin"}
        )
        assert diagnostics.status_code == 200 and diagnostics.json()["usedCalls"] == 1
        assert diagnostics.headers["cache-control"] == "no-store"
        own = client.get(
            "/api/v2/decision-interpretation", headers={"Authorization": "Bearer " + token}
        )
        assert own.json()["remainingCalls"] == 0 and "budgetId" not in own.json()
        assert own.headers["cache-control"] == "no-store"
        assert len(requests) == 1


def test_migration_downgrade_preserves_spent_budget(tmp_path, monkeypatch):
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import text

    database_path = tmp_path / "migration.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    monkeypatch.setenv("AI_RADAR_DATABASE_URL", database_url)
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    config.set_main_option("script_location", str(Path(__file__).parents[1] / "migrations"))
    command.upgrade(config, "head")
    database = Database(database_url)
    runtime = make_runtime(tmp_path, Adapter(), database=database)
    assert TaskMeaningService(runtime).understand(TASK, owner_id="owner").status == "validated"
    with pytest.raises(RuntimeError, match="must be preserved"):
        command.downgrade(config, "20261015_0027")
    with database.session() as session:
        assert session.get(Budget, "approved-test").used_calls == 1
        assert session.scalar(text("SELECT version_num FROM alembic_version")) == "20261021_0028"
    database.dispose()


def test_postgres_reservation_is_atomic_across_independent_connections():
    url = os.getenv("AI_RADAR_RUNTIME_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Dedicated PostgreSQL runtime test database is not configured.")
    database = Database(url)
    other_database = Database(url)
    budget_id = "qa-" + uuid4().hex
    entered, release = Event(), Event()
    first = BudgetedTaskInterpreter(
        database,
        Adapter(wait=(entered, release)),
        budget_id=budget_id,
        max_calls=1,
        user_ids=("owner",),
    )
    second = BudgetedTaskInterpreter(
        other_database, Adapter(), budget_id=budget_id, max_calls=1, user_ids=("owner",)
    )
    results = []
    thread = Thread(
        target=lambda: results.append(TaskMeaningService(first).understand(TASK, owner_id="owner"))
    )
    thread.start()
    try:
        assert entered.wait(5)
        assert TaskMeaningService(second).understand(TASK, owner_id="owner").status == "failed"
        assert second.adapter.calls == 0
        release.set()
        thread.join(5)
        assert len(results) == 1 and results[0].status == "validated"
        assert second.diagnostics()["usedCalls"] == 1
    finally:
        release.set()
        thread.join(5)
        with database.session() as session:
            session.execute(
                delete(AuditLogRecord).where(
                    AuditLogRecord.action == "decision.interpret",
                    AuditLogRecord.detail_json.contains(budget_id),
                )
            )
            session.execute(delete(Budget).where(Budget.id == budget_id))
            session.commit()
        database.dispose()
        other_database.dispose()
