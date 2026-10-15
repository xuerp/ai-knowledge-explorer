"""Use stronger reviewed features without inferring the reverse or inventing scores."""

import pytest

from app.decision_candidates import CATALOG, described_features
from app.schemas import Claim, DecisionScenario


def finding(feature, text="The documented tool supports this workflow."):
    return Claim(
        id="reviewed-workflow",
        entity_id="fixture-tool",
        predicate="workflow-feature",
        object_or_value=feature,
        text={"zh": text, "en": text},
        confidence="verified",
        source_ids=["official-reference"],
        updated_at="2026-10-15",
    )


@pytest.mark.parametrize("language", ["zh", "en"])
@pytest.mark.parametrize(
    "recorded,required",
    [("file-editing", "code-editing"), ("test-execution", "tool-use")],
)
def test_stronger_reviewed_features_satisfy_declared_parent_with_original_citation(
    language, recorded, required
):
    claim = finding(recorded)
    rows = described_features([claim], DecisionScenario(required_features=[required]), language)
    assert len(rows) == 1
    assert rows[0].dimension == required
    assert rows[0].claim_ids == [claim.id]
    assert rows[0].finding == claim.text.en
    assert claim.object_or_value == recorded


@pytest.mark.parametrize(
    "recorded,required",
    [("code-editing", "file-editing"), ("tool-use", "test-execution")],
)
def test_generic_features_cannot_prove_stronger_requirements(recorded, required):
    assert not described_features(
        [finding(recorded)], DecisionScenario(required_features=[required]), "en"
    )


def test_negative_or_unrecognized_features_do_not_satisfy_parents():
    scenario = DecisionScenario(required_features=["tool-use", "code-editing"])
    assert not described_features(
        [finding("test-execution", "This interface cannot execute tests.")], scenario, "en"
    )
    assert not described_features([finding("unrecognized")], scenario, "en")


def test_hierarchy_handles_cycles_without_spreading_to_unrelated_features(monkeypatch):
    monkeypatch.setitem(CATALOG["features"], "cycle-a", {"supersedes": ["cycle-b"]})
    monkeypatch.setitem(CATALOG["features"], "cycle-b", {"supersedes": ["cycle-a"]})
    assert not described_features(
        [finding("cycle-a")], DecisionScenario(required_features=["tool-use"]), "en"
    )
