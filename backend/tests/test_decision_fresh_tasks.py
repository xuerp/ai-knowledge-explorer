"""Frozen exploratory failures: test intent and complete real response contracts."""

import json
from pathlib import Path

import pytest

from app.decision_dialogue import normalize_context
from app.schemas import DecisionContext

from .test_decision_guidance import answer, api, create  # noqa: F401

CASES = json.loads(
    (Path(__file__).parents[1] / "data/decision_fresh_tasks_20261019.json").read_text("utf-8")
)["cases"]


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_frozen_fresh_tasks(api, case):  # noqa: F811 -- imported pytest fixture
    result = create(api, case["task"])
    decision = result["decision"]
    guidance = decision["guidance"]
    key = case["id"]
    if key in {"R1", "R4", "R7"}:
        assert (
            decision["scenario"]["id"]
            == {"R1": "coding-workspace", "R4": "document-extraction", "R7": "coding-model"}[key]
        )
        assert not guidance["clarification"] or guidance["clarification"]["id"] != "work-direction"
    if key == "R2":
        materials = [item["value"] for item in guidance["intent"] if item["field"] == "materials"]
        assert materials and "代码" not in materials[0]
    if key == "R3":
        assert result["decisionContext"]["deployment"] == "on-device"
        assert guidance["recommendation"]["primaryEntityId"] is None
        assert "合同" in guidance["clarification"]["question"]
    if key == "R5":
        assert guidance["outcome"] == "clarify"
    if key == "R6":
        assert guidance["outcome"] == "unsupported"
        assert guidance["recommendation"]["primaryEntityId"] is None
    if key == "R7":
        assert result["decisionContext"]["budget"]["max"] == 500
        assert result["decisionContext"]["budget"]["currency"] == "CNY"
        assert guidance["recommendation"]["primaryEntityId"] is None
    if key == "R8":
        assert guidance["recommendation"]["primaryEntityId"] == "e-claude-code"
        trial = decision["plan"]["trial"]
        assert trial["executed"] is False
        assert "半小时" in "".join(trial["procedure"])
        assert "三题" not in trial["sample"]
        assert case["task"] in trial["sample"]
        assert "半小时" in guidance["nextAction"]["instruction"]
        assert guidance["nextAction"]["instruction"] == " ".join(trial["procedure"])


HOLDOUT = json.loads(
    (Path(__file__).parents[1] / "data/decision_holdout_20261019.json").read_text("utf-8")
)["cases"]


@pytest.mark.parametrize("case", HOLDOUT, ids=lambda case: case["id"])
def test_unseen_task_contract(api, case):  # noqa: F811 -- imported pytest fixture
    result = create(api, case["task"])
    decision = result["decision"]
    guidance = decision["guidance"]
    if "scenario" in case:
        assert decision["scenario"]["id"] == case["scenario"]
        assert not guidance["clarification"] or guidance["clarification"]["id"] != "work-direction"
    if "outcome" in case:
        assert guidance["outcome"] == case["outcome"]
    if case.get("offline"):
        assert result["decisionContext"]["deployment"] == "on-device"
        assert guidance["recommendation"]["primaryEntityId"] is None
    if "budget" in case:
        assert result["decisionContext"]["budget"]["max"] == case["budget"]
        assert guidance["recommendation"]["primaryEntityId"] is None
    if case.get("noCodeMaterial"):
        assert all(
            "代码" not in item["value"]
            for item in guidance["intent"]
            if item["field"] == "materials"
        )


def test_daily_workload_clarification_preserves_budget(api):  # noqa: F811
    result = create(api, next(case["task"] for case in CASES if case["id"] == "R7"))
    assert result["decision"]["guidance"]["clarification"]["id"] == "monthly-days"
    revised = answer(api, result, "days-30")
    assert revised.status_code == 200
    budget = revised.json()["decisionContext"]["budget"]
    assert budget["max"] == 500 and budget["currency"] == "CNY"
    assert budget["monthlyInputTokens"] == 1_200_000_000
    assert budget["monthlyOutputTokens"] == 240_000_000
    assert revised.json()["decision"]["guidance"]["recommendation"]["primaryEntityId"] is None


def test_structured_budget_cannot_weaken_written_ceiling():
    with pytest.raises(ValueError, match="预算"):
        normalize_context(
            DecisionContext(
                task="每月预算最多人民币五百元，原厂 API 做代码补全",
                priority="balanced",
                deployment="undecided",
                budget={"mode": "range", "max": 5000, "currency": "CNY"},
            )
        )
