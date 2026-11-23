"""Model-led decision analysis: the model proposes, the host validates.

Hard constraints (docs/HANDOFF_DECISION_MODEL_LED_20261122.md):
1. A `verified` point must cite supplied grounded claims; quoted numbers, dates
   and token counts must appear in those claims.
2. A candidate that violates an explicit hard requirement is pruned.
3. Unknown price is never "free"; evidence volume is never a capability ranking.
4. A `model-knowledge` point carries no citation and no concrete price,
   benchmark score or release date.
"""

from __future__ import annotations

import re

from .answer_generation import _quoted_values
from .decision_constraints import constraint_failures
from .generation_runtime import ANALYSIS_INPUT_LIMIT, ModelInputTooLarge, compact_evidence
from .model_budget import ModelBudgetUnavailable
from .schemas import (
    DecisionModelLedCandidate,
    DecisionModelLedLine,
    ModelLedAnalysis,
    ModelLedPayload,
    ModelLedPoint,
    ModelLedPrunedItem,
    ResearchCitation,
)

# Failures that mean the reviewed evidence CONTRADICTS a user requirement, or the
# user excluded the candidate. "Unverified" failures are not violations here:
# the model may still discuss the candidate, labelled as unverified.
VIOLATIONS = frozenset(
    {
        "excluded",
        "data-boundary-violated",
        "commercial-use-prohibited",
        "over-budget",
        "context-too-small",
        "unavailable-version",
        "billing-channel-mismatch",
    }
)

_FREE = re.compile(r"免费|不收费|零成本|\bfree\b|no cost|zero cost", re.IGNORECASE)
_NEGATED_FREE = re.compile(
    r"(?:不|非|并非|未必|不是|不代表|不等于|不能当成|不要当成|别当成)[^，,。；;]{0,4}免费"
    r"|\b(?:not|isn't|is not|never|no)\s+(?:\w+\s+){0,2}free\b",
    re.IGNORECASE,
)
_RANKING = re.compile(
    r"资料最多|证据最多|引用最多|最多的(资料|证据)|more evidence (means|so)|most (cited|evidence)",
    re.IGNORECASE,
)
_PRICE = re.compile(r"[$¥￥€]\s*\d|\d+(?:\.\d+)?\s*(?:元|美元|美金|usd|cny|rmb)", re.IGNORECASE)
_SCORE = re.compile(r"\d+(?:\.\d+)?\s*(?:%|％|分\b|points?\b)", re.IGNORECASE)
_DATE = re.compile(r"\b(?:19|20)\d{2}[-/年.]\s*\d{1,2}|\b(?:19|20)\d{2}\s*年")


def _claims_free(text: str) -> bool:
    """True when text asserts something is free; negated warnings do not count."""
    return bool(_FREE.search(_NEGATED_FREE.sub(" ", text)))


def _texts(point: ModelLedPoint) -> tuple[str, str]:
    return point.text_zh, point.text_en


def point_problem(point: ModelLedPoint, citations: dict[str, ResearchCitation]) -> str | None:
    """Return why a point must be dropped, or None when it may be shown."""
    joined = " ".join(_texts(point))
    if _RANKING.search(joined):
        return "evidence-volume-ranking"
    if point.basis == "model-knowledge":
        if point.claim_ids:
            return "model-knowledge-cited"
        if _PRICE.search(joined) or _SCORE.search(joined) or _DATE.search(joined):
            return "model-knowledge-specific-value"
        if _claims_free(joined):
            return "unverified-free"
        return None
    if not point.claim_ids:
        return "verified-without-citation"
    supported: set[str] = set()
    for claim_id in point.claim_ids:
        citation = citations.get(claim_id)
        if citation is None:
            return "unknown-claim"
        if not citation.evidence:
            return "claim-without-evidence"
        claim = citation.claim
        supported |= _quoted_values(
            claim.text.zh,
            claim.text.en,
            claim.object_or_value or "",
            claim.valid_from or "",
            claim.valid_to or "",
        )
    if _quoted_values(*_texts(point)) - supported:
        return "value-absent-from-claims"
    if _claims_free(joined) and not any(
        _claims_free(citations[key].claim.text.zh + " " + citations[key].claim.text.en)
        for key in point.claim_ids
    ):
        return "unverified-free"
    return None


