"""Compare reviewed spec facts with the curated entity card.

The card keeps its curated wording; extracted facts use whatever the source
wrote ("$10 USD per MTok" vs "$10 / 1M tokens"). So a fact never overwrites a
card field. Each field instead reports its latest reviewed basis, and a fact
whose normalized value really differs from the card is listed for an
administrator to adopt. Values that are sentences or identifiers, not specs,
are ignored.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .schemas import Claim, Entity

SPEC_FIELDS = ("context_window", "input_price", "output_price", "released_at")

_FIELD_PREDICATES: dict[str, re.Pattern[str]] = {
    "context_window": re.compile(r"context[- ]?(window|length)|max(imum)?[- ]?context"),
    "input_price": re.compile(r"input[- ]?price|price[- ]?input|prompt[- ]?price"),
    "output_price": re.compile(r"output[- ]?price|price[- ]?output|completion[- ]?price"),
    "released_at": re.compile(r"^(release|released-on|launched-on|release-date)$"),
}
# Historical prices and channel-specific limits describe another time or scope.
_EXCLUDED = re.compile(r"historical|channel|promo|batch|cached|unverified")

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def spec_field_for(claim: Claim) -> str | None:
    predicate = (claim.predicate or "").casefold()
    if not predicate or _EXCLUDED.search(predicate):
        return None
    for field, pattern in _FIELD_PREDICATES.items():
        if pattern.search(predicate):
            return field
    return None


_SCALE = {"k": 1_000, "m": 1_000_000}


def _token_count(text: str) -> int | None:
    """1M / 128K / 1,048,576 tokens -> int. Treat 1M and 1,048,576 as the same size."""
    compact = text.replace(",", "").casefold()
    match = re.search(r"(\d+(?:\.\d+)?)\s*([km])\b", compact)
    if match:
        return int(float(match.group(1)) * _SCALE[match.group(2)])
    match = re.search(r"\b(\d{4,9})\b", compact)
    return int(match.group(1)) if match else None


def _same_tokens(left: int, right: int) -> bool:
    # 1M is written for both 1,000,000 and 1,048,576; 128K for 128,000 and 131,072.
    return abs(left - right) <= max(left, right) * 0.05


def _price(text: str) -> float | None:
    """Return the USD amount for one million tokens, or None if not a single price."""
    compact = text.replace(",", "")
    amounts = re.findall(
        r"\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:usd|美元)|usd\s*(\d+(?:\.\d+)?)",
        compact,
        re.IGNORECASE,
    )
    values = {float(a or b or c) for a, b, c in amounts}
    return values.pop() if len(values) == 1 else None


def normalized_spec(field: str, value: str | None) -> float | int | str | None:
    text = (value or "").strip()
    # Sentences and identifiers are not spec values; never compare them.
    if not text or len(text) > 80 or re.search(r"[。，；！？]", text):
        return None
    if field == "released_at":
        return text if _DATE.match(text) else None
    if field == "context_window":
        return _token_count(text)
    return _price(text)


def same_spec(field: str, left, right) -> bool:
    if field == "context_window":
        return _same_tokens(left, right)
    if field in {"input_price", "output_price"}:
        return abs(left - right) < 0.005
    return left == right


def card_value(entity: Entity, field: str) -> str | None:
    if field == "released_at":
        return (entity.release.released_at if entity.release else None) or entity.first_released_at
    return getattr(entity.specs, field, None) if entity.specs else None


@dataclass(frozen=True, slots=True)
class SpecBasis:
    field: str
    card_value: str | None
    claim: Claim
    differs: bool


def spec_basis(entity: Entity, claims: list[Claim]) -> list[SpecBasis]:
    """Latest comparable reviewed fact per card field, and whether it differs."""
    latest: dict[str, Claim] = {}
    for claim in claims:
        if claim.entity_id != entity.id or claim.confidence != "verified":
            continue
        field = spec_field_for(claim)
        if field is None or normalized_spec(field, claim.object_or_value) is None:
            continue
        stamp = claim.valid_from or claim.updated_at or ""
        current = latest.get(field)
        if current is None or stamp > (current.valid_from or current.updated_at or ""):
            latest[field] = claim
    result = []
    for field in SPEC_FIELDS:
        claim = latest.get(field)
        if claim is None:
            continue
        shown = card_value(entity, field)
        fact = normalized_spec(field, claim.object_or_value)
        card = normalized_spec(field, shown)
        # Only a comparable card value can be "outdated"; a free-text card stays as is.
        differs = card is not None and not same_spec(field, fact, card)
        result.append(SpecBasis(field=field, card_value=shown, claim=claim, differs=differs))
    return result


def spec_update_candidates(snapshot) -> list[tuple[Entity, SpecBasis]]:
    """Card fields whose latest reviewed fact differs from the curated value."""
    return [
        (entity, basis)
        for entity in snapshot.entities
        for basis in spec_basis(entity, snapshot.claims)
        if basis.differs
    ]


def adopt_spec(entity: Entity, field: str, value: str) -> Entity:
    """Return a copy of the entity with one card field set to an adopted value."""
    from .schemas import EntitySpecs

    if field == "released_at":
        if not _DATE.match(value):
            raise ValueError("A release date must be YYYY-MM-DD.")
        if entity.release:
            return entity.model_copy(
                update={"release": entity.release.model_copy(update={"released_at": value})}
            )
        return entity.model_copy(update={"first_released_at": value})
    if field not in SPEC_FIELDS:
        raise ValueError(f"Unsupported spec field: {field}")
    specs = entity.specs or EntitySpecs()
    return entity.model_copy(update={"specs": specs.model_copy(update={field: value})})
