from pathlib import Path

from app.entity_linkage import audit_claim_entity_links
from app.repository import KnowledgeRepository
from app.schemas import Claim

SEED_PATH = Path(__file__).resolve().parents[1] / "data" / "demo_snapshot.json"


def _claim(
    claim_id: str,
    *,
    entity_id: str | None = None,
    subject: str | None = None,
    text: str,
) -> Claim:
    return Claim.model_validate(
        {
            "id": claim_id,
            "entityId": entity_id,
            "text": {"zh": text, "en": text},
            "confidence": "verified",
            "sourceIds": ["source-test"],
            "updatedAt": "2026-08-25",
            "subject": subject,
            "predicate": "description",
            "objectOrValue": text,
            "validFrom": "2026-08-25",
        }
    )


def test_claim_entity_audit_separates_deterministic_and_manual_cases():
    snapshot = KnowledgeRepository(SEED_PATH).load_seed()
    entities = [
        next(entity for entity in snapshot.entities if entity.id == "e-gpt"),
        next(entity for entity in snapshot.entities if entity.id == "e-claude"),
    ]
    snapshot = snapshot.model_copy(
        update={
            "entities": entities,
            "claims": [
                _claim("linked", entity_id="e-gpt", subject="GPT", text="GPT 已关联。"),
                _claim("deterministic", subject="Claude", text="Claude 已发布。"),
                _claim("review", subject="未知系列", text="GPT 发布了新版本。"),
                _claim("ambiguous", subject="两个系列", text="GPT 与 Claude 可以对比。"),
                _claim("unresolved", subject="未知产品", text="该产品没有目录记录。"),
                _claim(
                    "invalid",
                    entity_id="e-does-not-exist",
                    subject="GPT",
                    text="GPT 被错误关联。",
                ),
            ],
        }
    )

    report = audit_claim_entity_links(snapshot)
    by_id = {item.claim_id: item for item in report.items}

    assert report.public_claim_count == 6
    assert report.linked_claim_count == 1
    assert report.missing_or_invalid_count == 5
    assert report.deterministic_repair_count == 1
    assert report.manual_review_count == 4
    assert by_id["deterministic"].resolution == "deterministic"
    assert by_id["deterministic"].proposed_entity_id == "e-claude"
    assert by_id["review"].resolution == "review-required"
    assert by_id["review"].proposed_entity_id == "e-gpt"
    assert by_id["ambiguous"].resolution == "ambiguous"
    assert by_id["ambiguous"].candidate_entity_ids == ["e-claude", "e-gpt"]
    assert by_id["unresolved"].resolution == "unresolved"
    assert by_id["invalid"].resolution == "invalid"
