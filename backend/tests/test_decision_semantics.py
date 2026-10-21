"""Contract tests use fake interpreters, never evidence of live model quality."""

import json

import pytest

from app.decision_intent import scenario_definition, task_workflow
from app.decision_semantics import (
    TaskMeaningService,
    context_meaning,
    meaning_source,
    task_digest,
    validate_meaning,
)
from app.decision_task import understand_context
from app.schemas import DecisionContext

TASK = "把法文保修卡转为中文，型号原样保留，也不要写代码"


def proposal(task=TASK):
    return {
        "version": 1,
        "source_sha256": task_digest(task),
        "state": "understood",
        "scenario": "general-text",
        "method": "translation",
        "ambiguity": None,
        "items": [
            {"quote": "把法文保修卡转为中文", "role": "goal"},
            {"quote": "法文保修卡", "role": "material"},
            {"quote": "型号原样保留", "role": "condition"},
            {"quote": "也不要写代码", "role": "prohibition"},
        ],
    }


class FakeInterpreter:
    def __init__(self, payload):
        self.payload = payload
        self.requests = []

    def interpret(self, request):
        self.requests.append(request)
        return json.dumps(self.payload, ensure_ascii=False)


def test_semantic_route_does_not_require_taxonomy_keyword():
    interpreter = FakeInterpreter(proposal())
    receipt = TaskMeaningService(interpreter).understand(TASK)
    assert receipt.status == "validated"
    context = DecisionContext(
        task=TASK, priority="balanced", deployment="undecided", task_meaning=receipt
    )
    assert scenario_definition(context)["id"] == "general-text"
    assert task_workflow(TASK, context_meaning(context))["id"] == "translation"
    parsed = understand_context(context)
    assert parsed.materials == ("法文保修卡",)
    assert "也不要写代码" in parsed.limits
    request = interpreter.requests[0]
    assert request["task"] == TASK
    assert "patterns" not in json.dumps(request["methods"])
    assert "claims" not in request


@pytest.mark.parametrize(
    "change",
    [
        "fabricated",
        "missing-limit",
        "negative-material",
        "unknown-route",
        "supplier-fact",
        "different-task",
        "method-route-mismatch",
    ],
)
def test_invalid_interpretation_is_rejected_without_using_it(change):
    payload = proposal()
    if change == "fabricated":
        payload["items"][0]["quote"] = "不存在的原文"
    elif change == "missing-limit":
        payload["items"].pop()
    elif change == "negative-material":
        payload["items"].append({"quote": "代码", "role": "material"})
    elif change == "unknown-route":
        payload["scenario"] = "made-up-route"
    elif change == "supplier-fact":
        payload["price"] = "free"
    elif change == "different-task":
        payload["source_sha256"] = task_digest("another task")
    else:
        payload["scenario"] = "coding-workspace"
    receipt = TaskMeaningService(FakeInterpreter(payload)).understand(TASK)
    if change in {"missing-limit", "negative-material"}:
        # The raw proposal still fails strict validation. The service repairs
        # only from explicit original text, retaining a correction receipt.
        with pytest.raises(ValueError):
            validate_meaning(json.dumps(payload), TASK)
        assert receipt.status == "validated"
        assert receipt.normalizations
        assert any(
            item.quote == "也不要写代码" and item.role in {"condition", "prohibition"}
            for item in receipt.meaning.items
        )
        assert not any(
            item.quote == "代码" and item.role == "material" for item in receipt.meaning.items
        )
    else:
        assert receipt.status == "invalid"


def test_provider_error_and_unavailable_are_explicit():
    class Broken:
        def interpret(self, request):
            raise TimeoutError("private provider error must not appear in response")

    assert TaskMeaningService(Broken()).understand(TASK).model_dump() == {
        "status": "failed",
        "meaning": None,
        "normalizations": [],
    }
    assert TaskMeaningService().understand(TASK).status == "unavailable"


def test_edit_invalidates_saved_interpretation():
    receipt = TaskMeaningService(FakeInterpreter(proposal())).understand(TASK)
    context = DecisionContext(
        task="完全不同的需求文本", priority="balanced", deployment="undecided", task_meaning=receipt
    )
    assert context_meaning(context) is None


