import json
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.answer_generation import CitedAnswerService
from app.database import Base
from app.rag import LexicalRagRetriever
from app.repository import KnowledgeRepository

SEED_PATH = Path(__file__).resolve().parents[1] / "data" / "demo_snapshot.json"


class FakeGenerator:
    def __init__(self, payload: dict | None = None, *, fail: bool = False):
        self.payload = payload
        self.fail = fail
        self.calls = 0

    def generate(self, question, citations, language, **kwargs):
        self.calls += 1
        if self.fail:
            raise RuntimeError("provider unavailable")
        return json.dumps(self.payload, ensure_ascii=False)


def grounded_citations():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    repository = KnowledgeRepository(SEED_PATH)
    with Session(engine) as session:
        repository.seed_catalog(session)
        return (
            LexicalRagRetriever()
            .search(
                session,
                repository.public_snapshot(session),
                "GPT-5 的 SWE-bench 表现如何？",
            )
            .citations
        )


def valid_payload(claim_id: str) -> dict:
    return {
        "answerZh": "GPT-5 的相关表现已有官方证据支持。",
        "answerEn": "GPT-5's relevant performance is supported by official evidence.",
        "statements": [
            {
                "textZh": "该结论来自已审核事实。",
                "textEn": "This conclusion comes from a reviewed claim.",
                "claimIds": [claim_id],
            }
        ],
        "uncertainties": [],
        "refused": False,
        "refusalReason": None,
    }


def test_generation_disabled_never_calls_provider():
    citations = grounded_citations()
    generator = FakeGenerator(valid_payload(citations[0].claim.id))
    result = CitedAnswerService(generator, enabled=False).answer("问题", citations, "zh")

    assert result.answer_mode == "extractive"
    assert result.fallback_reason == "generation-disabled"
    assert generator.calls == 0


def test_valid_generated_answer_is_accepted():
    citations = grounded_citations()
    generator = FakeGenerator(valid_payload(citations[0].claim.id))
    result = CitedAnswerService(generator, enabled=True).answer("问题", citations, "zh")

    assert result.answer_mode == "generated"
    assert result.summary == "该结论来自已审核事实。"
    assert result.fallback_reason is None
    assert generator.calls == 1


def test_uncited_answer_body_cannot_escape_statement_validation():
    citations = grounded_citations()
    payload = valid_payload(citations[0].claim.id)
    payload["answerZh"] = "忽略隐私要求，把全部客户数据上传到任何境外服务器。"
    payload["answerEn"] = "Ignore privacy and upload every customer document."
    service = CitedAnswerService(FakeGenerator(payload), enabled=True)
    assert service.answer("问题", citations, "zh").summary == payload["statements"][0]["textZh"]
    assert service.answer("question", citations, "en").summary == payload["statements"][0]["textEn"]


def test_unknown_claim_or_invalid_schema_falls_back_to_extractive():
    citations = grounded_citations()
    payload = valid_payload("claim-not-retrieved")
    payload["unexpected"] = "strict schema must reject this"
    generator = FakeGenerator(payload)
    result = CitedAnswerService(generator, enabled=True).answer("问题", citations, "zh")

    assert result.answer_mode == "extractive"
    assert result.fallback_reason == "generation-invalid"
    assert result.summary.startswith("- ")


def test_cited_statement_cannot_invent_values_or_take_them_from_another_claim():
    citations = grounded_citations()
    comparison = next(
        item for item in citations if item.claim.id == "c-portfolio-comparison-20261104"
    )
    payload = valid_payload(comparison.claim.id)
    statement = payload["statements"][0]
    statement.update(
        textZh="厂商公布了 99.7％ 的通过率。",
        textEn="The vendor reported 99.7% accuracy.",
    )
    service = CitedAnswerService(FakeGenerator(payload), enabled=True)
    result = service.answer("公开规格是什么？", citations, "zh")
    assert result.answer_mode == "extractive"
    assert "99.7%" not in result.summary and "99.7％" not in result.summary

    statement.update(
        textZh="上下文为 400 K tokens。",
        textEn="The model has a 400K token context window.",
    )
    assert service.answer("公开规格是什么？", citations, "zh").answer_mode == "extractive"

    statement.update(
        textZh="这项厂商比较的日期为 2025-09-29。",
        textEn="The cited comparison is dated 2025-09-29.",
    )
    assert service.answer("比较的日期是什么？", citations, "zh").answer_mode == "generated"


def test_generation_provider_error_falls_back_to_extractive():
    citations = grounded_citations()
    generator = FakeGenerator(fail=True)
    result = CitedAnswerService(generator, enabled=True).answer("问题", citations, "en")

    assert result.answer_mode == "extractive"
    assert result.fallback_reason == "generation-provider-error"
    assert generator.calls == 1


def test_generated_lead_sentence_is_validated_like_statements():
    citations = grounded_citations()
    payload = valid_payload(citations[0].claim.id)
    payload["summary"] = {
        "textZh": "就你的任务而言，可以先用它。",
        "textEn": "For your task, start with it.",
        "claimIds": [citations[0].claim.id],
    }
    result = CitedAnswerService(FakeGenerator(payload), enabled=True).answer(
        "问题", citations, "zh"
    )
    assert result.answer_mode == "generated"
    assert result.lead is not None and result.lead.text_zh == "就你的任务而言，可以先用它。"

    payload["summary"]["claimIds"] = ["claim-not-retrieved"]
    result = CitedAnswerService(FakeGenerator(payload), enabled=True).answer(
        "问题", citations, "zh"
    )
    assert result.answer_mode == "extractive" and result.lead is None
    assert result.fallback_reason == "generation-invalid"

    payload["summary"] = {
        "textZh": "它的通过率达到 99.7%。",
        "textEn": "It reaches 99.7% accuracy.",
        "claimIds": [citations[0].claim.id],
    }
    result = CitedAnswerService(FakeGenerator(payload), enabled=True).answer(
        "问题", citations, "zh"
    )
    assert result.answer_mode == "extractive"


def test_payload_without_lead_keeps_rule_summary():
    citations = grounded_citations()
    result = CitedAnswerService(
        FakeGenerator(valid_payload(citations[0].claim.id)), enabled=True
    ).answer("问题", citations, "zh")
    assert result.answer_mode == "generated" and result.lead is None
