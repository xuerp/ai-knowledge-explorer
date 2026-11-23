from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal, Protocol

from pydantic import ValidationError

from .schemas import GeneratedAnswerPayload, GeneratedAnswerStatement, ResearchCitation

_QUOTED_VALUES = re.compile(
    r"(?<![\d.])(?:\d{4}-\d{2}-\d{2}(?!\d)|"
    r"\d+(?:,\d{3})*(?:\.\d+)?\s*(?:[%％]|[kmb]?\s*(?:tokens?\b|词元)))",
    re.IGNORECASE,
)


def _quoted_values(*texts: str) -> set[str]:
    return {
        re.sub(r"[,\s]", "", match.group().lower())
        .replace("％", "%")
        .replace("词元", "token")
        .removesuffix("s")
        for text in texts
        for match in _QUOTED_VALUES.finditer(text)
    }


class AnswerGenerator(Protocol):
    def generate(
        self,
        question: str,
        citations: list[ResearchCitation],
        language: Literal["zh", "en"],
        *,
        user_id: str | None = None,
        context: dict | None = None,
    ) -> str: ...


@dataclass(frozen=True, slots=True)
class AnswerResult:
    summary: str
    answer_mode: Literal["extractive", "generated"]
    fallback_reason: str | None = None
    statements: tuple[GeneratedAnswerStatement, ...] = ()
    lead: GeneratedAnswerStatement | None = None


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
        *,
        user_id: str | None = None,
        context: dict | None = None,
    ) -> AnswerResult:
        extractive = self._extractive(citations, language)
        if not citations:
            return AnswerResult(extractive, "extractive", "insufficient-evidence")
        if not self.enabled:
            return AnswerResult(extractive, "extractive", "generation-disabled")
        if self.generator is None:
            return AnswerResult(extractive, "extractive", "generation-unavailable")
        allows_user = getattr(self.generator, "allows_user", None)
        if allows_user is not None and not allows_user(user_id):
            # Model answers are invite-only; this is an account scope, not a service fault.
            return AnswerResult(extractive, "extractive", "generation-not-entitled")

        try:
            raw = self.generator.generate(
                question, citations, language, user_id=user_id, context=context
            )
            payload = GeneratedAnswerPayload.model_validate_json(raw)
            self._validate_citations(payload, citations)
        except (ValidationError, ValueError, TypeError):
            return AnswerResult(extractive, "extractive", "generation-invalid")
        except Exception:  # noqa: BLE001 -- 第三方生成服务异常必须统一回退抽取式回答。
            return AnswerResult(extractive, "extractive", "generation-provider-error")

        if payload.refused:
            refusal = (
                "当前证据不足，无法生成可靠结论。"
                if language == "zh"
                else "The available evidence is insufficient for a reliable answer."
            )
            return AnswerResult(refusal, "extractive", "generation-insufficient-evidence")
        return AnswerResult(
            "\n\n".join(
                statement.text_zh if language == "zh" else statement.text_en
                for statement in payload.statements
            ),
            "generated",
            statements=tuple(payload.statements),
            lead=payload.summary,
        )

    @staticmethod
    def _validate_citations(
        payload: GeneratedAnswerPayload,
        citations: list[ResearchCitation],
    ) -> None:
        citations_by_claim = {item.claim.id: item for item in citations}
        if not payload.refused and not payload.statements:
            raise ValueError("A non-refusal answer must contain cited statements.")
        # The lead sentence is held to the same citation and value rules.
        checked = [*payload.statements, *([payload.summary] if payload.summary else [])]
        for statement in checked:
            supported_values: set[str] = set()
            for claim_id in statement.claim_ids:
                citation = citations_by_claim.get(claim_id)
                if citation is None:
                    raise ValueError("Generated answer referenced an unknown claim.")
                if not citation.evidence:
                    raise ValueError("Generated answer referenced a claim without evidence.")
                claim = citation.claim
                supported_values |= _quoted_values(
                    claim.text.zh,
                    claim.text.en,
                    claim.object_or_value or "",
                    claim.valid_from or "",
                    claim.valid_to or "",
                )
            if _quoted_values(statement.text_zh, statement.text_en) - supported_values:
                raise ValueError(
                    "Generated answer used a numeric value absent from its cited claims."
                )

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