def test_answer_history_and_notes_are_in_interpretation_identity():
    context = DecisionContext(
        task=TASK,
        notes="只处理第一页",
        priority="balanced",
        deployment="undecided",
        intent_answers=[{"questionId": "semantic-choice", "text": "译给客户看"}],
    )
    source = meaning_source(context)
    assert "只处理第一页" in source and "译给客户看" in source
    payload = proposal()
    payload["source_sha256"] = task_digest(source)
    payload["items"].append({"quote": "只处理第一页", "role": "sample"})
    context.task_meaning = TaskMeaningService(FakeInterpreter(payload)).understand(source)
    assert context_meaning(context) is not None
    from app.decision_dialogue import analysis_context

    assert analysis_context(context).task == TASK


def test_ambiguous_payload_requires_specific_question():
    payload = proposal()
    payload["state"] = "ambiguous"
    payload["ambiguity"] = None
    with pytest.raises(ValueError):
        validate_meaning(json.dumps(payload), TASK)


def test_understood_task_without_catalog_route_is_a_coverage_gap():
    from app.decision_dialogue import clarification_for, unsupported_task

    task = "想编辑一张商品照片，不能改变商标"
    payload = {
        "version": 1,
        "source_sha256": task_digest(task),
        "state": "understood",
        "scenario": None,
        "method": "image-editing",
        "ambiguity": None,
        "items": [
            {"quote": "想编辑一张商品照片", "role": "goal"},
            {"quote": "不能改变商标", "role": "prohibition"},
        ],
    }
    receipt = TaskMeaningService(FakeInterpreter(payload)).understand(task)
    assert receipt.status == "validated"
    context = DecisionContext(
        task=task, priority="balanced", deployment="undecided", task_meaning=receipt
    )
    assert unsupported_task(context)
    assert clarification_for(context, "zh") is None
    assert scenario_definition(context) is None


def test_ownership_statement_cannot_become_input_material():
    task = "编辑商品图片，素材版权归我"
    payload = {
        "version": 1,
        "source_sha256": task_digest(task),
        "state": "understood",
        "scenario": None,
        "method": "image-editing",
        "ambiguity": None,
        "items": [
            {"quote": "编辑商品图片", "role": "goal"},
            {"quote": "素材版权归我", "role": "material"},
        ],
    }
    with pytest.raises(ValueError, match="ownership"):
        validate_meaning(json.dumps(payload), task)
    receipt = TaskMeaningService(FakeInterpreter(payload)).understand(task)
    assert receipt.status == "validated"
    assert "ownership-condition-role" in receipt.normalizations
    assert receipt.meaning.items[1].role == "condition"
    payload["items"][1]["role"] = "condition"
    assert TaskMeaningService(FakeInterpreter(payload)).understand(task).status == "validated"


def test_exact_compatibility_envelope_still_checks_inner_payload():
    payload = {"type": "json_object", "content": proposal()}
    receipt = TaskMeaningService(FakeInterpreter(payload)).understand(TASK)
    assert receipt.status == "validated"
    assert "json-object-envelope" in receipt.normalizations
    payload["content"]["price"] = "free"
    assert TaskMeaningService(FakeInterpreter(payload)).understand(TASK).status == "invalid"
    del payload["content"]["price"]
    payload["unexpected"] = True
    assert TaskMeaningService(FakeInterpreter(payload)).understand(TASK).status == "invalid"


def test_single_catalog_route_resolves_pair_without_model_owned_duplication():
    old = proposal()
    packet = {key: value for key, value in old.items() if key not in {"method", "scenario"}}
    packet.update(version=2, route="translation")
    receipt = TaskMeaningService(FakeInterpreter(packet)).understand(TASK)
    assert receipt.status == "validated"
    assert receipt.meaning.method == "translation"
    assert receipt.meaning.scenario == "general-text"
    assert "catalog-route-resolution" in receipt.normalizations
    packet["route"] = "invented-route"
    assert TaskMeaningService(FakeInterpreter(packet)).understand(TASK).status == "invalid"
    packet["route"] = "translation"
    packet["scenario"] = "knowledge-workspace"
    assert TaskMeaningService(FakeInterpreter(packet)).understand(TASK).status == "invalid"
