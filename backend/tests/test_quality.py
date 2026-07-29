from pathlib import Path

from app.quality import KnowledgeQualityGate
from app.repository import KnowledgeRepository
from app.schemas import CandidateCreate

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
    assert report.claim_count == 5
    assert report.claims_with_missing_evidence == []
    assert report.relations_with_missing_evidence == []
    assert report.timeline_entries_with_missing_evidence == []
    assert any("40 reviewed entities" in issue for issue in report.issues)
    assert any("150 reviewed claims" in issue for issue in report.issues)