def _line(point: ModelLedPoint, language: str) -> DecisionModelLedLine:
    return DecisionModelLedLine(
        basis=point.basis,
        text=point.text_zh if language == "zh" else point.text_en,
        claim_ids=list(point.claim_ids),
    )


def validate_model_led(
    payload: ModelLedPayload,
    citations: list[ResearchCitation],
    snapshot,
    context,
    language: str,
) -> ModelLedAnalysis:
    """Prune non-compliant content. Raise ValueError when nothing safe remains."""
    if payload.refused:
        raise ValueError("Model refused the analysis.")
    by_claim = {item.claim.id: item for item in citations}
    entities = {entity.id: entity for entity in snapshot.entities}
    claims_by_entity: dict[str, list] = {}
    for item in citations:
        if item.claim.entity_id:
            claims_by_entity.setdefault(item.claim.entity_id, []).append(item.claim)
    pruned: list[ModelLedPrunedItem] = []

    def keep(points, section, entity_id=None):
        kept = []
        for point in points:
            problem = point_problem(point, by_claim)
            if problem:
                pruned.append(
                    ModelLedPrunedItem(section=section, entity_id=entity_id, reason=problem)
                )
            else:
                kept.append(_line(point, language))
        return kept

    summary_problem = point_problem(payload.summary, by_claim)
    if summary_problem:
        raise ValueError(f"Summary rejected: {summary_problem}")

    candidates: list[DecisionModelLedCandidate] = []
    seen: set[str] = set()
    for proposal in payload.candidates:
        entity = entities.get(proposal.entity_id)
        if entity is None or proposal.entity_id in seen:
            pruned.append(
                ModelLedPrunedItem(
                    section="candidates", entity_id=proposal.entity_id, reason="unknown-entity"
                )
            )
            continue
        seen.add(proposal.entity_id)
        if context is not None:
            violated = VIOLATIONS.intersection(
                constraint_failures(entity, claims_by_entity.get(entity.id, []), context)
            )
            if violated:
                pruned.append(
                    ModelLedPrunedItem(
                        section="candidates",
                        entity_id=entity.id,
                        reason="hard-requirement:" + ",".join(sorted(violated)),
                    )
                )
                continue
        points = keep(proposal.points, "candidates", entity.id)
        if points:
            candidates.append(
                DecisionModelLedCandidate(entity_id=entity.id, role=proposal.role, points=points)
            )
    if candidates and not any(item.role == "primary" for item in candidates):
        candidates[0].role = "primary"
    headline_text = payload.headline_zh + " " + payload.headline_en
    all_values: set[str] = set()
    for item in citations:
        all_values |= _quoted_values(
            item.claim.text.zh, item.claim.text.en, item.claim.object_or_value or ""
        )
    if (
        _RANKING.search(headline_text)
        or _claims_free(headline_text)
        or _quoted_values(payload.headline_zh, payload.headline_en) - all_values
    ):
        raise ValueError("Headline rejected.")
    # A pruned candidate must not survive in free text that recommends it.
    lead_text = (headline_text + " " + " ".join(_texts(payload.summary))).casefold()
    for item in pruned:
        if not item.reason.startswith("hard-requirement:") or item.entity_id not in entities:
            continue
        entity = entities[item.entity_id]
        names = {entity.name.zh, entity.name.en, *(entity.aliases or [])}
        if any(name and len(name) > 2 and name.casefold() in lead_text for name in names):
            raise ValueError("Lead text recommends a candidate excluded by a hard requirement.")
    pick = (lambda zh, en: zh) if language == "zh" else (lambda zh, en: en)
    return ModelLedAnalysis(
        understood_task=pick(payload.understood_task_zh, payload.understood_task_en),
        headline=pick(payload.headline_zh, payload.headline_en),
        summary=_line(payload.summary, language),
        candidates=candidates,
        tradeoffs=keep(payload.tradeoffs, "tradeoffs"),
        gaps=keep(payload.gaps, "gaps"),
        first_steps=keep(payload.first_steps, "first_steps"),
        pruned=pruned,
    )


