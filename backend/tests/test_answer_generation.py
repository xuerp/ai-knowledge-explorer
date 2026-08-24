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

    def generate(self, question, citations, language):
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
    assert result.summary == "GPT-5 的相关表现已有官方证据支持。"
    assert result.fallback_reason is None
    assert generator.calls == 1


def test_unknown_claim_or_invalid_schema_falls_back_to_extractive():
    citations = grounded_citations()
    payload = valid_payload("claim-not-retrieved")
    payload["unexpected"] = "strict schema must reject this"
    generator = FakeGenerator(payload)
    result = CitedAnswerService(generator, enabled=True).answer("问题", citations, "zh")

    assert result.answer_mode == "extractive"
    assert result.fallback_reason == "generation-invalid"
    assert result.summary.startswith("- ")


def test_generation_provider_error_falls_back_to_extractive():
    citations = grounded_citations()
    generator = FakeGenerator(fail=True)
    result = CitedAnswerService(generator, enabled=True).answer("问题", citations, "en")

    assert result.answer_mode == "extractive"
    assert result.fallback_reason == "generation-provider-error"
    assert generator.calls == 1
