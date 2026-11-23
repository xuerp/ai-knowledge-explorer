"""Model-written lead sentence on the decision page; synthetic transport only."""

import json

from app.answer_generation import CitedAnswerService

from .test_decision_guidance import answer, api, create  # noqa: F401


class LeadGenerator:
    def __init__(self):
        self.contexts = []

    def generate(self, question, citations, language, *, user_id=None, context=None):
        self.contexts.append(context)
        claim_id = citations[0].claim.id
        line = {
            "textZh": "就你的场景，可以先从这里开始。",
            "textEn": "For your case, start here.",
            "claimIds": [claim_id],
        }
        return json.dumps(
            {
                "answerZh": line["textZh"],
                "answerEn": line["textEn"],
                "summary": line,
                "statements": [line],
                "uncertainties": [],
                "refused": False,
                "refusalReason": None,
            },
            ensure_ascii=False,
        )


def use_generator(api):  # noqa: F811
    client = api[0]
    generator = LeadGenerator()
    client.app.state.services.engagement.answer_service = CitedAnswerService(
        generator, enabled=True
    )
    return generator


def test_advice_summary_is_model_written_and_labelled(api):  # noqa: F811
    generator = use_generator(api)
    result = create(api, "我想让同事查询公司的 PDF 文档，回答能找到出处")
    guidance = result["decision"]["guidance"]
    assert result["answerMode"] == "generated"
    assert guidance["outcome"] == "advice"
    recommendation = guidance["recommendation"]
    assert recommendation["summary"] == "就你的场景，可以先从这里开始。"
    assert recommendation["summarySource"] == "model"
    assert recommendation["summaryClaimIds"]
    assert generator.contexts[-1]["choice"]["entityIds"] == recommendation["entityIds"]


def test_conditional_summary_keeps_rule_caveat(api):  # noqa: F811
    use_generator(api)
    original = create(api, "为编程选择模型 API，每月不超过100元")
    revised = answer(api, original, "functional-route").json()
    recommendation = revised["decision"]["guidance"]["recommendation"]
    assert revised["decision"]["guidance"]["outcome"] != "advice"
    assert recommendation["summarySource"] == "rules"
    assert "尚不能证明候选满足预算" in recommendation["summary"]
