"""Frozen failures and authored holdouts; no provider requests or claimed business scores."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.decision_semantics import (
    JointTaskProposal,
    TaskMeaningService,
    normalize_proposal,
    validate_meaning,
)

from .test_decision_guidance import api, create  # noqa: F401
from .test_decision_semantics import TASK, FakeInterpreter, proposal

DATA = Path(__file__).parents[1] / "data"
CASES = json.loads((DATA / "decision_remediation_holdout_20261023.json").read_text("utf-8"))[
    "cases"
]


@pytest.mark.parametrize("case", CASES, ids=lambda value: value["id"])
def test_frozen_holdouts_have_complete_actionable_contract(api, case):  # noqa: F811
    result = create(api, case["task"])
    decision = result["decision"]
    guidance = decision["guidance"]
    if case.get("clarify"):
        assert guidance["clarification"]
        assert "合同" in guidance["clarification"]["question"]
        return
    if case.get("unsupported"):
        assert guidance["outcome"] == "unsupported"
        assert decision["plan"]["trial"] is None
        return
    assert guidance["clarification"] is None
    if "scenario" in case:
        assert decision["scenario"]["id"] == case["scenario"]
    trial = decision["plan"]["trial"]
    assert trial and trial["executed"] is False
    assert guidance["nextAction"]["instruction"] == " ".join(trial["procedure"])
    # Check operative steps, not just a copied question in trial.sample.
    operative = " ".join(trial["procedure"])
    if case.get("reuse"):
        assert "匿名混排" not in operative
        assert "已识别的主方法" not in str(guidance)
    for text in case.get("required", []):
        assert text in operative
    if case.get("reuse") or case.get("noWinner"):
        assert guidance["recommendation"]["primaryEntityId"] is None
        assert guidance["outcome"] == "conditional"
    client, owner, other = api
    saved = client.get("/api/v2/research/" + result["id"], headers=owner)
    assert saved.json()["decision"] == decision
    assert client.get("/api/v2/research/" + result["id"], headers=other).status_code == 404
    md = client.get(
        "/api/v2/research/" + result["id"] + "/report?format=md&language=zh", headers=owner
    )
    assert md.status_code == 200
    assert all(text in md.text for text in case.get("required", []))
    if case["id"] == "H01":
        assert md.text.count("在现有工具中提供允许使用的材料") == 1


@pytest.mark.parametrize(
    "state,question,route,valid",
    [
        ("understood", None, "translation", True),
        ("understood", "who reads it?", "translation", False),
        ("ambiguous", "who reads it?", "translation", True),
        ("ambiguous", None, "translation", False),
        ("ambiguous", "", None, False),
        ("outside-scope", None, None, True),
        ("outside-scope", None, "translation", False),
    ],
)
def test_joint_schema_and_runtime_agree(state, question, route, valid):
    old = proposal()
    packet = {
        "version": 3,
        "source_sha256": old["source_sha256"],
        "items": old["items"],
        "resolution": {"state": state, "route": route, "ambiguity": question},
    }
    if valid:
        JointTaskProposal.model_validate(packet)
    else:
        with pytest.raises(ValidationError):
            JointTaskProposal.model_validate(packet)
    receipt = TaskMeaningService(FakeInterpreter(packet)).understand(TASK)
    assert (receipt.status == "validated") is valid


def test_emitted_schema_encodes_joint_state_contract():
    schema = JointTaskProposal.model_json_schema()
    assert schema["type"] == "object" and "anyOf" not in schema
    assert len(schema["properties"]["resolution"]["anyOf"]) == 3
    definitions = schema["$defs"]
    for key in ("UnderstoodRoute", "OutsideRoute"):
        assert definitions[key]["properties"]["ambiguity"]["type"] == "null"
    assert definitions["OutsideRoute"]["properties"]["route"]["type"] == "null"
    assert definitions["AmbiguousRoute"]["properties"]["ambiguity"]["minLength"] == 1


def test_legacy_state_conflict_preserves_question_without_relaxing_raw_validation():
    packet = proposal()
    packet["ambiguity"] = "译给谁阅读？"
    with pytest.raises(ValueError, match="Only ambiguous"):
        validate_meaning(json.dumps(packet), TASK)
    raw, events = normalize_proposal(json.dumps(packet), TASK)
    meaning = validate_meaning(raw, TASK)
    assert meaning.state == "ambiguous" and meaning.ambiguity == packet["ambiguity"]
    assert "legacy-clarification-preserved" in events
    packet["source_sha256"] = "0" * 64
    assert TaskMeaningService(FakeInterpreter(packet)).understand(TASK).status == "invalid"


def test_scans_require_preprocessing_and_offline_limits_reach_filtering(api):  # noqa: F811
    scanned = create(api, CASES[1]["task"])
    instruction = scanned["decision"]["guidance"]["nextAction"]["instruction"]
    assert "OCR" in instruction and "不可读" in instruction
    result = create(api, "给离线电脑选中文文档分类方案，文件不能出设备；没有人工标签，不需要训练。")
    assert result["decisionContext"]["deployment"] == "on-device"
    assert result["decision"]["guidance"]["recommendation"]["primaryEntityId"] is None


def test_open_candidate_comparison_names_eligible_options_without_inventing_user_choices(api):  # noqa: F811
    result = create(
        api,
        "我需要为现有 Python 仓库选择编码工具，用于修复缺陷、编辑文件和运行 pytest。先比较有官方来源的能力与使用条件，不需要性能排名。",
    )
    guidance = result["decision"]["guidance"]
    recommendation = guidance["recommendation"]
    assert recommendation["primaryEntityId"] is None
    assert recommendation["entityIds"]
    assert "原题指定" not in recommendation["summary"]
    assert "性能排名" in recommendation["summary"]
    assert guidance["nextAction"]["targetIds"] == recommendation["entityIds"]
    client, owner, _ = api
    report = client.get(
        "/api/v2/research/" + result["id"] + "/report?format=md&language=zh", headers=owner
    )
    assert report.status_code == 200
    assert "原题指定的各方案" not in report.text
    assert "如需验证多个候选" in report.text