def catalog_digest(snapshot, citations: list[ResearchCitation], limit: int = 40) -> list[dict]:
    """Entities the model may name: retrieved ones first, then other current products."""
    retrieved = []
    for item in citations:
        if item.claim.entity_id and item.claim.entity_id not in retrieved:
            retrieved.append(item.claim.entity_id)
    entities = {entity.id: entity for entity in snapshot.entities}
    ordered = [entities[key] for key in retrieved if key in entities] + [
        entity
        for entity in snapshot.entities
        if entity.id not in retrieved
        and entity.status == "active"
        and entity.type not in {"company", "paper", "benchmark", "dataset"}
    ]
    return [
        {
            "entityId": entity.id,
            "type": entity.type,
            "name": entity.name.en,
            "vendor": entity.vendor,
            "tags": entity.tags[:6],
        }
        for entity in ordered[:limit]
    ]


class ModelLedOutcome:
    __slots__ = ("analysis", "citations", "fallback_reason")

    def __init__(
        self,
        analysis: ModelLedAnalysis | None,
        fallback_reason: str | None,
        citations: list[ResearchCitation] | None = None,
    ):
        self.analysis = analysis
        self.fallback_reason = fallback_reason
        # Evidence supplied to the model; saved so every cited source resolves.
        self.citations = citations or []


def run_model_led(
    generator, task, citations, snapshot, context, language, *, user_id=None
) -> ModelLedOutcome:
    """One budgeted call. Any failure returns a reason; the caller keeps the rule path."""
    if generator is None or not hasattr(generator, "analyze"):
        return ModelLedOutcome(None, "model-led-unavailable")
    requirements = (
        context.model_dump(mode="json", by_alias=True, exclude={"notes", "parent_research_id"})
        if context is not None
        else None
    )
    citations, catalog = fit_request(task, citations, snapshot, requirements, language)
    try:
        raw = generator.analyze(
            task,
            citations,
            language,
            user_id=user_id,
            context=requirements,
            catalog=catalog,
        )
        payload = ModelLedPayload.model_validate_json(raw)
        analysis = validate_model_led(payload, citations, snapshot, context, language)
    except ModelInputTooLarge:
        return ModelLedOutcome(None, "model-led-too-large")
    except ModelBudgetUnavailable:
        return ModelLedOutcome(None, "model-led-unavailable")
    except (ValueError, TypeError):
        return ModelLedOutcome(None, "model-led-invalid")
    except Exception:  # noqa: BLE001 -- provider failures must not leak or break research
        return ModelLedOutcome(None, "model-led-provider-error")
    return ModelLedOutcome(analysis, None, citations)


# Instruction text and request envelope, measured generously.
_INSTRUCTION_BYTES = 4000


def request_size(task, citations, catalog, requirements, language) -> int:
    """Same conservative bound as BudgetedAnswerGenerator.invoke uses."""
    import json

    schema = json.dumps(ModelLedPayload.model_json_schema(by_alias=True))
    body = json.dumps(
        {
            "task": task,
            "language": language,
            "requirements": requirements,
            "catalog": catalog,
            "evidence": [compact_evidence(item) for item in citations],
        },
        ensure_ascii=False,
    )
    return len(body.encode()) + 2 * len(schema.encode()) + _INSTRUCTION_BYTES + 4096


def fit_request(task, citations, snapshot, requirements, language):
    """Drop the lowest-ranked evidence, then catalog rows, until the request fits."""
    citations = list(citations)
    catalog = catalog_digest(snapshot, citations)
    while request_size(task, citations, catalog, requirements, language) > ANALYSIS_INPUT_LIMIT:
        if len(citations) > 8:
            citations.pop()
            catalog = catalog_digest(snapshot, citations, limit=len(catalog))
        elif len(catalog) > 10:
            catalog = catalog[:-5]
        else:
            break
    return citations, catalog
