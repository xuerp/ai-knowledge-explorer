"""Reliability of model-led analysis: trimming, one retry, no hidden second call."""

import json

import pytest

from app.decision_model_led import ModelLedRejected, parse_model_led
from tests.test_decision_guidance import api, create  # noqa: F401
from tests.test_decision_model_led import (
    SCREENSHOT,
    AnalysisGenerator,
    enable,
    point,
)


def payload(**overrides):
    base = {
        "understoodTaskZh": "选一个编排框架",
        "understoodTaskEn": "Pick a framework",
        "headlineZh": "先做一轮小规模验证",
        "headlineEn": "Run a small pilot",
        "summary": point("先跑通最小流程。", "model-knowledge"),
        "candidates": [],
        "tradeoffs": [],
        "gaps": [],
        "firstSteps": [],
        "refused": False,
        "refusalReason": None,
    }
    base.update(overrides)
    return base


def test_overlong_lists_and_text_are_trimmed_not_rejected():
    tip = point("这是一条常识建议。", "model-knowledge")
    raw = json.dumps(
        payload(gaps=[tip] * 7, headlineZh="很长的标题" * 60, tradeoffs=[tip] * 5),
        ensure_ascii=False,
    )
    parsed, trims = parse_model_led(raw)
    assert len(parsed.gaps) == 4 and len(parsed.tradeoffs) == 3
    assert len(parsed.headline_zh) <= 120
    assert "list:gaps:7>4" in trims and "text:headlineZh" in trims


def test_unparseable_output_has_a_stable_reason():
    with pytest.raises(ModelLedRejected) as error:
        parse_model_led("not json")
    assert error.value.reason == "output-not-json"
    with pytest.raises(ModelLedRejected) as error:
        parse_model_led(json.dumps({"headlineZh": "x"}))
    assert error.value.reason.startswith("schema:")


class FlakyGenerator(AnalysisGenerator):
    """First answer is malformed, the corrected retry is valid."""

    def __init__(self):
        super().__init__()
        self.previous_errors = []

    def analyze(self, *args, previous_error=None, **kwargs):
        self.previous_errors.append(previous_error)
        if previous_error is None:
            self.calls.append({"catalog": kwargs.get("catalog")})
            return "{ truncated"
        return super().analyze(*args, **kwargs)


def test_one_corrective_retry_recovers_a_malformed_answer(api):  # noqa: F811
    generator = FlakyGenerator()
    enable(api, generator)
    result = create(api, SCREENSHOT)
    assert result["decision"]["modelLed"]
    assert generator.previous_errors == [None, "output-not-json"]


class AlwaysBroken(AnalysisGenerator):
    def analyze(self, *args, previous_error=None, **kwargs):
        self.calls.append(previous_error)
        return "{ truncated"


def test_failure_is_explained_and_never_spends_a_hidden_second_call(api):  # noqa: F811
    generator = AlwaysBroken()
    enable(api, generator)
    result = create(api, SCREENSHOT)
    # Two analysis attempts (original + one retry) and no legacy generate() call:
    # AnalysisGenerator.generate raises if it is ever called.
    assert generator.calls == [None, "output-not-json"]
    assert result["decision"].get("modelLed") is None
    assert result["answerMode"] == "extractive"
    diagnostics = result["retrievalDiagnostics"]
    assert diagnostics["generationFallbackReason"] == "model-led-invalid"


def test_identical_resubmission_within_a_minute_returns_the_same_record(api):  # noqa: F811
    generator = AnalysisGenerator()
    enable(api, generator)
    first = create(api, SCREENSHOT)
    second = create(api, SCREENSHOT)
    assert second["id"] == first["id"]
    assert len(generator.calls) == 1, "the duplicate must not pay for another analysis"
    other = create(api, SCREENSHOT + "另外还要检查颜色。")
    assert other["id"] != first["id"]


def test_owner_requests_verification_of_one_unverified_line(api):  # noqa: F811
    from app.database import EntryRequestRecord

    client, owner, other = api
    enable(api, AnalysisGenerator())
    result = create(api, SCREENSHOT)
    research_id = result["id"]
    url = f"/api/v2/research/{research_id}/knowledge-checks"
    gap = {"section": "gaps", "index": 0}
    first = client.post(url, json=gap, headers=owner)
    assert first.status_code == 201, first.text
    assert first.json()["status"] == "pending"
    # Clicking again returns the same request, not a duplicate.
    again = client.post(url, json=gap, headers=owner).json()
    assert again["id"] == first.json()["id"]
    listed = client.get(url, headers=owner).json()
    assert [row["id"] for row in listed] == [first.json()["id"]]
    # A cited line cannot be "verified" again; another account sees nothing.
    cited = {"section": "candidate", "candidateIndex": 0, "index": 0}
    assert client.post(url, json=cited, headers=owner).status_code == 422
    assert client.post(url, json=gap, headers=other).status_code == 404
    with client.app.state.database.session() as session:
        row = session.get(EntryRequestRecord, first.json()["id"])
        assert row.status == "pending" and "模型常识" in row.reason
    # Deleting the record removes the untouched request, which quotes its text.
    assert client.delete(f"/api/v2/research/{research_id}", headers=owner).status_code == 204
    with client.app.state.database.session() as session:
        assert session.get(EntryRequestRecord, first.json()["id"]) is None
