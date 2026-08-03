from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base, KnowledgeEntityRecord, SourceRecord
from app.quality import KnowledgeQualityGate
from app.repository import KnowledgeRepository
from app.schemas import CandidateCreate, Entity, LocalizedText

SEED_PATH = Path(__file__).resolve().parents[1] / "data" / "demo_snapshot.json"


def _candidate(value: str) -> CandidateCreate:
    return CandidateCreate.model_validate(
        {
            "id": f"review-context-{value.casefold()}",
            "claim": {
                "id": f"claim-context-{value.casefold()}",
                "text": {"zh": f"上下文为 {value}", "en": f"Context is {value}"},
                "confidence": "verified",
                "sourceIds": ["evidence-context"],
                "updatedAt": "2026-07-29",
                "subject": "GPT",
                "predicate": "context-window",
                "objectOrValue": value,
                "validFrom": "2026-07-29",
            },
            "evidence": [
                {
                    "id": "evidence-context",
                    "title": {"zh": "官方规格", "en": "Official specification"},
                    "url": "https://example.com/spec",
                    "publisher": "Example",
                    "publishedAt": "2026-07-29",
                    "collectedAt": "2026-07-29",
                    "type": "official",
                }
            ],
        }
    )


def test_resolves_alias_and_detects_overlapping_structured_conflict():
    snapshot = KnowledgeRepository(SEED_PATH).load_seed()
    existing = _candidate("1M").claim
    existing.id = "existing-context"
    snapshot.claims.append(existing)

    assessment = KnowledgeQualityGate().assess(_candidate("2M"), snapshot)

    assert assessment.resolution == "resolved"
    assert assessment.resolved_entity_id == "e-gpt"
    assert assessment.conflicting_claim_ids == ["existing-context"]
    assert assessment.queue_status == "needs-more-evidence"


def test_non_overlapping_fact_does_not_conflict():
    snapshot = KnowledgeRepository(SEED_PATH).load_seed()
    existing = _candidate("1M").claim
    existing.id = "historical-context"
    existing.valid_from = "2025-01-01"
    existing.valid_to = "2025-12-31"
    snapshot.claims.append(existing)
    incoming = _candidate("2M")
    incoming.claim.valid_from = "2026-01-01"

    assessment = KnowledgeQualityGate().assess(incoming, snapshot)

    assert assessment.conflicting_claim_ids == []
    assert assessment.queue_status == "pending"


def test_demo_data_quality_report_does_not_claim_formal_acceptance():
    snapshot = KnowledgeRepository(SEED_PATH).load_seed()

    report = KnowledgeQualityGate().report(snapshot)

    assert report.live_ready is False
    assert report.entity_count >= 28
    assert report.claim_count < 150
    assert report.claims_with_missing_evidence == []
    assert report.relations_with_missing_evidence == []
    assert report.timeline_entries_with_missing_evidence == []
    assert any("150 reviewed claims" in issue for issue in report.issues)
    assert "e-gpt-4o" not in report.core_entities_below_five_relations


def test_catalog_extension_includes_core_agents_frameworks_and_evidence():
    snapshot = KnowledgeRepository(SEED_PATH).load_seed()
    entity_ids = {entity.id for entity in snapshot.entities}
    evidence_ids = {evidence.id for evidence in snapshot.evidence}

    assert {
        "e-codex",
        "e-claude-code",
        "e-gemini-cli",
        "e-manus",
        "e-devin",
        "e-langgraph",
        "e-autogen",
        "e-crewai",
        "e-openai-agents-sdk",
    }.issubset(entity_ids)
    assert {
        "s-openai-codex",
        "s-anthropic-claude-code",
        "s-google-gemini-cli",
        "s-manus-docs",
        "s-devin-intro",
        "s-langgraph-overview",
        "s-autogen-install",
        "s-crewai-docs",
        "s-openai-agents-sdk",
    }.issubset(evidence_ids)
    assert all(
        snapshot.timeline.get(entity_id)
        for entity_id in (
            "e-codex",
            "e-claude-code",
            "e-gemini-cli",
            "e-manus",
            "e-devin",
            "e-langgraph",
            "e-autogen",
            "e-crewai",
            "e-openai-agents-sdk",
        )
    )


def test_seed_catalog_migrates_only_legacy_country_labels():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    repository = KnowledgeRepository(SEED_PATH)
    try:
        with Session(engine) as session:
            repository.seed_catalog(session)
            assert len(session.scalars(select(SourceRecord)).all()) == len(
                repository.load_seed().evidence
            )
            row = session.get(KnowledgeEntityRecord, "e-gpt")
            assert row is not None
            legacy = Entity.model_validate_json(row.payload_json)
            legacy.origin = LocalizedText(zh="美国", en="United States")
            row.payload_json = legacy.model_dump_json(by_alias=True)
            session.commit()

            repository.seed_catalog(session)

            updated = Entity.model_validate_json(
                session.get(KnowledgeEntityRecord, "e-gpt").payload_json  # type: ignore[union-attr]
            )
            assert updated.origin == LocalizedText(zh="海外", en="Overseas")
    finally:
        engine.dispose()
