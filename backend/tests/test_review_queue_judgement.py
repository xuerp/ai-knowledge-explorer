import json
from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.database import ReviewJobRecord
from app.main import create_app
from app.quality import (
    LEGACY_CONFLICT_REASON_PREFIX,
    KnowledgeQualityGate,
    conflict_review_reason,
)
from app.repository import KnowledgeRepository
from app.schemas import CandidateCreate

SEED_PATH = Path(__file__).resolve().parents[1] / "data" / "demo_snapshot.json"


def _candidate(review_id: str, predicate: str, value: str) -> CandidateCreate:
    return CandidateCreate.model_validate(
        {
            "id": review_id,
            "claim": {
                "id": f"claim-{review_id}",
                "text": {"zh": f"GPT {value}", "en": f"GPT {value}"},
                "confidence": "verified",
                "sourceIds": ["evidence-judgement"],
                "updatedAt": "2026-07-29",
                "subject": "GPT",
                "predicate": predicate,
                "objectOrValue": value,
                "validFrom": "2026-07-29",
            },
            "evidence": [
                {
                    "id": "evidence-judgement",
                    "title": {"zh": "官方文档", "en": "Official docs"},
                    "url": "https://example.com/docs",
                    "publisher": "Example",
                    "publishedAt": "2026-07-29",
                    "collectedAt": "2026-07-29",
                    "type": "official",
                    "sourceExcerpt": f"GPT {value}",
                }
            ],
        }
    )


def _with_published(snapshot, predicate: str, value: str, claim_id: str):
    existing = _candidate(claim_id, predicate, value).claim
    existing.id = claim_id
    snapshot.claims.append(existing)
    return snapshot


def test_multi_valued_predicate_with_new_value_is_not_a_conflict():
    snapshot = KnowledgeRepository(SEED_PATH).load_seed()
    _with_published(snapshot, "availability", "OpenAI API", "published-availability")

    assessment = KnowledgeQualityGate().assess(
        _candidate("review-bedrock", "availability", "Amazon Bedrock"), snapshot
    )

    assert assessment.conflicting_claim_ids == []
    assert assessment.queue_status == "pending"


def test_single_valued_conflict_reason_names_the_published_value_in_chinese():
    snapshot = KnowledgeRepository(SEED_PATH).load_seed()
    _with_published(snapshot, "context-window", "1M", "published-context")

    assessment = KnowledgeQualityGate().assess(
        _candidate("review-context", "context-window", "2M"), snapshot
    )

    assert assessment.conflicting_claim_ids == ["published-context"]
    assert assessment.queue_status == "needs-more-evidence"
    assert conflict_review_reason(assessment.conflicting_claim_ids, snapshot) == (
        "与已发布事实取值不同：已发布 「1M」，请确认哪条正确。"
    )


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        database_url=f"sqlite:///{(tmp_path / 'judgement.db').as_posix()}",
        seed_snapshot_path=SEED_PATH,
        admin_token="test-admin-token",
        cors_origins=("http://localhost:3000",),
        automation_token="test-automation-token-with-at-least-32-characters",
        environment="test",
        jwt_secret="test-jwt-secret-that-is-long-enough-for-hs256",
        fetch_allowed_hosts=("example.com",),
    )


def _open_row(candidate: CandidateCreate, *, conflicts: list[str], status: str, reason: str):
    return ReviewJobRecord(
        id=candidate.id,
        entity_id="e-gpt",
        claim_id=candidate.claim.id,
        claim_json=candidate.claim.model_dump_json(by_alias=True),
        evidence_ids_json=json.dumps([item.id for item in candidate.evidence]),
        evidence_json=json.dumps(
            [item.model_dump(mode="json", by_alias=True) for item in candidate.evidence],
            ensure_ascii=False,
        ),
        conflict_ids_json=json.dumps(conflicts),
        status=status,
        created_at=datetime.now(UTC),
        review_reason=reason,
        version=1,
    )


def test_startup_clears_false_conflicts_and_rewrites_legacy_reasons(tmp_path: Path):
    false_conflict = _candidate("review-false-conflict", "availability", "Amazon Bedrock")
    ambiguous = _candidate("review-legacy-ambiguous", "capability", "Tools")
    new_model = _candidate("review-new-model", "availability", "Azure")
    with TestClient(create_app(_settings(tmp_path))) as client:
        services = client.app.state.services
        with services.database.session() as session:
            session.add_all(
                [
                    _open_row(
                        false_conflict,
                        conflicts=["claim-published"],
                        status="needs-more-evidence",
                        reason=LEGACY_CONFLICT_REASON_PREFIX + " claim-published",
                    ),
                    _open_row(
                        ambiguous,
                        conflicts=[],
                        status="needs-more-evidence",
                        reason="Entity resolution is ambiguous and requires human confirmation.",
                    ),
                    _open_row(
                        new_model,
                        conflicts=["claim-published"],
                        status="pending",
                        reason="新模型：批准后自动收录 GPT。",
                    ),
                ]
            )
            session.commit()

    # A second start runs the same reconciliation the deployed service runs.
    with (
        TestClient(create_app(_settings(tmp_path))) as client,
        client.app.state.services.database.session() as session,
    ):
        cleared = session.get(ReviewJobRecord, false_conflict.id)
        legacy = session.get(ReviewJobRecord, ambiguous.id)
        kept = session.get(ReviewJobRecord, new_model.id)

        assert json.loads(cleared.conflict_ids_json) == []
        assert cleared.status == "pending"
        assert cleared.review_reason is None
        assert cleared.version == 2
        # "GPT" now resolves to one entity, so the stale ambiguity hold is lifted.
        assert legacy.review_reason is None
        assert legacy.status == "pending"
        assert json.loads(kept.conflict_ids_json) == []
        assert kept.review_reason == "新模型：批准后自动收录 GPT。"

        # Running it again changes nothing.
        assert client.app.state.services.clear_false_conflicts(session) == 0
