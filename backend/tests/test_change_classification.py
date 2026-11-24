import pytest

from app.change_classification import change_kind_for_predicate

# Predicates of the 26 facts approved on 2026-11-24 from the two first changelogs.
APPROVED_2026_11_24 = {
    "released-to": "availability",
    "released-in": "availability",
    "available-in": "availability",
    "available-for": "availability",
    "fast-mode-available-on": "availability",
    "feature-deprecated": "deprecated",
    "launched-as": "new",
    "gained-capability": "updated",
    "supports": None,
    "supports-reasoning-effort": None,
    "supports-in-beta": None,
    "supports-fine-tuning-inputs": None,
    "has-analytics-metrics": None,
    "maximum-output-tokens": None,
    "maximum-context-window": None,
    "standard-output-price": None,
    "standard-input-price": None,
    "generated-text-watermark": None,
    "model-type": None,
    "product-type": None,
}


@pytest.mark.parametrize(("predicate", "kind"), sorted(APPROVED_2026_11_24.items()))
def test_reviewed_predicates_from_the_first_live_batch(predicate, kind):
    assert change_kind_for_predicate(predicate) == kind


@pytest.mark.parametrize(
    ("predicate", "kind"),
    [
        ("released-on", "new"),
        ("available-in", "availability"),
        ("deprecated-on", "deprecated"),
        ("pricing-changed-on", "pricing"),
        ("capability-updated-on", "updated"),
    ],
)
def test_every_predicate_the_extraction_prompt_requests_is_a_change(predicate, kind):
    assert change_kind_for_predicate(predicate) == kind


@pytest.mark.parametrize(
    "predicate",
    [
        "historical-launch-product-type",
        "official-release-status",
        "unverified-historical-release-status",
        "named-model-retirement-guidance",
        "",
        None,
    ],
)
def test_status_notes_and_provenance_are_not_dated_changes(predicate):
    assert change_kind_for_predicate(predicate) is None


def test_exact_taxonomy_predicates_keep_their_registered_kind():
    assert change_kind_for_predicate("recommended-replacement") == "updated"
    assert change_kind_for_predicate("api-shutdown-record") == "deprecated"
