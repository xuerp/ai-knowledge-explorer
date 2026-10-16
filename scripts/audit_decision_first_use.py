"""Replay authored new-use requests through public evidence; no model calls."""

import argparse
import json
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.decision_candidates import discover_candidates
from app.decision_constraints import current_claims
from app.engagement import EngagementService
from app.repository import KnowledgeRepository
from app.schemas import DecisionContext


def evaluate(snapshot, inputs):
    current = current_claims(snapshot.claims, snapshot)
    by_entity = defaultdict(list)
    for claim in current:
        by_entity[claim.entity_id].append(claim)
    current_ids = {claim.id for claim in current}
    results = []
    for row in inputs["cases"]:
        context = DecisionContext.model_validate(row["context"])
        ids, _ = discover_candidates(context, snapshot, by_entity, "zh")
        decision = EngagementService._build_decision(
            context, [claim for claim in current if claim.entity_id in ids], ids, snapshot, "zh"
        )
        checks = {
            "frontendScenario": row["frontendScenario"] == row["scenario"],
            "backendScenario": decision.scenario.id == row["scenario"],
            "citationsCurrent": all(
                key in current_ids
                for candidate in decision.candidates
                for finding in candidate.strengths
                for key in finding.claim_ids
            ),
            "noPersonalChannel": not context.budget.channel
            and "CCSub" not in decision.recommendation.summary,
        }
        if row.get("type"):
            checks["taskType"] = context.task_type == row["type"]
        if row.get("image"):
            checks["imageRetained"] = "image" in context.input_modalities
        if row.get("features"):
            checks["requestedFeaturesRetained"] = set(row["features"]) <= set(
                decision.scenario.required_features
            )
            checks["frontendFeaturesRetained"] = set(row["features"]) <= set(
                row["frontendFeatures"]
            )
        if row["kind"] == "qualified":
            checks["usableCandidate"] = decision.plan.state == "ready-to-validate" and bool(
                decision.plan.trial_candidate_ids
            )
        if row["kind"] in {"clarify", "strict"}:
            checks["noInventedRecommendation"] = (
                not decision.plan.trial_candidate_ids
                and not decision.recommendation.primary_entity_id
            )
            checks["asksForInput"] = decision.plan.state == "needs-input"
        if row["kind"] == "strict":
            checks["hardConditionsRetained"] = (
                context.deployment == "on-device"
                and context.minimum_context_tokens == 2000000
                and context.commercial_use_required
            )
            checks["conditionsAudited"] = bool(decision.candidates)
        if row["kind"] == "cost-unconfirmed":
            checks["budgetRetained"] = (
                context.budget.max == 100 and context.budget.currency == "CNY"
            )
            checks["noInventedPriceWinner"] = decision.recommendation.basis != "comparable-cost"
        results.append(
            {
                "id": row["id"],
                "task": row["task"],
                "checks": checks,
                "passed": all(checks.values()),
                "scenario": decision.scenario.id,
                "state": decision.plan.state,
                "summary": decision.recommendation.summary,
                "trialCandidateIds": decision.plan.trial_candidate_ids,
                "context": context.model_dump(mode="json", by_alias=True),
                "decision": decision.model_dump(mode="json", by_alias=True),
            }
        )
    return {
        "generatedAt": datetime.now(UTC).isoformat(),
        "basis": inputs["basis"],
        "passed": sum(row["passed"] for row in results),
        "total": len(results),
        "cases": results,
        "paidCalls": 0,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    snapshot = KnowledgeRepository(ROOT / "backend/data/demo_snapshot.json").load_seed()
    report = evaluate(snapshot, json.loads(args.inputs.read_text("utf-8")))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "passed": report["passed"],
                "total": report["total"],
                "failures": [
                    {
                        "id": row["id"],
                        "checks": [key for key, value in row["checks"].items() if not value],
                        "scenario": row["scenario"],
                        "state": row["state"],
                    }
                    for row in report["cases"]
                    if not row["passed"]
                ],
            }
        )
    )
