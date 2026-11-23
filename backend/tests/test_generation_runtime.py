import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import select

from app.database import Database, ModelBudgetRecord, ModelCallRecord
from app.decision_semantics import TaskMeaningService
from app.generation_runtime import (
    BudgetedAnswerGenerator,
    BudgetedMeaningInterpreter,
    GenerationConfig,
)
from app.model_budget import ModelBudget
from tests.test_answer_generation import grounded_citations, valid_payload
from tests.test_decision_runtime import TASK, Adapter


@pytest.fixture
def setup(tmp_path):
    database = Database(f"sqlite:///{tmp_path.as_posix()}/budget.db")
    database.create_all()
    config = GenerationConfig(
        endpoint="https://provider.example/v1/chat/completions",
        api_key="secret-not-for-ledger",
        model="approved-test-model",
        budget_id="test-budget",
        month=datetime.now(UTC).strftime("%Y-%m"),
        currency="CNY",
        limit_units=1_000_000,
        input_rate=1_000_000,
        output_rate=2_000_000,
        max_calls=5,
        user_daily_calls=2,
        user_ids=("test-owner",),
    )
    yield database, config
    database.dispose()


def test_atomic_reservation_across_instances_and_process_restart(setup):
    database, cfg = setup

    def reserve(_):
        try:
            return ModelBudget(database, cfg).reserve("test-owner", "answer", 100, 200)
        except ValueError:
            return None

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(reserve, range(6)))
    assert len([item for item in results if item]) == 1
    with pytest.raises(ValueError):
        ModelBudget(database, cfg).reserve("test-owner", "answer", 100, 200)
    with database.session() as session:
        row = session.get(ModelBudgetRecord, cfg.budget_id)
        assert row.used_calls == 1 and row.charged_units == 500


def test_unknown_receipt_retains_money_and_closes_budget(setup):
    database, cfg = setup
    budget = ModelBudget(database, cfg)
    attempt = budget.reserve("test-owner", "answer", 100, 200)
    with pytest.raises(ValueError):
        budget.finish(attempt, {}, validated=False, input_bound=100, output_bound=200)
    with database.session() as session:
        assert session.get(ModelBudgetRecord, cfg.budget_id).charged_units == 500
        assert session.get(ModelCallRecord, attempt).state == "usage-unknown"
    with pytest.raises(ValueError):
        ModelBudget(database, cfg).reserve("test-owner", "answer", 100, 200)


def test_receipt_settles_once_and_daily_cap_cannot_be_bypassed(setup):
    database, cfg = setup
    budget = ModelBudget(database, cfg)
    receipt = {
        "promptTokens": 20,
        "completionTokens": 10,
        "totalTokens": 30,
        "returnedModel": cfg.model,
    }
    for _ in range(2):
        attempt = budget.reserve("test-owner", "answer", 100, 200)
        budget.finish(attempt, receipt, validated=True, input_bound=100, output_bound=200)
    with pytest.raises(ValueError):
        budget.finish(attempt, receipt, validated=True, input_bound=100, output_bound=200)
    with pytest.raises(ValueError):
        budget.reserve("test-owner", "answer", 100, 200)
    with database.session() as session:
        row = session.get(ModelBudgetRecord, cfg.budget_id)
        assert row.charged_units == 80 and row.used_calls == 2 and row.active_attempt_id is None


def test_scope_tariff_and_amount_are_enforced_before_transport(setup):
    database, cfg = setup
    budget = ModelBudget(database, cfg)
    with pytest.raises(ValueError):
        budget.reserve("other-owner", "answer", 10, 20)
    with pytest.raises(ValueError):
        budget.reserve("test-owner", "answer", 2_000_000, 20)
    attempt = budget.reserve("test-owner", "answer", 10, 20)
    budget.finish(
        attempt,
        {"promptTokens": 1, "completionTokens": 1, "totalTokens": 2, "returnedModel": cfg.model},
        validated=True,
        input_bound=10,
        output_bound=20,
    )
    with pytest.raises(ValueError):
        ModelBudget(database, replace(cfg, input_rate=1)).reserve("test-owner", "answer", 10, 20)


