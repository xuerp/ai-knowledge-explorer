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

from pydantic import ValidationError

from .answer_generation import _quoted_values
from .decision_constraints import constraint_failures, is_available_version
from .generation_runtime import ANALYSIS_INPUT_LIMIT, ModelInputTooLarge, compact_evidence
from .model_budget import ModelBudgetBusy, ModelBudgetUnavailable
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


class ModelLedRejected(ValueError):
    """Analysis rejected; `reason` is a short code safe to store and show to staff."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


# Output bounds the transport schema cannot express (maxItems/maxLength are
# stripped for the gateway), so oversized model output is trimmed, not rejected.
_LIST_LIMITS = {"candidates": 3, "tradeoffs": 3, "gaps": 4, "firstSteps": 3}
_POINT_LIMIT = 3
_TEXT_LIMITS = {
    "understoodTaskZh": 200,
    "understoodTaskEn": 320,
    "headlineZh": 120,
    "headlineEn": 200,
    "textZh": 240,
    "textEn": 400,
}


def _clip(value: str, limit: int) -> str:
    return value if len(value) <= limit else value[: limit - 1].rstrip() + "…"


def _trim_point(point):
    if not isinstance(point, dict):
        return point
    point = dict(point)
    for key in ("textZh", "textEn"):
        if isinstance(point.get(key), str):
            point[key] = _clip(point[key], _TEXT_LIMITS[key])
    if isinstance(point.get("claimIds"), list):
        point["claimIds"] = point["claimIds"][:4]
    return point


def parse_model_led(raw: str) -> tuple[ModelLedPayload, list[str]]:
    """Strictly validate after trimming over-long lists and text to the limits.

    Returns the payload and the trims applied, so a trim is recorded rather than
    silently changing what the model wrote.
    """
    import json

    try:
        data = json.loads(raw)
    except ValueError as error:
        raise ModelLedRejected("output-not-json") from error
    if not isinstance(data, dict):
        raise ModelLedRejected("output-not-object")
    trims: list[str] = []
    for key, limit in _TEXT_LIMITS.items():
        if isinstance(data.get(key), str) and len(data[key]) > limit:
            data[key] = _clip(data[key], limit)
            trims.append(f"text:{key}")
    if "summary" in data:
        data["summary"] = _trim_point(data["summary"])
    for key, limit in _LIST_LIMITS.items():
        items = data.get(key)
        if isinstance(items, list):
            if len(items) > limit:
                trims.append(f"list:{key}:{len(items)}>{limit}")
                items = items[:limit]
            if key == "candidates":
                trimmed = []
                for candidate in items:
                    if isinstance(candidate, dict) and isinstance(candidate.get("points"), list):
                        candidate = dict(candidate)
                        if len(candidate["points"]) > _POINT_LIMIT:
                            trims.append("list:candidate.points")
                        candidate["points"] = [
                            _trim_point(point) for point in candidate["points"][:_POINT_LIMIT]
                        ]
                    trimmed.append(candidate)
                items = trimmed
            else:
                items = [_trim_point(point) for point in items]
            data[key] = items
    try:
        return ModelLedPayload.model_validate(data), trims
    except ValidationError as error:
        first = error.errors()[0] if error.errors() else {}
        location = ".".join(str(part) for part in first.get("loc", ()))[:60]
        raise ModelLedRejected(f"schema:{first.get('type', 'invalid')}:{location}") from error


# A version continues a name when the next character extends it: a digit, a
# point, a hyphen or a letter. "GPT-5" is not mentioned by "GPT-5.4", and
# "Claude Opus 4" is not mentioned by "Claude Opus 4.5"; "GPT-5。" is.
_NAME_CONTINUES = re.compile(r"[0-9A-Za-z.\-_]")
# A space then a version number also extends it: "GPT Realtime 2.1".
_SPACED_VERSION = re.compile(r"\s+v?\d")


def mentions_name(text: str, name: str) -> bool:
    """True when `name` appears in `text` as a whole name, not inside a longer one."""
    needle = name.casefold()
    haystack = text.casefold()
    start = haystack.find(needle)
    while start != -1:
        before = haystack[start - 1] if start > 0 else ""
        after_index = start + len(needle)
        after = haystack[after_index] if after_index < len(haystack) else ""
        # ASCII names need a boundary on the left too ("xgpt-5" is another word).
        left_ok = not before or not (needle[:1].isascii() and _NAME_CONTINUES.match(before))
        extended = bool(after and _NAME_CONTINUES.match(after)) or bool(
            _SPACED_VERSION.match(haystack, after_index)
        )
        if left_ok and not extended:
            return True
        start = haystack.find(needle, start + 1)
    return False


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
        raise ModelLedRejected("refused")
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
    headline_problem = (
        "evidence-volume-ranking"
        if _RANKING.search(headline_text)
        else "unverified-free"
        if _claims_free(headline_text)
        else "value-absent-from-claims"
        if _quoted_values(payload.headline_zh, payload.headline_en) - all_values
        else None
    )
    # A pruned candidate must not survive in free text that recommends it. The
    # offending headline or summary is replaced below, never shown as written.
    summary_text = " ".join(_texts(payload.summary)).casefold()
    excluded_names = []
    for item in pruned:
        if not item.reason.startswith("hard-requirement:") or item.entity_id not in entities:
            continue
        entity = entities[item.entity_id]
        names = [
            name
            for name in {entity.name.zh, entity.name.en, *(entity.aliases or [])}
            if name and len(name) > 2
        ]
        excluded_names.append((entity.id, names))

    def names_excluded(text: str) -> str | None:
        for entity_id, names in excluded_names:
            if any(mentions_name(text, name) for name in names):
                return entity_id
        return None

    if headline_problem is None and (hit := names_excluded(headline_text.casefold())):
        headline_problem = "recommends-excluded:" + hit
    if summary_problem is None and (hit := names_excluded(summary_text)):
        summary_problem = "recommends-excluded:" + hit
    pick = (lambda zh, en: zh) if language == "zh" else (lambda zh, en: en)
    tradeoffs = keep(payload.tradeoffs, "tradeoffs")
    gaps = keep(payload.gaps, "gaps")
    first_steps = keep(payload.first_steps, "first_steps")
    summary = _line(payload.summary, language)
    if summary_problem:
        # Replace one bad lead sentence with the first compliant line instead of
        # discarding the whole analysis.
        pruned.append(ModelLedPrunedItem(section="summary", reason=summary_problem))
        fallback = next(
            (
                line
                for line in (
                    *(point for item in candidates for point in item.points),
                    *tradeoffs,
                    *first_steps,
                )
                # The stand-in must not reintroduce an excluded product either.
                if not names_excluded(line.text.casefold())
            ),
            None,
        )
        if fallback is None:
            raise ModelLedRejected("summary:" + summary_problem)
        summary = fallback
    headline = pick(payload.headline_zh, payload.headline_en)
    if headline_problem:
        pruned.append(ModelLedPrunedItem(section="headline", reason=headline_problem))
        primary = next((item for item in candidates if item.role == "primary"), None)
        if primary is None:
            raise ModelLedRejected("headline:" + headline_problem)
        name = entities[primary.entity_id].name
        headline = pick(f"可以先从 {name.zh} 开始", f"Start with {name.en}")
    return ModelLedAnalysis(
        understood_task=pick(payload.understood_task_zh, payload.understood_task_en),
        headline=headline,
        summary=summary,
        candidates=candidates,
        tradeoffs=tradeoffs,
        gaps=gaps,
        first_steps=first_steps,
        pruned=pruned,
    )


def catalog_digest(snapshot, citations: list[ResearchCitation], limit: int = 40) -> list[dict]:
    """Entities the model may name: retrieved ones first, then other current products."""
    retrieved = []
    for item in citations:
        if item.claim.entity_id and item.claim.entity_id not in retrieved:
            retrieved.append(item.claim.entity_id)
    entities = {entity.id: entity for entity in snapshot.entities}
    # Only available versions may be proposed, retrieved or not; previews count.
    ordered = [
        entities[key]
        for key in retrieved
        if key in entities and is_available_version(entities[key])
    ] + [
        entity
        for entity in snapshot.entities
        if entity.id not in retrieved
        and is_available_version(entity)
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
    __slots__ = ("analysis", "attempts", "citations", "detail", "fallback_reason")

    def __init__(
        self,
        analysis: ModelLedAnalysis | None,
        fallback_reason: str | None,
        citations: list[ResearchCitation] | None = None,
        *,
        detail: str | None = None,
        attempts: int = 0,
    ):
        self.analysis = analysis
        self.fallback_reason = fallback_reason
        # Evidence supplied to the model; saved so every cited source resolves.
        self.citations = citations or []
        # Short rule/field code for the last failure; never task text or model output.
        self.detail = detail
        self.attempts = attempts


# Only output-shape problems are worth one corrective retry. Provider faults,
# budget refusals and real rule violations would fail the same way again.
_RETRYABLE = (
    "output-not-json",
    "output-not-object",
    "schema:",
    # A truncated or overlong answer: retry once and ask for a shorter one.
    "transport:unfinished-response",
    "transport:response-too-long",
)


def run_model_led(
    generator, task, citations, snapshot, context, language, *, user_id=None
) -> ModelLedOutcome:
    """One budgeted call. Any failure returns a reason; the caller keeps the rule path."""
    if generator is None or not hasattr(generator, "analyze"):
        return ModelLedOutcome(None, "model-led-unavailable")
    allows_user = getattr(generator, "allows_user", None)
    if allows_user is not None and not allows_user(user_id):
        # Invite-only account scope, not a provider fault; no budget is reserved.
        return ModelLedOutcome(None, "generation-not-entitled")
    requirements = (
        context.model_dump(mode="json", by_alias=True, exclude={"notes", "parent_research_id"})
        if context is not None
        else None
    )
    citations, catalog = fit_request(task, citations, snapshot, requirements, language)
    previous_error = None
    attempts = 0
    for _ in range(2):
        attempts += 1
        try:
            raw = generator.analyze(
                task,
                citations,
                language,
                user_id=user_id,
                context=requirements,
                catalog=catalog,
                **({"previous_error": previous_error} if previous_error else {}),
            )
            payload, trims = parse_model_led(raw)
            analysis = validate_model_led(payload, citations, snapshot, context, language)
            analysis.pruned.extend(
                ModelLedPrunedItem(section="output", reason="trimmed:" + item) for item in trims
            )
            return ModelLedOutcome(analysis, None, citations, attempts=attempts)
        except ModelInputTooLarge:
            return ModelLedOutcome(None, "model-led-too-large", attempts=attempts)
        except ModelBudgetBusy:
            return ModelLedOutcome(None, "model-led-busy", attempts=attempts)
        except ModelBudgetUnavailable:
            return ModelLedOutcome(None, "model-led-unavailable", attempts=attempts)
        except ModelLedRejected as error:
            if attempts == 1 and error.reason.startswith(_RETRYABLE):
                previous_error = error.reason
                continue
            return ModelLedOutcome(
                None, "model-led-invalid", detail=error.reason, attempts=attempts
            )
        except (ValueError, TypeError) as error:
            # The generator's own transport validation; the code is in the message.
            reason = _short_reason(error)
            if attempts == 1 and reason.startswith(_RETRYABLE):
                previous_error = reason
                continue
            return ModelLedOutcome(None, "model-led-invalid", detail=reason, attempts=attempts)
        except Exception as error:  # noqa: BLE001 -- provider faults must not leak or break research
            return ModelLedOutcome(
                None,
                "model-led-provider-error",
                detail="provider:" + type(error).__name__,
                attempts=attempts,
            )
    return ModelLedOutcome(None, "model-led-invalid", detail=previous_error, attempts=attempts)


# Fixed transport messages mapped to stable codes. Nothing from the model or the
# user is copied into a stored reason.
_TRANSPORT_REASONS = {
    "did not finish normally": "transport:unfinished-response",
    "Unexpected response content blocks": "transport:content-blocks",
    "usage receipt": "transport:usage-receipt",
    "allocation is closed": "transport:allocation-closed",
    "exceeds its bound": "transport:response-too-long",
    "Invalid structured response": "transport:invalid-structure",
}


def _short_reason(error: Exception) -> str:
    reason = getattr(error, "reason", None)
    if isinstance(reason, str):
        return reason
    message = str(error)
    for fragment, code in _TRANSPORT_REASONS.items():
        if fragment in message:
            return code
    return "error:" + type(error).__name__


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
