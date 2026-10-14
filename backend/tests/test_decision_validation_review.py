"""Private declared test bases; fixtures are not product performance evidence."""

from copy import deepcopy

import pytest

from app.decision_validation_review import review_validation
from app.schemas import DecisionValidationItem


def item(candidate="a", dimension="quality", **changes):
    data = {
        "id": f"{candidate}-{dimension}",
        "candidateId": candidate,
        "title": "Isolated synthetic comparison fixture",
        "status": "passed",
        "result": "Fixture passed; not an actual product test",
        "testConditions": {
            "modelVersion": "model-" + candidate,
            "configuration": "same local fixture; no network",
            "sampleCount": 12,
            "testedAt": "2026-10-10",
            "scope": "same cases; require all assertions",
        },
    }
    data.update(changes)
    return DecisionValidationItem.model_validate(data)


def test_partial_plan_does_not_shrink_denominator_or_turn_failure_into_success():
    result = review_validation([item(status="failed")], ["a", "b"], 3)
    assert result.source_revision == 3 and result.basis == "user-records"
    a, b = result.candidates
    assert a.completed_checks == 1 and a.required_checks == 4
    assert a.checks[0].complete
    assert [row.reason for row in a.checks] == ["complete", "missing", "missing", "missing"]
    assert b.completed_checks == 0 and b.required_checks == 4
    assert result.comparable_groups == []


def test_legacy_and_pending_notes_are_preserved_but_not_comparable():
    notes = [item(testConditions=None), item("b", status="blocked"), item("c", status="pending")]
    before = deepcopy(notes)
    result = review_validation(notes, ["a", "b", "c"], 1)
    assert result.candidates[0].checks[0].reason == "conditions-missing"
    assert len(result.candidates[0].checks[0].missing_conditions) == 5
    assert [row.completed_checks for row in result.candidates] == [0, 0, 0]
    assert result.comparable_groups == []
    assert notes == before


@pytest.mark.parametrize(
    "field,value",
    [
        ("configuration", "another environment"),
        ("scope", "another sample set"),
        ("sampleCount", 13),
        ("testedAt", "2026-10-11"),
    ],
)
def test_different_declared_bases_cannot_be_grouped(field, value):
    a, b = item(), item("b")
    conditions = b.test_conditions.model_dump(by_alias=True)
    conditions[field] = value
    b = item("b", testConditions=conditions)
    assert review_validation([a, b], ["a", "b"], 1).comparable_groups == []


def test_same_basis_different_models_and_pass_fail_are_only_manual_comparison():
    a, b = item(), item("b", status="failed")
    conditions = b.test_conditions.model_dump(by_alias=True)
    conditions["testedAt"] = "2026-10-10T10:45:00+08:00"
    b = item("b", status="failed", testConditions=conditions)
    result = review_validation([a, b], ["a", "b"], 9)
    group = result.comparable_groups[0]
    assert group.candidate_ids == ["a", "b"]
    assert group.item_ids == ["a-quality", "b-quality"]
    assert group.test_date == "2026-10-10" and group.sample_count == 12
    assert result.model_dump().keys() == {
        "source_revision",
        "basis",
        "candidates",
        "comparable_groups",
        "conclusion",
    }
    assert a.status == "passed" and b.status == "failed"


def test_scoped_trial_requires_complete_quality_entry_and_current_eligibility():
    notes = [item(), item(dimension="terms"), item("b", status="pending")]
    before = deepcopy(notes)
    review = review_validation(notes, ["a", "b"], 8, "quality", ["a", "b"])
    assert review.conclusion.status == "limited-fit"
    assert review.conclusion.trial_candidate_ids == ["a"]
    assert review.conclusion.findings[0].scope == notes[0].test_conditions.scope
    assert review.conclusion.findings[0].item_ids == ["a-quality", "a-terms"]
    assert review.conclusion.findings[1].outcome == "unverified"
    assert notes == before
    excluded = review_validation(notes, ["a", "b"], 8, "quality", ["b"])
    assert excluded.conclusion.trial_candidate_ids == []
    assert excluded.conclusion.findings[0].outcome == "eligibility-unverified"


