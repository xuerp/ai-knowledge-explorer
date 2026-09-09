from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base, EntityAliasRecord, KnowledgeEntityRecord
from app.entity_aliases import load_entity_alias_catalog, normalize_entity_alias
from app.repository import KnowledgeRepository
from app.schemas import Entity

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
SEED_PATH = DATA_DIR / "demo_snapshot.json"
CATALOG_PATH = DATA_DIR / "entity_aliases_v1.json"
CORE_ENTITY_IDS = {
    "e-autogen",
    "e-claude",
    "e-claude-code",
    "e-codex",
    "e-crewai",
    "e-deepseek",
    "e-devin",
    "e-doubao",
    "e-ernie",
    "e-gemini",
    "e-gemini-cli",
    "e-gpt",
    "e-kimi",
    "e-langchain",
    "e-langgraph",
    "e-manus",
    "e-mcp",
    "e-openai-agents-sdk",
    "e-qwen",
}


def test_versioned_alias_catalog_covers_every_core_entity_without_ambiguity():
    repository = KnowledgeRepository(SEED_PATH)
    snapshot = repository.load_seed()
    version, definitions, sha256 = load_entity_alias_catalog(CATALOG_PATH)

    covered_ids = {item.entity_id for item in definitions}
    normalized_aliases = [normalize_entity_alias(item.alias) for item in definitions]

    assert version == "1.0.0"
    assert len(sha256) == 64
    assert CORE_ENTITY_IDS <= covered_ids
    assert covered_ids - CORE_ENTITY_IDS == {"e-gpt-5"}
    assert covered_ids <= {entity.id for entity in snapshot.entities}
    assert len(normalized_aliases) == len(set(normalized_aliases))
    assert repository.alias_catalog_version == version
    assert repository.alias_catalog_sha256 == sha256


def test_seed_catalog_persists_typed_alias_index_and_keeps_payload_authoritative():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    repository = KnowledgeRepository(SEED_PATH)

    with Session(engine) as session:
        repository.seed_catalog(session)
        rows = session.scalars(
            select(EntityAliasRecord).order_by(
                EntityAliasRecord.entity_id, EntityAliasRecord.alias_key
            )
        ).all()
        mcp = session.get(KnowledgeEntityRecord, "e-mcp")

    assert len(rows) == 34
    assert sum(row.alias_type != "other" for row in rows) == 24
    assert {row.alias_type for row in rows} <= {
        "abbreviation",
        "product-name",
        "qualified-name",
        "spelling-variant",
        "translation",
        "version-name",
        "other",
    }
    assert mcp is not None
    assert "MCP" in (Entity.model_validate_json(mcp.payload_json).aliases or [])


def test_entity_upsert_rebuilds_alias_index_for_admin_aliases():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    repository = KnowledgeRepository(SEED_PATH)

    with Session(engine) as session:
        repository.seed_catalog(session)
        row = session.get(KnowledgeEntityRecord, "e-codex")
        assert row is not None
        entity = Entity.model_validate_json(row.payload_json)
        entity.aliases = [*(entity.aliases or []), "OpenAI Coding Agent"]
        repository.upsert_entity(session, entity)
        session.commit()
        aliases = session.scalars(
            select(EntityAliasRecord).where(EntityAliasRecord.entity_id == entity.id)
        ).all()

    by_key = {row.alias_key: row.alias_type for row in aliases}
    assert by_key["codex"] == "product-name"
    assert by_key["openai coding agent"] == "other"
