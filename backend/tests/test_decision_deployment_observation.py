"""Reviewed categorical access can be fresh without a fabricated source date."""

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.decision_constraints import current_claims
from app.schemas import Claim, Evidence, KnowledgeSnapshot


def observation(days=0):
    now = datetime.now(UTC).isoformat()
    verified = (datetime.now(UTC) - timedelta(days=days)).isoformat()
    claim = Claim(
        id="deployment-observation-fixture",
        entity_id="fixture-model",
        confidence="verified",
        predicate="deployment",
        object_or_value="cloud-api",
        text={"zh": "合成云 API 入口事实", "en": "Synthetic cloud API access fact"},
        source_ids=["deployment-source"],
        updated_at=now,
    )
    source = Evidence(
        id="deployment-source",
        title={"zh": "测试", "en": "Fixture"},
        url="https://supplier.example/models/model",
        publisher="Synthetic supplier",
        type="official",
        published_at="",
        collected_at=now,
        verified_at=verified,
        source_excerpt="Synthetic model is available through this provider's API.",
    )
    snapshot = KnowledgeSnapshot.model_validate_json(
        (Path(__file__).parents[1] / "data/demo_snapshot.json").read_bytes()
    ).model_copy(update={"claims": [claim], "evidence": [source]})
    return claim, source, snapshot


def test_reviewed_categorical_deployment_uses_verification_without_creating_a_release_date():
    claim, source, snapshot = observation()
    assert current_claims([claim], snapshot) == [claim]
    assert claim.valid_from is None and source.published_at == ""


@pytest.mark.parametrize("days", [-2, 91])
def test_future_or_expired_verification_stays_unknown(days):
    claim, _, snapshot = observation(days)
    assert not current_claims([claim], snapshot)


@pytest.mark.parametrize(
    "change",
    ["unreviewed", "unverified-source", "unofficial", "no-excerpt", "numeric", "unknown-value"],
)
def test_collection_and_descriptions_cannot_bypass_the_hard_constraint_gate(change):
    claim, source, snapshot = observation()
    if change == "unreviewed":
        claim.confidence = "unverified"
    elif change == "unverified-source":
        source.verified_at = None
    elif change == "unofficial":
        source.type = "community"
    elif change == "no-excerpt":
        source.source_excerpt = ""
    elif change == "numeric":
        claim.predicate, claim.object_or_value = "context_tokens", "1050000"
    else:
        claim.object_or_value = "API mentioned somewhere"
    assert not current_claims([claim], snapshot)