@pytest.mark.parametrize("priority", ["cost", "speed", "privacy", "control"])
def test_quality_pass_does_not_override_an_unverified_selection_priority(priority):
    review = review_validation([item(), item(dimension="terms")], ["a"], 1, priority)
    assert review.conclusion.status == "priority-unverified"
    assert not review.conclusion.trial_candidate_ids


def test_blocked_or_incomplete_notes_and_prose_do_not_become_tested_passes():
    review = review_validation(
        [
            item(status="blocked", result="7/7 local checks; two tasks unfinished"),
            item("b", status="pending", result="All tests passed"),
            item("c", testConditions=None),
            item("d"),
        ],
        ["a", "b", "c", "d"],
        8,
    )
    assert review.conclusion.status == "validation-blocked"
    assert [row.outcome for row in review.conclusion.findings] == [
        "testing-blocked",
        "unverified",
        "record-incomplete",
        "entry-unverified",
    ]
    assert not review.conclusion.trial_candidate_ids
    assert all(not row.scope for row in review.conclusion.findings[:3])


def test_complete_negative_result_excludes_only_its_tested_scope_and_keeps_untested_candidates():
    review = review_validation([item(status="failed")], ["a", "b"], 1)
    assert review.conclusion.status == "no-tested-fit"
    assert review.conclusion.findings[0].outcome == "tested-fail"
    assert review.conclusion.findings[0].scope == "same cases; require all assertions"
    assert review.conclusion.findings[1].outcome == "unverified"
    assert not review.conclusion.trial_candidate_ids


def test_duplicate_dimension_is_ambiguous_even_when_both_pass():
    notes = [item(), item(id="second-quality"), item("b")]
    result = review_validation(notes, ["a", "b"], 1)
    assert result.candidates[0].checks[0].reason == "ambiguous"
    assert result.candidates[0].checks[0].item_ids == ["a-quality", "second-quality"]
    assert result.candidates[0].completed_checks == 0
    assert result.comparable_groups == []


def test_general_and_unknown_checks_do_not_invent_candidate_effectiveness():
    general = item(candidateId=None, id="quality")
    custom = item(id="a-other")
    result = review_validation([general, custom], [None, "a"], 0)
    assert result.candidates[0].completed_checks == 1
    assert result.candidates[1].completed_checks == 0
    assert result.comparable_groups == []


def measured(candidate="a", dimension="cost", value=2, **changes):
    measures = (
        {
            "totalCost": value,
            "currency": "USD",
            "costBasis": "actual-charge",
            "sourceNote": "Synthetic fixture receipt, not a supplier bill",
        }
        if dimension == "cost"
        else {"p50Ms": value / 2, "p95Ms": value}
    )
    measures.update(changes)
    return item(candidate, dimension, measurements=measures)


@pytest.mark.parametrize("priority,dimension", [("cost", "cost"), ("speed", "latency")])
def test_explicit_matching_measurements_choose_only_the_tested_minimum_and_keep_ties(
    priority, dimension
):
    notes = [item(key, check) for key in ("a", "b", "c") for check in ("quality", "terms")]
    notes += [measured("a", dimension, 4), measured("b", dimension, 2), measured("c", dimension, 2)]
    before = deepcopy(notes)
    review = review_validation(
        notes, ["a", "b", "c", "untested"], 9, priority, ["a", "b", "c", "untested"]
    )
    assert review.conclusion.status == "limited-fit"
    assert review.conclusion.trial_candidate_ids == ["b", "c"]
    assert review.conclusion.measured_choices[0].values == {"a": 4, "b": 2, "c": 2}
    assert review.conclusion.measured_choices[0].basis == "user-declared-actual-measurements"
    assert notes == before


def test_estimates_missing_currency_wrong_version_and_failed_task_are_not_cost_choices():
    base = [item(), item(dimension="terms")]
    for cost in [
        measured(costBasis="estimate"),
        item(dimension="cost", status="pending", measurements={"totalCost": 0}),
        measured().model_copy(
            update={
                "test_conditions": measured().test_conditions.model_copy(
                    update={"model_version": "another-version"}
                )
            }
        ),
    ]:
        review = review_validation([*base, cost], ["a"], 1, "cost", ["a"])
        assert review.conclusion.status == "priority-unverified"
        assert not review.conclusion.measured_choices
    failed = review_validation(
        [item(status="failed"), item(dimension="terms"), measured()], ["a"], 1, "cost", ["a"]
    )
    assert failed.conclusion.status == "no-tested-fit"


