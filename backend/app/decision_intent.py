"""Shared task taxonomy for route selection, with scoped positive clauses."""

import json
import re
from pathlib import Path

CATALOG = json.loads(
    (Path(__file__).resolve().parents[1] / "data/decision_scenarios.v1.json").read_text("utf-8")
)


def positive_task_text(text):
    return " ".join(
        clause.strip()
        for clause in re.split(CATALOG["interpretation"]["clauseSeparator"], text)
        if not re.search(CATALOG["interpretation"]["negativeClause"], clause.strip(), re.IGNORECASE)
    )


def contains(text, term):
    if re.search(r"[\u3400-\u9fff]", term):
        return term.casefold() in text.casefold()
    # Match the browser's ASCII word boundary in mixed Chinese/English tasks.
    return bool(
        re.search(r"(?<![A-Za-z0-9_])" + re.escape(term) + r"(?![A-Za-z0-9_])", text, re.IGNORECASE)
    )


def scenario_definition(context):
    text = positive_task_text(context.task)
    scope = (
        context.task_type
        if context.task_type != "unspecified"
        else (
            "model-api"
            if re.search(CATALOG["interpretation"]["modelScope"], text, re.IGNORECASE)
            else None
        )
    )
    # Task actions outrank incidental topic words; stable ties keep taxonomy order.
    ranked = sorted(
        CATALOG["scenarios"],
        key=lambda row: (
            -(
                2
                if any(
                    re.search(pattern, text, re.IGNORECASE)
                    for pattern in row.get("intentPatterns", [])
                )
                else 1
                if any(contains(text, pattern) for pattern in row["patterns"])
                else 0
            )
        ),
    )
    for row in ranked:
        matches = any(contains(text, pattern) for pattern in row["patterns"]) or any(
            re.search(pattern, text, re.IGNORECASE) for pattern in row.get("intentPatterns", [])
        )
        if not matches:
            continue
        if not scope or row["taskType"] == scope:
            return row
        alternative = row.get("scopeAlternatives", {}).get(scope)
        if alternative:
            return next(item for item in CATALOG["scenarios"] if item["id"] == alternative)
    fallback = {
        "coding-product": "coding-workspace",
        "knowledge-product": "knowledge-workspace",
        "agent-development": "agent-orchestration",
    }.get(scope)
    return next((row for row in CATALOG["scenarios"] if row["id"] == fallback), None)


def text_only_input(task):
    return bool(
        re.search(CATALOG["interpretation"]["textOnly"], positive_task_text(task), re.IGNORECASE)
    )


def requested_feature_ids(task):
    # Request paraphrases never become evidence-matching patterns.
    text = positive_task_text(task)
    return {
        key
        for key, feature in CATALOG["features"].items()
        if any(contains(text, pattern) for pattern in feature["patterns"])
        or any(
            re.search(pattern, text, re.IGNORECASE)
            for pattern in feature.get("requestPatterns", [])
        )
    }


def native_retrieval_requested(task):
    return bool(
        re.search(
            CATALOG["interpretation"]["nativeRetrieval"], positive_task_text(task), re.IGNORECASE
        )
    )
