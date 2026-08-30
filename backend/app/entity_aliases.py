from __future__ import annotations

import hashlib
import json
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from .schemas import Entity

ALIAS_TYPES = {
    "abbreviation",
    "product-name",
    "qualified-name",
    "spelling-variant",
    "translation",
    "version-name",
    "other",
}


@dataclass(frozen=True, slots=True)
class EntityAliasDefinition:
    entity_id: str
    alias: str
    alias_type: str


def normalize_entity_alias(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold().replace("_", " ")
    return " ".join(normalized.split())


def load_entity_alias_catalog(
    path: Path,
) -> tuple[str, tuple[EntityAliasDefinition, ...], str]:
    payload = path.read_bytes()
    raw = json.loads(payload)
    version = str(raw.get("version") or "").strip()
    if not version:
        raise ValueError("Entity alias catalog requires a version.")
    definitions: list[EntityAliasDefinition] = []
    keys: set[tuple[str, str]] = set()
    alias_owners: dict[str, str] = {}
    for item in raw.get("aliases", []):
        definition = EntityAliasDefinition(
            entity_id=str(item.get("entityId") or "").strip(),
            alias=str(item.get("alias") or "").strip(),
            alias_type=str(item.get("aliasType") or "").strip(),
        )
        alias_key = normalize_entity_alias(definition.alias)
        if not definition.entity_id or not alias_key:
            raise ValueError("Entity alias entries require entityId and alias.")
        if definition.alias_type not in ALIAS_TYPES:
            raise ValueError(f"Unsupported entity alias type: {definition.alias_type}")
        key = (definition.entity_id, alias_key)
        if key in keys:
            raise ValueError(f"Duplicate entity alias entry: {definition.entity_id}/{alias_key}")
        owner = alias_owners.setdefault(alias_key, definition.entity_id)
        if owner != definition.entity_id:
            raise ValueError(f"Ambiguous entity alias: {definition.alias}")
        keys.add(key)
        definitions.append(definition)
    return version, tuple(definitions), hashlib.sha256(payload).hexdigest()


def apply_entity_aliases(
    entities: list[Entity], definitions: tuple[EntityAliasDefinition, ...]
) -> None:
    entity_by_id = {entity.id: entity for entity in entities}
    catalog_owners = {
        normalize_entity_alias(definition.alias): definition.entity_id for definition in definitions
    }
    for entity in entities:
        retained = [
            alias
            for alias in entity.aliases or []
            if catalog_owners.get(normalize_entity_alias(alias), entity.id) == entity.id
        ]
        entity.aliases = retained or None

    canonical_owners: dict[str, set[str]] = {}
    for entity in entities:
        for value in (entity.id, entity.slug, entity.name.zh, entity.name.en):
            key = normalize_entity_alias(value)
            canonical_owners.setdefault(key, set()).add(entity.id)

    for definition in definitions:
        entity = entity_by_id.get(definition.entity_id)
        if entity is None:
            raise ValueError(f"Unknown entity alias target: {definition.entity_id}")
        alias_key = normalize_entity_alias(definition.alias)
        owners = canonical_owners.get(alias_key, set())
        related_ids = {
            candidate.id
            for candidate in entities
            if candidate.id == entity.id
            or candidate.family_id == entity.id
            or entity.family_id == candidate.id
        }
        if owners and not owners <= related_ids:
            raise ValueError(
                f"Alias {definition.alias!r} conflicts with canonical entities {sorted(owners)}."
            )
        existing = {
            normalize_entity_alias(value): value for value in entity.aliases or [] if value.strip()
        }
        existing.setdefault(alias_key, definition.alias)
        entity.aliases = list(existing.values())
