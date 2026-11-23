"""Regression: the 63 live `schema_error` rejections were all unattributable subjects.

Each row is replayed through the current entity resolver. Real catalog entities
must now resolve to the expected entity; every other subject must stay
unresolved so extraction drops it instead of queueing a candidate that can only
be rejected.
"""

import json
from pathlib import Path

import pytest

from app.quality import KnowledgeQualityGate
from app.repository import KnowledgeRepository
from app.schemas import CandidateCreate

FIXTURE = Path(__file__).parent / "fixtures" / "live_schema_error_rejections_20261122.json"
SEED_PATH = Path(__file__).resolve().parents[1] / "data" / "demo_snapshot.json"
ITEMS = json.loads(FIXTURE.read_text(encoding="utf-8"))["items"]

# Subjects that name a catalog entity, and the entity they must resolve to.
EXPECTED_RESOLUTIONS = {
    "Claude 3.7 Sonnet": "e-claude-sonnet-37",
    "CrewAI": "e-crewai",
}


def _candidate(item: dict) -> CandidateCreate:
    return CandidateCreate.model_validate(
        {
            "id": "review-replay",
            "claim": {
                "id": "claim-replay",
                "text": {"zh": item["textZh"], "en": item["textZh"]},
                "confidence": "unverified",
                "sourceIds": ["evidence-replay"],
                "updatedAt": "2026-11-22",
                "subject": item["subject"],
                "predicate": item["predicate"],
                "objectOrValue": item["objectOrValue"],
            },
            "evidence": [
                {
                    "id": "evidence-replay",
                    "title": {"zh": "官方来源", "en": "Official source"},
                    "url": item["sourceUrl"],
                    "publisher": "Official",
                    "publishedAt": "2026-11-22",
                    "collectedAt": "2026-11-22",
                    "sourceExcerpt": item["sourceExcerpt"],
                    "type": "official",
                }
            ],
        }
    )


@pytest.fixture(scope="module")
def snapshot():
    return KnowledgeRepository(SEED_PATH).load_seed()


def test_fixture_keeps_the_full_live_denominator():
    assert len(ITEMS) == 63
    assert all(item["sourceExcerpt"] for item in ITEMS)


@pytest.mark.parametrize("item", ITEMS, ids=[item["id"] for item in ITEMS])
def test_live_rejection_resolves_only_real_catalog_subjects(item, snapshot):
    assessment = KnowledgeQualityGate().assess(_candidate(item), snapshot)

    expected = EXPECTED_RESOLUTIONS.get(item["subject"])
    if expected:
        assert assessment.resolution == "resolved"
        assert assessment.resolved_entity_id == expected
    else:
        assert assessment.resolved_entity_id is None


def test_live_replay_outcome_counts(snapshot):
    gate = KnowledgeQualityGate()
    resolved = [
        item for item in ITEMS if gate.assess(_candidate(item), snapshot).resolved_entity_id
    ]

    # 4 Claude 3.7 Sonnet facts + 12 CrewAI facts become reviewable; 47 stay dropped.
    assert len(resolved) == 16
    assert len(ITEMS) - len(resolved) == 47
