from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

from pydantic import ValidationError

from .schemas import GeneratedAnswerPayload, ResearchCitation


class AnswerGenerator(Protocol):
    def generate(
        self,
        question: str,
        citations: list[ResearchCitation],
        language: Literal["zh", "en"],
    ) -> str: ...


@dataclass(frozen=True, slots=True)
class AnswerResult:
    summary: str
    answer_mode: Literal["extractive", "generated"]
    fallback_reason: str | None = None


class CitedAnswerService:
    """验证生成结果只能引用本次检索到且具备直接 Evidence 的 Claim。"""

    def __init__(
        self,
        generator: AnswerGenerator | None = None,
        *,
        enabled: bool = False,
    ) -> None:
        self.generator = generator
        self.enabled = enabled

    def answer(
        self,
        question: str,
        citations: list[ResearchCitation],
        language: Literal["zh", "en"],
    ) -> AnswerResult:
        extractive = self._extractive(citations, language)
        if not citations:
            return AnswerResult(extractive, "extractive", "insufficient-evidence")
        if not self.enabled:
            return AnswerResult(extractive, "extractive", "generation-disabled")
        if self.generator is None:
            return AnswerResult(extractive, "extractive", "generation-unavailable")

        try:
            raw = self.generator.generate(question, citations, language)
            payload = GeneratedAnswerPayload.model_validate_json(raw)
            self._validate_citations(payload, citations)
        except (ValidationError, ValueError, TypeError):
            return AnswerResult(extractive, "extractive", "generation-invalid")
        except Exception:  # noqa: BLE001 -- 第三方生成服务异常必须统一回退抽取式回答。
            return AnswerResult(extractive, "extractive", "generation-provider-error")

        if payload.refused:
            refusal = payload.refusal_reason or (
                "当前证据不足，无法生成可靠结论。"
                if language == "zh"
                else "The available evidence is insufficient for a reliable answer."
            )
            return AnswerResult(refusal, "generated")
        return AnswerResult(
            payload.answer_zh if language == "zh" else payload.answer_en,
            "generated",
        )

    @staticmethod
    def _validate_citations(
        payload: GeneratedAnswerPayload,
        citations: list[ResearchCitation],
    ) -> None:
        evidence_by_claim = {item.claim.id: item.evidence for item in citations}
        if not payload.refused and not payload.statements:
            raise ValueError("A non-refusal answer must contain cited statements.")
        for statement in payload.statements:
            for claim_id in statement.claim_ids:
                if claim_id not in evidence_by_claim:
                    raise ValueError("Generated answer referenced an unknown claim.")
                if not evidence_by_claim[claim_id]:
                    raise ValueError("Generated answer referenced a claim without evidence.")

    @staticmethod
    def _extractive(
        citations: list[ResearchCitation],
        language: Literal["zh", "en"],
    ) -> str:
        if citations:
            statements = [
                item.claim.text.zh if language == "zh" else item.claim.text.en for item in citations
            ]
            return "\n\n".join(f"- {statement}" for statement in statements)
        return (
            "当前已审核图谱没有足够证据回答此问题，系统未生成推测性结论。"
            if language == "zh"
            else "The reviewed graph has insufficient evidence; no speculative answer was generated."
        )