def test_different_currencies_are_separate_scoped_records_not_an_exchange_rate_ranking():
    notes = [item(key, check) for key in ("a", "b") for check in ("quality", "terms")]
    notes += [measured("a", value=0), measured("b", value=1, currency="CNY")]
    review = review_validation(notes, ["a", "b"], 1, "cost", ["a", "b"])
    assert len(review.conclusion.measured_choices) == 2
    assert all(len(choice.values) == 1 for choice in review.conclusion.measured_choices)
    assert review.conclusion.trial_candidate_ids == ["a", "b"]


@pytest.mark.parametrize(
    "priority,field", [("privacy", "privacyVerified"), ("control", "controlVerified")]
)
def test_privacy_and_control_require_an_explicit_scoped_verification(priority, field):
    for flag, expected in [(None, []), (False, []), (True, ["a"])]:
        review = review_validation(
            [item(), item(dimension="terms", measurements={field: flag})], ["a"], 1, priority, ["a"]
        )
        assert review.conclusion.trial_candidate_ids == expected


def test_entry_for_a_different_version_cannot_qualify_a_passed_task():
    terms = item(dimension="terms")
    terms.test_conditions.model_version = "wrong-version"
    review = review_validation([item(), terms, measured()], ["a"], 1, "cost", ["a"])
    assert review.conclusion.findings[0].outcome == "entry-unverified"
    assert not review.conclusion.trial_candidate_ids


@pytest.mark.parametrize(
    "payload",
    [
        {"totalCost": True},
        {"totalCost": -1},
        {"p50Ms": 50, "p95Ms": 10},
        {"p95Ms": float("inf")},
        {"privacyVerified": "yes"},
    ],
)
def test_measurements_reject_invalid_and_ambiguous_values(payload):
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        item(dimension="cost", measurements=payload)


def test_quality_counts_choose_maximum_keep_ties_and_partition_different_thresholds():
    notes = [item(key, "terms") for key in ("a", "b", "c", "d")]
    notes += [
        item(key, measurements={"successfulSamples": count, "minimumSuccessfulSamples": threshold})
        for key, count, threshold in (("a", 12, 8), ("b", 10, 8), ("c", 12, 8), ("d", 9, 9))
    ]
    review = review_validation(notes, ["a", "b", "c", "d"], 1, "quality", ["a", "b", "c", "d"])
    choices = review.conclusion.measured_choices
    assert len(choices) == 2
    assert choices[0].candidate_ids == ["a", "c"]
    assert choices[0].values == {"a": 12, "b": 10, "c": 12}
    assert choices[0].minimum_successful_samples == 8
    assert choices[1].candidate_ids == ["d"]
    assert choices[1].minimum_successful_samples == 9
    quality_groups = [group for group in review.comparable_groups if group.dimension == "quality"]
    assert len(quality_groups) == 1 and quality_groups[0].candidate_ids == ["a", "b", "c"]


@pytest.mark.parametrize(
    "measures",
    [
        {"successfulSamples": 13, "minimumSuccessfulSamples": 8},
        {"successfulSamples": 8, "minimumSuccessfulSamples": 13},
        {"successfulSamples": 7, "minimumSuccessfulSamples": 8},
        {"successfulSamples": 10},
        {"successfulSamples": True, "minimumSuccessfulSamples": 8},
        {"successfulSamples": 10.5, "minimumSuccessfulSamples": 8},
    ],
)
def test_completed_quality_counts_must_be_consistent_with_total_and_predeclared_threshold(measures):
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        item(measurements=measures)


def test_currency_and_actual_vs_estimate_are_not_the_same_comparison_basis():
    notes = [measured("a"), measured("b", currency="CNY"), measured("c", costBasis="estimate")]
    assert not review_validation(notes, ["a", "b", "c"], 1, "cost").comparable_groups
