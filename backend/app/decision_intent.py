"""Shared task taxonomy for route selection, with scoped positive clauses."""

import json
import re
from pathlib import Path

from .decision_clauses import clauses
from .decision_semantics import context_meaning

CATALOG = json.loads(
    (Path(__file__).resolve().parents[1] / "data/decision_scenarios.v1.json").read_text("utf-8")
)
WORKFLOWS = json.loads(
    (Path(__file__).resolve().parents[1] / "data/decision_workflows.v1.json").read_text("utf-8")
)["workflows"]


def task_workflow(text, meaning=None):
    """Method selection only; these descriptions never prove vendor features."""
    if meaning is not None:
        return next((row for row in WORKFLOWS if row["id"] == meaning.method), None)
    positive = positive_task_text(text)
    matches = [
        row
        for row in WORKFLOWS
        if row["match"]
        and all(re.search(pattern, positive, re.IGNORECASE) for pattern in row["match"])
        and not (
            row["id"] == "classification"
            and re.search(r"提取|抽取|字段|JSON|extract|fields", positive, re.IGNORECASE)
        )
    ]
    return matches[0] if len(matches) == 1 else None


def positive_task_text(text):
    return " ".join(
        clause.text for clause in clauses(text, CATALOG["interpretation"]) if not clause.prohibited
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
    meaning = context_meaning(context)
    if meaning is not None:
        return next((row for row in CATALOG["scenarios"] if row["id"] == meaning.scenario), None)
    workflow = task_workflow(context.task)
    if workflow:
        return next(
            (row for row in CATALOG["scenarios"] if row["id"] == workflow["scenario"]), None
        )
    semantic_matches = {
        rule["scenario"]
        for rule in CATALOG.get("semanticRules", [])
        if all(re.search(pattern, text, re.IGNORECASE) for pattern in rule["all"])
    }
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
                3
                if row["id"] in semantic_matches
                else 2
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
        matches = (
            row["id"] in semantic_matches
            or any(contains(text, pattern) for pattern in row["patterns"])
            or any(
                re.search(pattern, text, re.IGNORECASE) for pattern in row.get("intentPatterns", [])
            )
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
    if fallback is None and scope is None:
        from .decision_stages import source_ordered_stages

        # An explicitly supplied sequence can receive a conditional execution
        # plan without claiming a known method or a qualified product.
        if source_ordered_stages(context.task):
            fallback = "general-text"
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
