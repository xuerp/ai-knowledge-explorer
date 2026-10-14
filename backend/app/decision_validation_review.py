"""Derive scoped judgments from explicit private records, never product rankings."""

from collections import defaultdict
from datetime import datetime

from .schemas import (
    DecisionMeasuredChoice,
    DecisionValidationCandidateReview,
    DecisionValidationCheckReview,
    DecisionValidationComparisonGroup,
    DecisionValidationConclusion,
    DecisionValidationFinding,
    DecisionValidationItem,
    DecisionValidationReview,
)

DIMENSIONS = ("quality", "latency", "cost", "terms")
CONDITIONS = ("modelVersion", "configuration", "sampleCount", "testedAt", "scope")


def dimension_for(item: DecisionValidationItem) -> str | None:
    return next((key for key in DIMENSIONS if item.id == key or item.id.endswith("-" + key)), None)


def missing_conditions(item: DecisionValidationItem) -> list[str]:
    values = item.test_conditions.model_dump(by_alias=True) if item.test_conditions else {}
    return [
        key
        for key in CONDITIONS
        if not (values.get(key).strip() if isinstance(values.get(key), str) else values.get(key))
    ]


def review_validation(
    items: list[DecisionValidationItem],
    candidate_ids: list[str | None],
    revision: int,
    priority: str = "quality",
    eligible_ids: list[str] | None = None,
) -> DecisionValidationReview:
    rows = []
    comparisons = defaultdict(list)
    # Include the original plan's candidates even when a subset of notes was saved.
    for candidate_id in dict.fromkeys(candidate_ids + [item.candidate_id for item in items]):
        candidate_items = [item for item in items if item.candidate_id == candidate_id]
        checks = []
        recorded = 0
        for dimension in DIMENSIONS:
            matching = [item for item in candidate_items if dimension_for(item) == dimension]
            recorded += int(
                any(
                    item.result.strip()
                    or (
                        item.measurements
                        and any(
                            value is not None and (not isinstance(value, str) or value.strip())
                            for value in item.measurements.model_dump().values()
                        )
                    )
                    or item.status != "pending"
                    or len(missing_conditions(item)) < len(CONDITIONS)
                    for item in matching
                )
            )
            missing = []
            if not matching:
                reason = "missing"
            elif len(matching) > 1:
                reason = "ambiguous"
            else:
                item = matching[0]
                missing = missing_conditions(item)
                reason = (
                    "pending"
                    if item.status == "pending"
                    else "blocked"
                    if item.status == "blocked"
                    else "conditions-missing"
                    if missing or not item.result.strip()
                    else "complete"
                )
                if reason == "complete" and candidate_id is not None:
                    conditions = item.test_conditions
                    basis = (
                        dimension,
                        conditions.configuration.strip(),
                        conditions.scope.strip(),
                        conditions.sample_count,
                        datetime.fromisoformat(conditions.tested_at).date().isoformat(),
                        item.measurements.currency
                        if dimension == "cost"
                        and item.measurements
                        and item.measurements.total_cost is not None
                        else None,
                        item.measurements.cost_basis
                        if dimension == "cost"
                        and item.measurements
                        and item.measurements.total_cost is not None
                        else None,
                        item.measurements.minimum_successful_samples
                        if dimension == "quality"
                        and item.measurements
                        and item.measurements.successful_samples is not None
                        else None,
                    )
                    comparisons[basis].append(item)
            checks.append(
                DecisionValidationCheckReview(
                    dimension=dimension,
                    item_ids=[item.id for item in matching],
                    complete=reason == "complete",
                    reason=reason,
                    missing_conditions=missing,
                )
            )
        rows.append(
            DecisionValidationCandidateReview(
                candidate_id=candidate_id,
                recorded_checks=recorded,
                completed_checks=sum(check.complete for check in checks),
                checks=checks,
            )
        )
    conclusion = DecisionValidationConclusion()
    for row in rows:
        if row.candidate_id is None:
            continue
        quality = next(check for check in row.checks if check.dimension == "quality")
        terms = next(check for check in row.checks if check.dimension == "terms")
        quality_item = next((item for item in items if item.id in quality.item_ids), None)
        terms_item = next((item for item in items if item.id in terms.item_ids), None)
        outcome = "unverified"
        if quality.reason == "blocked":
            outcome = "testing-blocked"
        elif quality.reason in {"conditions-missing", "ambiguous"}:
            outcome = "record-incomplete"
        elif quality.complete and quality_item.status == "failed":
            outcome = "tested-fail"
        elif quality.complete and quality_item.status == "passed":
            outcome = (
                "eligibility-unverified"
                if eligible_ids is not None and row.candidate_id not in eligible_ids
                else "entry-unverified"
                if not terms.complete
                or terms_item.status != "passed"
                or terms_item.test_conditions.model_version.strip()
                != quality_item.test_conditions.model_version.strip()
                else "limited-fit"
            )
        conditions = quality_item.test_conditions if quality_item else None
        conclusion.findings.append(
            DecisionValidationFinding(
                candidate_id=row.candidate_id,
                outcome=outcome,
                item_ids=quality.item_ids + terms.item_ids,
                scope=conditions.scope if quality.complete and conditions else "",
                model_version=conditions.model_version if quality.complete and conditions else "",
            )
        )
    fit = [
        finding.candidate_id for finding in conclusion.findings if finding.outcome == "limited-fit"
    ]
    if fit and priority in {"quality", "balanced"}:
        conclusion.status = "limited-fit"
        conclusion.trial_candidate_ids = fit
    elif fit:
        conclusion.status = "priority-unverified"
    elif any(finding.outcome == "testing-blocked" for finding in conclusion.findings):
        conclusion.status = "validation-blocked"
    elif any(finding.outcome == "tested-fail" for finding in conclusion.findings):
        conclusion.status = "no-tested-fit"
    if fit and priority in {"quality", "cost", "speed"}:
        dimension = {"quality": "quality", "cost": "cost", "speed": "latency"}[priority]
        for basis, group in comparisons.items():
            if basis[0] != dimension:
                continue
            usable = [
                item
                for item in group
                if item.candidate_id in fit and item.status == "passed" and item.measurements
            ]
            units = defaultdict(list)
            for item in usable:
                measures = item.measurements
                if priority == "quality":
                    if (
                        measures.successful_samples is None
                        or measures.minimum_successful_samples is None
                    ):
                        continue
                    unit = f"passed / {basis[3]}"
                elif priority == "cost":
                    if (
                        measures.total_cost is None
                        or measures.cost_basis != "actual-charge"
                        or not measures.currency
                        or not measures.source_note.strip()
                    ):
                        continue
                    unit = measures.currency
                else:
                    if measures.p95_ms is None:
                        continue
                    unit = "ms"
                # A timing/cost sample must match the task pass it is intended to qualify.
                quality = next(
                    (
                        row
                        for row in items
                        if row.candidate_id == item.candidate_id and dimension_for(row) == "quality"
                    ),
                    None,
                )
                if not quality or not quality.test_conditions:
                    continue
                qc = quality.test_conditions
                if (
                    item.test_conditions.model_version.strip() != qc.model_version.strip()
                    or (
                        qc.configuration.strip(),
                        qc.scope.strip(),
                        qc.sample_count,
                        datetime.fromisoformat(qc.tested_at).date().isoformat(),
                    )
                    != basis[1:5]
                ):
                    continue
                units[unit].append(item)
            for unit, measured in units.items():
                if not measured:
                    continue
                values = {
                    item.candidate_id: item.measurements.successful_samples
                    if priority == "quality"
                    else item.measurements.total_cost
                    if priority == "cost"
                    else item.measurements.p95_ms
                    for item in measured
                }
                preferred = max(values.values()) if priority == "quality" else min(values.values())
                winners = [key for key, value in values.items() if value == preferred]
                conclusion.measured_choices.append(
                    DecisionMeasuredChoice(
                        minimum_successful_samples=basis[7],
                        priority=priority,
                        candidate_ids=winners,
                        item_ids=[item.id for item in measured],
                        metric="successful-samples"
                        if priority == "quality"
                        else "total-cost"
                        if priority == "cost"
                        else "p95-ms",
                        unit=unit,
                        values=values,
                        configuration=basis[1],
                        scope=basis[2],
                        sample_count=basis[3],
                        test_date=basis[4],
                    )
                )
        if conclusion.measured_choices:
            conclusion.status = "limited-fit"
            conclusion.trial_candidate_ids = list(
                dict.fromkeys(
                    key for choice in conclusion.measured_choices for key in choice.candidate_ids
                )
            )
    elif fit and priority in {"privacy", "control"}:
        flag = "privacy_verified" if priority == "privacy" else "control_verified"
        verified = [
            key
            for key in fit
            if any(
                item.candidate_id == key
                and dimension_for(item) == "terms"
                and item.status == "passed"
                and item.measurements
                and getattr(item.measurements, flag) is True
                for item in items
            )
        ]
        if verified:
            conclusion.status = "limited-fit"
            conclusion.trial_candidate_ids = verified
    return DecisionValidationReview(
        source_revision=revision,
        conclusion=conclusion,
        candidates=rows,
        comparable_groups=[
            DecisionValidationComparisonGroup(
                dimension=basis[0],
                configuration=basis[1],
                scope=basis[2],
                sample_count=basis[3],
                test_date=basis[4],
                measurement_unit=basis[5],
                cost_basis=basis[6],
                minimum_successful_samples=basis[7],
                candidate_ids=[item.candidate_id for item in group],
                item_ids=[item.id for item in group],
            )
            for basis, group in comparisons.items()
            if len(group) >= 2
        ],
    )