def test_spend_cap_preserves_existing_usage_and_refuses_unapproved_amount(setup, monkeypatch):
    database, cfg = setup
    receipt = {
        "promptTokens": 200,
        "completionTokens": 400,
        "totalTokens": 600,
        "returnedModel": cfg.model,
    }
    budget = ModelBudget(database, cfg)
    attempt = budget.reserve("test-owner", "answer", 200, 400)
    budget.finish(attempt, receipt, validated=True, input_bound=200, output_bound=400)
    monkeypatch.setenv("AI_RADAR_ANSWER_SPEND_CAP", "0.0012")
    capped = replace(cfg, spend_cap_units=GenerationConfig.spend_cap_from_env())
    with pytest.raises(ValueError):
        ModelBudget(database, capped).reserve("test-owner", "answer", 200, 400)
    with pytest.raises(ValueError):
        replace(cfg, spend_cap_units=1_000_001)
    monkeypatch.setenv("AI_RADAR_ANSWER_SPEND_CAP", "0")
    paused = replace(cfg, spend_cap_units=GenerationConfig.spend_cap_from_env())
    status = BudgetedMeaningInterpreter(database, paused).diagnostics()
    assert status["blocked"] and status["limitUnits"] == 0 and status["chargedUnits"] == 1_000
    raised = replace(capped, spend_cap_units=2_000)
    ModelBudget(database, raised).reserve("test-owner", "answer", 200, 400)
    with database.session() as session:
        row = session.get(ModelBudgetRecord, cfg.budget_id)
        assert row.charged_units == 2_000 and row.used_calls == 2


def test_generator_sends_scoped_evidence_and_saves_only_redacted_receipt(setup):
    database, cfg = setup
    citations = grounded_citations()[:1]

    def handler(request):
        body = json.loads(request.content)
        assert body["model"] == cfg.model
        assert body["max_completion_tokens"] == 4096
        user = json.loads(body["messages"][1]["content"])
        assert len(user["evidence"]) == 1
        assert user["evidence"][0]["claim"]["id"] == citations[0].claim.id
        return httpx.Response(
            200,
            json={
                "model": cfg.model,
                "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {"content": json.dumps(valid_payload(citations[0].claim.id))},
                    }
                ],
            },
        )

    generator = BudgetedAnswerGenerator(database, cfg, transport=httpx.MockTransport(handler))
    raw = generator.generate("private-task-marker", citations, "zh", user_id="test-owner")
    assert json.loads(raw)["statements"]
    with database.session() as session:
        call = session.scalar(select(ModelCallRecord))
        assert call.state == "validated" and call.charged_units == 200
        assert "private-task-marker" not in call.receipt_json
        assert cfg.api_key not in call.receipt_json


def test_invalid_output_is_charged_but_does_not_lock_the_budget(setup):
    database, cfg = setup
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "model": cfg.model,
                "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {"content": json.dumps(valid_payload("unknown-claim"))},
                    }
                ],
            },
        )

    generator = BudgetedAnswerGenerator(database, cfg, transport=httpx.MockTransport(handler))
    for _ in range(2):
        with pytest.raises(ValueError):
            generator.generate("task", grounded_citations()[:1], "zh", user_id="test-owner")
    # A fully receipted invalid answer is charged and counted, not a lockout.
    assert len(requests) == 2
    with database.session() as session:
        row = session.get(ModelBudgetRecord, cfg.budget_id)
        assert row.blocked is False and row.used_calls == 2 and row.charged_units == 400
        states = sorted(call.state for call in session.scalars(select(ModelCallRecord)))
        assert states == ["failed", "failed"]


def test_missing_receipt_still_locks_the_budget(setup):
    database, cfg = setup
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "model": cfg.model,
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {"content": json.dumps(valid_payload("unknown-claim"))},
                    }
                ],
            },
        )

    generator = BudgetedAnswerGenerator(database, cfg, transport=httpx.MockTransport(handler))
    for _ in range(2):
        with pytest.raises(ValueError):
            generator.generate("task", grounded_citations()[:1], "zh", user_id="test-owner")
    # Spend cannot be reconciled without usage, so the allocation closes.
    assert len(requests) == 1
    with database.session() as session:
        assert session.get(ModelBudgetRecord, cfg.budget_id).blocked is True


