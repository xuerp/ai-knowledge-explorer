"""Full responses for the preserved failed tasks, including persisted guidance."""

import json
from pathlib import Path

import pytest

from .test_decision_guidance import api, create  # noqa: F401

CASES = json.loads(
    (Path(__file__).parents[1] / "data/decision_novel_failures_20261020.json").read_text("utf8")
)["cases"]


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_novel_response_contract(api, case, tmp_path):  # noqa: F811
    result = create(api, case["task"])
    (tmp_path / (case["id"] + ".json")).write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf8"
    )
    decision = result["decision"]
    guidance = decision["guidance"]
    assert guidance["clarification"] is None
    assert result["decisionContext"]["task"] == case["task"]
    fields = guidance["intent"]
    assert all(
        "代码" not in item["value"] and "仓库" not in item["value"]
        for item in fields
        if item["field"] == "materials"
    )
    key = case["id"]
    if key in {"N3", "N6", "N8"}:
        assert guidance["outcome"] == "unsupported"
        assert guidance["recommendation"]["primaryEntityId"] is None
        assert "已识别任务" in guidance["recommendation"]["headline"]
    else:
        trial = decision["plan"]["trial"]
        assert trial and trial["executed"] is False
        assert case["task"] in trial["sample"]
        assert guidance["nextAction"]["instruction"] == " ".join(trial["procedure"])
        prompt = guidance["nextAction"]["executionPrompt"]
        assert prompt and "不要回答产品选型问题" in prompt
        assert all(row in prompt for row in trial["acceptance"])
        assert all(row in prompt for row in trial["metrics"])
    if key == "N3":
        assert result["decisionContext"]["deployment"] == "on-device"
        assert not any(item["field"] == "time-limit" for item in fields)
    if key in {"N3", "N6", "N8"}:
        assert decision["plan"]["trial"] is None
        assert decision["plan"]["trialCandidateIds"] == []
        assert guidance["nextAction"]["executionPrompt"] is None
        assert "重点检查" in guidance["nextAction"]["instruction"]
        assert len(guidance["nextAction"]["instruction"]) > 100
    if key == "N2":
        assert guidance["recommendation"]["primaryEntityId"] == "e-dify"
        assert "矩阵" in guidance["nextAction"]["instruction"]
        assert "生效版本" in guidance["nextAction"]["instruction"]
        assert guidance["outcome"] == "conditional"
        assert "不能据此确认" in guidance["recommendation"]["summary"]
    if key == "N7":
        trial = decision["plan"]["trial"]
        assert "召回" in "".join(trial["metrics"])
        assert "字段准确率" not in "".join(trial["metrics"])
        assert "不提取订单字段" in guidance["nextAction"]["instruction"]
    if key == "N4":
        assert "不执行查询" in guidance["nextAction"]["instruction"]
        assert "十分钟" in guidance["nextAction"]["instruction"]
    client, owner, _ = api
    saved = client.get("/api/v2/research/" + result["id"], headers=owner)
    assert saved.status_code == 200
    assert saved.json()["decision"]["guidance"] == guidance
