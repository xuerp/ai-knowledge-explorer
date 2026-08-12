from datetime import UTC, datetime
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

    report = KnowledgeQualityGate().report(
        snapshot,
        now=datetime(2026, 8, 12, tzinfo=UTC),
    )

    assert report.live_ready is False
    assert report.entity_count >= 28
    assert report.claim_count < 150
    assert report.claims_with_missing_evidence == []
    assert report.relations_with_missing_evidence == []
    assert report.timeline_entries_with_missing_evidence == []
    assert report.evidence_reference_coverage == 1
    assert report.official_evidence_ratio >= 0.6
    assert report.reviewed_evidence_ratio >= 0.9
    assert report.fresh_evidence_ratio >= 0.8
    assert report.evidence_domain_count >= 8
    assert report.verified_content_ratio >= 0.8
    assert report.conflict_content_count == 0
    assert any("150 reviewed claims" in issue for issue in report.issues)
    assert "e-gpt-4o" not in report.core_entities_below_five_relations


def test_quality_report_blocks_stale_unreviewed_non_official_evidence():
    snapshot = KnowledgeRepository(SEED_PATH).load_seed()
    for evidence in snapshot.evidence:
        evidence.type = "community"
        evidence.verified_at = None
        evidence.collected_at = "2025-01-01"

    report = KnowledgeQualityGate().report(
        snapshot,
        now=datetime(2026, 8, 12, tzinfo=UTC),
    )

    assert report.official_evidence_ratio == 0
    assert report.reviewed_evidence_ratio == 0
    assert report.fresh_evidence_ratio == 0
    assert any("official first-party" in issue for issue in report.issues)
    assert any("human verification" in issue for issue in report.issues)
    assert any("within 180 days" in issue for issue in report.issues)


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
            openai_source = session.get(SourceRecord, "s-openai-about")
            cursor_source = session.get(SourceRecord, "s-cursor-docs")
            qwen_source = session.get(SourceRecord, "s-qwen-models")
            swebench_source = session.get(SourceRecord, "s-swebench")
            assert openai_source is not None
            assert cursor_source is not None
            assert qwen_source is not None
            assert swebench_source is not None
            openai_source.url = "https://openai.com/about"
            openai_source.last_probe_status = "failed"
            openai_source.last_probe_error = "legacy path rejected"
            cursor_source.url = "https://docs.cursor.com/chat/overview"
            cursor_source.last_probe_status = "failed"
            cursor_source.last_probe_error = "legacy path redirected"
            qwen_source.url = "https://qwenlm.ai/"
            qwen_source.last_probe_status = "failed"
            qwen_source.last_probe_error = "legacy host rejected"
            swebench_source.url = "https://www.swebench.com/"
            swebench_source.last_probe_status = "failed"
            swebench_source.last_probe_error = "legacy document too large"
            session.commit()

            repository.seed_catalog(session)

            updated = Entity.model_validate_json(
                session.get(KnowledgeEntityRecord, "e-gpt").payload_json  # type: ignore[union-attr]
            )
            assert updated.origin == LocalizedText(zh="海外", en="Overseas")
            assert openai_source.url == "https://openai.com/our-structure/"
            assert cursor_source.url == "https://cursor.com/docs"
            assert qwen_source.url == "https://raw.githubusercontent.com/QwenLM/Qwen3/main/README.md"
            assert swebench_source.url == (
                "https://raw.githubusercontent.com/swe-bench/swe-bench.github.io/"
                "master/data/info_for_leaderboard.json"
            )
            assert openai_source.last_probe_status is None
            assert cursor_source.last_probe_status is None
            assert qwen_source.last_probe_status is None
            assert swebench_source.last_probe_status is None
    finally:
        engine.dispose()
