"""Model-led decision analysis: the four hard constraints, with synthetic output only."""

import json
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.decision_constraints import constraint_failures
from app.decision_model_led import validate_model_led
from app.rag import grounded_retrieval_citations
from app.repository import KnowledgeRepository
from app.schemas import DecisionContext, ModelLedPayload

from .test_decision_guidance import api, create  # noqa: F401

SEED = Path(__file__).resolve().parents[1] / "data" / "demo_snapshot.json"


@pytest.fixture(scope="module")
def world():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    repository = KnowledgeRepository(SEED)
    with Session(engine) as session:
        repository.seed_catalog(session)
        snapshot = repository.public_snapshot(session)
    return snapshot, grounded_retrieval_citations(snapshot)


def cite(citations, entity_id):
    return next(item.claim.id for item in citations if item.claim.entity_id == entity_id)


def point(text, basis="verified", claim_ids=()):
    return {"basis": basis, "textZh": text, "textEn": text, "claimIds": list(claim_ids)}


def payload(**overrides):
    base = {
        "understoodTaskZh": "选一个编排框架",
        "understoodTaskEn": "Pick an orchestration framework",
        "headlineZh": "建议先试 LangGraph",
        "headlineEn": "Try LangGraph first",
        "summary": point("先用 LangGraph 跑通最小流程。", "model-knowledge"),
        "candidates": [],
        "tradeoffs": [],
        "gaps": [],
        "firstSteps": [],
        "refused": False,
        "refusalReason": None,
    }
    base.update(overrides)
    return ModelLedPayload.model_validate(base)


def context(**values):
    return DecisionContext.model_validate(
        {
            "workflowVersion": 2,
            "task": "选一个 Agent 编排框架",
            "priority": "balanced",
            "deployment": "undecided",
            **values,
        }
    )


def test_verified_point_with_valid_citation_is_kept(world):
    snapshot, citations = world
    claim = cite(citations, "e-langgraph")
    result = validate_model_led(
        payload(
            candidates=[
                {
                    "entityId": "e-langgraph",
                    "role": "primary",
                    "points": [point("LangGraph 支持有状态编排。", claim_ids=[claim])],
                }
            ]
        ),
        citations,
        snapshot,
        context(),
        "zh",
    )
    assert result.candidates[0].points[0].basis == "verified"
    assert result.candidates[0].points[0].claim_ids == [claim]
    assert not result.pruned


def test_constraint_1_verified_point_needs_a_real_citation_and_supported_numbers(world):
    snapshot, citations = world
    claim = cite(citations, "e-langgraph")
    result = validate_model_led(
        payload(
            tradeoffs=[
                point("没有引用的已核验说法。"),
                point("引用了不存在的事实。", claim_ids=["claim-not-supplied"]),
                point("LangGraph 的通过率为 99.7%。", claim_ids=[claim]),
                point("LangGraph 支持有状态编排。", claim_ids=[claim]),
            ]
        ),
        citations,
        snapshot,
        context(),
        "zh",
    )
    assert [line.text for line in result.tradeoffs] == ["LangGraph 支持有状态编排。"]
    assert {item.reason for item in result.pruned} == {
        "verified-without-citation",
        "unknown-claim",
        "value-absent-from-claims",
    }


def test_constraint_2_hard_exclusion_prunes_candidate_and_blocks_lead_text(world):
    snapshot, citations = world
    claim = cite(citations, "e-langgraph")
    candidate = {
        "entityId": "e-langgraph",
        "role": "primary",
        "points": [point("LangGraph 支持有状态编排。", claim_ids=[claim])],
    }
    result = validate_model_led(
        payload(
            headlineZh="可以先看候选",
            headlineEn="Review the options",
            summary=point("先列出可用方案。", "model-knowledge"),
            candidates=[candidate],
        ),
        citations,
        snapshot,
        context(exclusions=["LangGraph"]),
        "zh",
    )
    assert result.candidates == []
    assert result.pruned[0].reason.startswith("hard-requirement:")
    with pytest.raises(ValueError):
        validate_model_led(
            payload(candidates=[candidate]),
            citations,
            snapshot,
            context(exclusions=["LangGraph"]),
            "zh",
        )


def test_constraint_3_unknown_price_is_not_free_and_volume_is_not_ranking(world):
    snapshot, citations = world
    claim = cite(citations, "e-langgraph")
    result = validate_model_led(
        payload(
            tradeoffs=[
                point("LangGraph 是免费的。", claim_ids=[claim]),
                point("它的资料最多，所以最强。", claim_ids=[claim]),
                point("费用尚未核实，不要当成免费。", "model-knowledge"),
            ]
        ),
        citations,
        snapshot,
        context(),
        "zh",
    )
    reasons = {item.reason for item in result.pruned}
    assert reasons == {"unverified-free", "evidence-volume-ranking"}
    # A warning that price is unknown and not free is the behaviour we want.
    assert [line.text for line in result.tradeoffs] == ["费用尚未核实，不要当成免费。"]
    with pytest.raises(ValueError):
        validate_model_led(
            payload(headlineZh="免费方案推荐", headlineEn="Free option"),
            citations,
            snapshot,
            context(),
            "zh",
        )