def test_native_opus_decision_defaults_to_medium_in_the_request_and_receipt(setup, monkeypatch):
    database, cfg = setup
    env = {
        "API_URL": "https://provider.example/v1/messages",
        "API_KEY": cfg.api_key,
        "MODEL": "claude-opus-5-5",
        "PROTOCOL": "anthropic-messages",
        "BUDGET_ID": cfg.budget_id,
        "BUDGET_MONTH": cfg.month,
        "CURRENCY": cfg.currency,
        "LIMIT_UNITS": str(cfg.limit_units),
        "INPUT_RATE": str(cfg.input_rate),
        "OUTPUT_RATE": str(cfg.output_rate),
        "MAX_CALLS": str(cfg.max_calls),
        "USER_DAILY_CALLS": str(cfg.user_daily_calls),
        "USER_IDS": "test-owner",
    }
    for name, value in env.items():
        monkeypatch.setenv(f"AI_RADAR_ANSWER_{name}", value)
        monkeypatch.setenv(f"AI_RADAR_EXTRACTION_BUDGET_{name}", value)
    monkeypatch.delenv("AI_RADAR_ANSWER_REASONING_EFFORT", raising=False)
    monkeypatch.delenv("AI_RADAR_EXTRACTION_BUDGET_REASONING_EFFORT", raising=False)
    cfg = GenerationConfig.from_env()
    assert cfg.reasoning_effort == "medium"
    assert cfg.profile()["reasoning_effort"] == "medium"
    extraction_cfg = GenerationConfig.from_env(
        "AI_RADAR_EXTRACTION_BUDGET_", service_subject="automation"
    )
    assert extraction_cfg.reasoning_effort == "low"
    assert "reasoning_effort" not in extraction_cfg.profile()
    citations = grounded_citations()[:1]

    def handler(request):
        body = json.loads(request.content)
        assert "tools" not in body and "cache_control" not in json.dumps(body)
        assert body["max_tokens"] == 4096 and "max_completion_tokens" not in body
        assert body["output_config"]["effort"] == "medium"
        assert "minLength" not in json.dumps(body["output_config"]["format"]["schema"])
        message = json.loads(body["messages"][0]["content"])
        result = (
            Adapter().interpret(message)
            if "task" in message
            else json.dumps(valid_payload(citations[0].claim.id))
        )
        return httpx.Response(
            200,
            json={
                "model": cfg.model,
                "stop_reason": "end_turn",
                "usage": {"input_tokens": 100, "output_tokens": 50, "cache_read_input_tokens": 20},
                "content": [
                    {"type": "thinking", "thinking": "do not record reasoning"},
                    {"type": "text", "text": result},
                ],
            },
        )

    transport = httpx.MockTransport(handler)
    interpreter = BudgetedMeaningInterpreter(database, cfg, transport=transport)
    assert (
        TaskMeaningService(interpreter).understand(TASK, owner_id="test-owner").status
        == "validated"
    )
    BudgetedAnswerGenerator(database, cfg, transport=transport).generate(
        "test task", citations, "zh", user_id="test-owner"
    )
    assert interpreter.diagnostics()["reasoningEffort"] == "medium"
    with database.session() as session:
        calls = session.scalars(select(ModelCallRecord)).all()
        assert {call.purpose for call in calls} == {"understanding", "answer"}
        for call in calls:
            assert call.charged_units == 220
            assert json.loads(call.receipt_json)["requestedEffort"] == "medium"
            assert "do not record reasoning" not in call.receipt_json


def test_request_tokens_and_billable_bounds_are_independent(setup):
    database, cfg = setup
    cfg = replace(
        cfg,
        protocol="anthropic-messages",
        max_output_tokens=16384,
        billable_input_tokens=100000,
        billable_output_tokens=131072,
    )
    citations = grounded_citations()[:1]
    requests = []

    def handler(request):
        requests.append(request)
        assert json.loads(request.content)["max_tokens"] == 16384
        return httpx.Response(
            200,
            json={
                "id": "msg_test_123",
                "model": cfg.model,
                "stop_reason": "end_turn",
                "usage": {"input_tokens": 100, "output_tokens": 17000},
                "content": [
                    {"type": "text", "text": json.dumps(valid_payload(citations[0].claim.id))}
                ],
            },
        )

    transport = httpx.MockTransport(handler)
    capped = replace(cfg, spend_cap_units=362143)
    with pytest.raises(ValueError):
        BudgetedAnswerGenerator(database, capped, transport=transport).generate(
            "test task", citations, "zh", user_id="test-owner"
        )
    assert not requests
    BudgetedAnswerGenerator(database, cfg, transport=transport).generate(
        "test task", citations, "zh", user_id="test-owner"
    )
    with database.session() as session:
        call = session.scalar(select(ModelCallRecord))
        assert call.reserved_units == 362144 and call.charged_units == 34100
        assert call.state == "validated"
        receipt = json.loads(call.receipt_json)
        assert receipt["requestedOutputTokens"] == 16384
        assert receipt["completionTokens"] == 17000
        assert receipt["responseId"] == "msg_test_123"
