"""Place a newly announced model in the catalog by analogy with its siblings.

An extracted release of an unknown model ("Claude Fable 5.2") would otherwise
be dropped because no entity owns it. The closest existing release is the one
whose name shares the longest leading run of words ("Claude Fable"), limited to
the source publisher's family. That sibling supplies the family, product line,
vendor and origin. Without a confident sibling no entity is proposed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .schemas import Entity

_RELEASE_PREDICATES = re.compile(
    r"^(release|released|released-on|launched|launched-as|launched-on|announced-on|introduced-on|available-in)$"
)
_STATUS_WORDS = re.compile(r"historical|unverified|deprecat|retire|shutdown")


def is_release_predicate(predicate: str | None) -> bool:
    value = (predicate or "").casefold()
    return bool(_RELEASE_PREDICATES.match(value)) and not _STATUS_WORDS.search(value)


def _words(name: str) -> list[str]:
    return [token for token in re.split(r"[\s_]+", name.casefold().strip()) if token]


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-")


@dataclass(frozen=True, slots=True)
class NewModelPlacement:
    entity_id: str
    slug: str
    name: str
    family_id: str
    # A sibling in the same product line, when the name says so; None places only the family.
    sibling_id: str | None


def place_new_model(
    name: str, publisher: str | None, entities: list[Entity]
) -> NewModelPlacement | None:
    """Return where an unknown model belongs, or None when no sibling is close enough.

    The new name must share at least two leading words with a concrete release in
    one family (or one word when that word is the whole family prefix, e.g. GLM-5.3),
    and the family vendor must match the source publisher when one is known.
    """
    words = _words(name)
    if len(words) < 1 or len(name) > 80:
        return None
    slug = _slug(name)
    if any(entity.slug == slug or _slug(entity.name.en) == slug for entity in entities):
        return None
    families = {entity.id: entity for entity in entities if entity.family_id is None}
    best: tuple[int, Entity] | None = None
    for entity in entities:
        if not entity.family_id or entity.type != "model" or not entity.release:
            continue
        family = families.get(entity.family_id)
        if family is None:
            continue
        if publisher and family.vendor and not _same_vendor(publisher, family.vendor):
            continue
        sibling = _words(entity.name.en)
        shared = 0
        for left, right in zip(words, sibling):
            if left != right:
                break
            shared += 1
        # "GLM-5.3" vs "GLM-5.2": one word, so compare the prefix before the version.
        if shared == 0 and _stem(words[0]) and _stem(words[0]) == _stem(sibling[0]):
            shared = 1
        # Same name with the version numbers removed: "GPT-6.3 Sol" ~ "GPT-6.2 Sol".
        if _shape(words) == _shape(sibling) and len(words) > 1:
            shared = max(shared, len(words))
        if shared == 0:
            continue
        # Prefer the closest name, then the same variant word (Sol, Flash), then
        # the most recent release: GPT-6.3 Sol sits next to GPT-6.2 Sol, not GPT-4.1.
        score = (
            shared,
            int(words[-1] == sibling[-1]),
            entity.release.released_at or entity.first_released_at or "",
        )
        if best is None or score > best[0]:
            best = (score, entity)
    if best is None:
        return None
    score, sibling = best
    # A shared brand word alone ("Claude", "Kimi") places the family but not the
    # product line; the new entity then starts without a line.
    same_line = score[0] >= 2 or (len(words) == 1 and score[0] == 1)
    return NewModelPlacement(
        entity_id=f"e-{slug}",
        slug=slug,
        name=name.strip(),
        family_id=sibling.family_id,
        sibling_id=sibling.id if same_line else None,
    )


def _shape(words: list[str]) -> tuple[str, ...]:
    return tuple(re.sub(r"\d+(?:\.\d+)*", "#", word) for word in words)


def _stem(word: str) -> str:
    """'glm-5.3' -> 'glm'; 'gpt-6.2' -> 'gpt'. Only an alphabetic stem counts."""
    match = re.match(r"([a-z]+)[-]?\d", word)
    return match.group(1) if match else ""


def _same_vendor(publisher: str, vendor: str) -> bool:
    left, right = publisher.casefold(), vendor.casefold()
    return left in right or right in left or left.split()[0] == right.split()[0]


_MODEL_ID = re.compile(r"`([a-z0-9][a-z0-9._-]{2,80})`|\(([a-z0-9][a-z0-9._-]*-[a-z0-9._-]+)\)")


def model_id_from(excerpt: str | None, name: str) -> str | None:
    """The API id quoted next to the name in the source ('`claude-fable-5-2`'), if any."""
    wanted = _slug(name).replace("-", "")
    for match in _MODEL_ID.finditer(excerpt or ""):
        candidate = match.group(1) or match.group(2)
        if (
            candidate.replace("-", "")
            .replace(".", "")
            .startswith(wanted[: max(4, len(wanted) - 2)])
        ):
            return candidate
    return None


def build_new_model(
    placement: NewModelPlacement,
    entities: list[Entity],
    *,
    released_at: str | None,
    summary: str,
    model_id: str | None,
    official_url: str,
    verified_on: str,
) -> Entity:
    """A minimal, reviewable model release; later reviewed facts fill in the rest."""
    from .schemas import LocalizedText, ModelAccessChannel, ModelReleaseMetadata

    family = next(entity for entity in entities if entity.id == placement.family_id)
    sibling = next((entity for entity in entities if entity.id == placement.sibling_id), None)
    sibling_release = sibling.release if sibling else None
    generation, _, variant = placement.name.rpartition(" ")
    release = ModelReleaseMetadata(
        generation=generation or placement.name,
        variant=variant or placement.name,
        release_id=model_id or placement.slug,
        api_model_ids=[model_id] if model_id else [],
        stage="stable",
        product_line=sibling_release.product_line if sibling_release else None,
        catalog_current=True,
        released_at=released_at,
        last_verified_at=verified_on,
        access_channels=[
            ModelAccessChannel(
                type="official-api",
                provider=family.vendor or "",
                model_id=model_id,
                url=official_url,
            )
        ]
        if model_id
        else [],
    )
    return Entity(
        id=placement.entity_id,
        type="model",
        slug=placement.slug,
        name=LocalizedText(zh=placement.name, en=placement.name),
        summary=LocalizedText(zh=summary, en=summary),
        vendor=family.vendor,
        origin=family.origin,
        status="active",
        tags=list(dict.fromkeys([*(sibling.tags[:3] if sibling else []), "新发布"])),
        first_released_at=released_at,
        last_updated_at=verified_on,
        aliases=[model_id] if model_id else None,
        family_id=family.id,
        release=release,
    )