def test_constraint_4_model_knowledge_has_no_citation_or_specific_values(world):
    snapshot, citations = world
    claim = cite(citations, "e-langgraph")
    result = validate_model_led(
        payload(
            gaps=[
                point("常识却带了引用。", "model-knowledge", [claim]),
                point("单卡 A100 微调 7B 模型一般够用，但要实测显存。", "model-knowledge"),
                point("这个模型大约每月 20 元。", "model-knowledge"),
                point("它在测试中得到 85.2%。", "model-knowledge"),
                point("它在 2025 年 3 月发布。", "model-knowledge"),
            ]
        ),
        citations,
        snapshot,
        context(),
        "zh",
    )
    assert [line.text for line in result.gaps] == ["单卡 A100 微调 7B 模型一般够用，但要实测显存。"]
    assert result.gaps[0].basis == "model-knowledge" and result.gaps[0].claim_ids == []
    assert [item.reason for item in result.pruned] == [
        "model-knowledge-cited",
        "model-knowledge-specific-value",
        "model-knowledge-specific-value",
        "model-knowledge-specific-value",
    ]


def test_unknown_entity_and_refusal_are_rejected(world):
    snapshot, citations = world
    result = validate_model_led(
        payload(
            candidates=[
                {
                    "entityId": "e-made-up",
                    "role": "primary",
                    "points": [point("编造的产品。", "model-knowledge")],
                }
            ]
        ),
        citations,
        snapshot,
        context(),
        "zh",
    )
    assert result.candidates == [] and result.pruned[0].reason == "unknown-entity"
    with pytest.raises(ValueError):
        validate_model_led(payload(refused=True), citations, snapshot, context(), "zh")


FINE_TUNE = (
    "我想选个开源模型，基于我们公司五年的历史维修工单做微调。主要是让 AI 能听懂我们行业的"
    "专有黑话（有很多自造词），然后指导新手排查设备故障。我们只有单卡 A100，希望微调门槛"
    "低一点。我最看重的是开源生态好不好（微调资料多不多），以及小参数模型吸收行业知识的能力。"
)
SCREENSHOT = "帮我对产品截图做视觉审查，找出对齐、对比度和文字溢出的问题，并给出修改建议。"


class AnalysisGenerator:
    """Synthetic model: proposes a cited candidate plus labelled common knowledge."""

    def __init__(self, usable=None):
        self.calls = []
        self.usable = usable

    def generate(self, *args, **kwargs):
        raise AssertionError("model-led success must not spend a second call")

    def analyze(self, task, citations, language, *, user_id=None, context=None, catalog=None):
        self.calls.append({"task": task, "catalog": catalog, "evidence": len(citations)})
        claim = next(
            item for item in citations if self.usable is None or item.claim.entity_id in self.usable
        )
        return json.dumps(
            {
                "understoodTaskZh": "按你的硬件和数据选择可微调的开源模型",
                "understoodTaskEn": "Choose an open model to fine-tune on your data",
                "headlineZh": "先做一轮小规模微调验证",
                "headlineEn": "Run a small fine-tuning pilot first",
                "summary": point(
                    "先用小参数开源模型做一轮 LoRA 验证，再决定是否扩大。", "model-knowledge"
                ),
                "candidates": [
                    {
                        "entityId": claim.claim.entity_id,
                        "role": "primary",
                        "points": [point(claim.claim.text.zh, claim_ids=[claim.claim.id])],
                    }
                ],
                "tradeoffs": [
                    point("小模型更容易在单卡上微调，但复杂推理可能更弱。", "model-knowledge")
                ],
                "gaps": [
                    point(
                        "知识库没有记录各模型的微调资料数量，需要自行查看社区与文档。",
                        "model-knowledge",
                    )
                ],
                "firstSteps": [
                    point("抽取 200 张有代表性的工单，整理成问答对做首轮验证。", "model-knowledge")
                ],
                "refused": False,
                "refusalReason": None,
            },
            ensure_ascii=False,
        )


def enable(api, generator):  # noqa: F811
    from app.answer_generation import CitedAnswerService

    engagement = api[0].app.state.services.engagement
    engagement.answer_service = CitedAnswerService(generator, enabled=True)
    engagement.model_led = True


@pytest.mark.parametrize("task", [FINE_TUNE, SCREENSHOT])
def test_previously_unsupported_tasks_get_a_model_led_answer(api, task, world):  # noqa: F811
    snapshot, _ = world
    usable = {
        entity.id
        for entity in snapshot.entities
        if "unavailable-version" not in constraint_failures(entity, [], context())
    }
    generator = AnalysisGenerator(usable)
    enable(api, generator)
    result = create(api, task)
    analysis = result["decision"]["modelLed"]
    assert len(generator.calls) == 1
    assert generator.calls[0]["catalog"], "the model sees the catalog, not 8 scenarios"
    assert result["answerMode"] == "generated"
    assert analysis["headline"] == "先做一轮小规模微调验证"
    bases = {line["basis"] for line in [analysis["summary"], *analysis["gaps"]]}
    assert bases == {"model-knowledge"}
    verified = analysis["candidates"][0]["points"][0]
    assert verified["basis"] == "verified" and verified["claimIds"]
    assert set(verified["claimIds"]) <= set(result["claimIds"])


def test_flag_off_keeps_the_rule_path_and_spends_nothing(api):  # noqa: F811
    generator = AnalysisGenerator()
    enable(api, generator)
    api[0].app.state.services.engagement.model_led = False
    result = create(api, SCREENSHOT)
    assert result["decision"].get("modelLed") is None
    assert generator.calls == []


def test_invalid_model_output_falls_back_to_rules(api):  # noqa: F811
    class Broken(AnalysisGenerator):
        def analyze(self, *args, **kwargs):
            self.calls.append(1)
            return "{}"

        def generate(self, *args, **kwargs):
            return json.dumps(
                {
                    "answerZh": "x",
                    "answerEn": "x",
                    "statements": [],
                    "uncertainties": [],
                    "refused": True,
                    "refusalReason": "no",
                }
            )

    generator = Broken()
    enable(api, generator)
    result = create(api, SCREENSHOT)
    assert result["decision"].get("modelLed") is None
    assert result["retrievalDiagnostics"]["generationFallbackReason"]
