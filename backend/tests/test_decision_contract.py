from pathlib import Path

import pytest
from pydantic import ValidationError

from app.engagement import EngagementService
from app.schemas import Claim, DecisionBudget, DecisionContext, KnowledgeSnapshot

SEED_PATH = Path(__file__).resolve().parents[1] / "data" / "demo_snapshot.json"


def context(**updates: object) -> DecisionContext:
    payload: dict[str, object] = {
        "task": "Choose a model for document analysis",
        "priority": "cost",
        "budget": {"mode": "unknown"},
        "deployment": "undecided",
        "exclusions": [],
        "candidateEntityIds": [],
    }
    payload.update(updates)
    return DecisionContext.model_validate(payload)


def claim(
    claim_id: str,
    entity_id: str | None,
    text: str,
    confidence: str = "verified",
) -> Claim:
    return Claim.model_validate(
        {
            "id": claim_id,
            "entityId": entity_id,
            "text": {"zh": text, "en": text},
            "confidence": confidence,
            "sourceIds": [f"source-{claim_id}"],
            "updatedAt": "2026-09-05",
        }
    )


@pytest.fixture
def snapshot() -> KnowledgeSnapshot:
    return KnowledgeSnapshot.model_validate_json(SEED_PATH.read_bytes())


def test_decision_ranks_only_evidence_backed_candidates_for_the_requested_priority(
    snapshot: KnowledgeSnapshot,
):
    result = EngagementService._build_decision(
        context(),
        [
            claim("cost-gpt", "e-gpt", "Current API price and cost are documented."),
            claim("general-claude", "e-claude", "A general capability is documented."),
        ],
        ["e-claude", "e-gpt"],
        snapshot,
        "en",
    )

    assert result is not None
    assert result.status == "ready"
    assert result.recommendation.primary_entity_id == "e-gpt"
    assert result.recommendation.alternative_entity_ids == ["e-claude"]
    assert {tuple(item.claim_ids) for item in result.tradeoffs} == {
        ("cost-gpt",),
        ("general-claude",),
    }


def test_decision_refuses_to_rank_when_evidence_conflicts(snapshot: KnowledgeSnapshot):
    result = EngagementService._build_decision(
        context(),
        [claim("conflict-gpt", "e-gpt", "Conflicting price evidence.", "conflict")],
        ["e-gpt"],
        snapshot,
        "en",
    )

    assert result is not None
    assert result.status == "conflict"
    assert result.recommendation.primary_entity_id is None
    assert result.risks[0].state == "conflict"


def test_decision_refuses_to_rank_claims_without_resolved_entities(snapshot: KnowledgeSnapshot):
    result = EngagementService._build_decision(
        context(),
        [claim("orphan", None, "A sourced but unresolved claim.")],
        [],
        snapshot,
        "en",
    )

    assert result is not None
    assert result.status == "insufficient-evidence"
    assert result.recommendation.primary_entity_id is None


def test_decision_budget_rejects_reversed_or_non_finite_ranges():
    with pytest.raises(ValidationError):
        DecisionBudget(mode="range", min=100, max=10, currency="CNY")
    with pytest.raises(ValidationError):
        DecisionBudget(mode="range", min=float("inf"), currency="CNY")
