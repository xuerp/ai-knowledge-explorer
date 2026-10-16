"""Replay the original six tasks against reviewed public evidence, without calls."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.decision_candidates import discover_candidates
from app.decision_constraints import current_claims
from app.decision_facts import normalized_facts
from app.engagement import EngagementService
from app.repository import KnowledgeRepository
from app.schemas import DecisionContext, KnowledgeSnapshot

TASKS = ROOT / "backend/data/decision_acceptance_tasks.v1.json"


def evaluate(snapshot: KnowledgeSnapshot) -> dict:
    current = current_claims(snapshot.claims, snapshot)
    by_entity = defaultdict(list)
    for claim in current:
        by_entity[claim.entity_id].append(claim)
    current_ids = {claim.id for claim in current}
    entities = {entity.id: entity for entity in snapshot.entities}
    cases = []
    for case in json.loads(TASKS.read_text("utf-8"))["cases"]:
        context = DecisionContext.model_validate(case["context"])
        ids, scope = discover_candidates(context, snapshot, by_entity, "zh")
        decision = EngagementService._build_decision(
            context,
            [claim for claim in current if claim.entity_id in ids],
            ids,
            snapshot,
            "zh",
        )
        expected = case["expected"]
        checks = {
            "requiredCandidates": set(expected["required"])
            <= set(decision.plan.trial_candidate_ids),
            "citationsExist": all(
                key in current_ids
                for row in decision.candidates
                for finding in row.strengths
                for key in finding.claim_ids
            ),
            "qualifiedFeatures": all(
                set(decision.scenario.required_features)
                <= {finding.dimension for finding in row.strengths}
                for row in decision.candidates
                if row.entity_id in decision.plan.trial_candidate_ids
            ),
        }
        if expected["kind"] == "scoped-cost":
            checks["primary"] = decision.recommendation.primary_entity_id == expected["primary"]
            checks["costScope"] = decision.recommendation.basis == "comparable-cost"
        if expected["kind"] in {"clarification", "strict-constraints"}:
            checks["noInventedRecommendation"] = (
                not decision.recommendation.primary_entity_id
                and not decision.plan.trial_candidate_ids
            )
            checks["inputRequired"] = decision.plan.state == "needs-input"
        if expected["kind"] == "strict-constraints":
            checks["constraintsAudited"] = bool(decision.candidates) and all(
                row.eligibility in {"excluded", "unknown", "conflict"}
                for row in decision.candidates
            )
            checks["constraintsRetained"] = (
                context.minimum_context_tokens == 2000000
                and context.deployment == "on-device"
                and context.commercial_use_required
            )
        if case["id"] == "task-4":
            checks["productRoute"] = decision.scenario.id == "knowledge-workspace" and all(
                entities[key].type != "model" for key in ids
            )
        used = {
            key
            for row in decision.candidates
            for finding in row.strengths
            for key in finding.claim_ids
        } | {key for row in decision.candidates for key in row.claim_ids}
        receipt = {
            "id": case["id"],
            "title": case["title"],
            "context": context.model_dump(mode="json", by_alias=True),
            "checks": checks,
            "passed": all(checks.values()),
            "scenario": decision.scenario.id,
            "state": decision.plan.state,
            "trialCandidateIds": decision.plan.trial_candidate_ids,
            "primaryEntityId": decision.recommendation.primary_entity_id,
            "summary": decision.recommendation.summary,
            "consideredIds": scope.considered_entity_ids,
            "evidenceUsed": [
                {
                    "claimId": claim.id,
                    "entityId": claim.entity_id,
                    "predicate": claim.predicate,
                    "sourceIds": claim.source_ids,
                }
                for claim in current
                if claim.id in used
            ],
            "gaps": [
                {
                    "entityId": row.entity_id,
                    "dimension": gap.dimension,
                    "reason": gap.reason,
                    "claimIds": gap.claim_ids,
                }
                for row in decision.candidates
                for gap in row.gaps
            ],
            "decision": decision.model_dump(mode="json", by_alias=True),
        }
        cases.append(receipt)
    # Surface unusable existing records separately from a claim of missing
    # market evidence. Company/family facts must not become concrete model facts.
    unconsumed = []
    relevant_predicates = {
        "has-context-window",
        "has-max-context",
        "has-default-context",
        "supports-long-context",
        "input-price",
        "output-price",
        "has-price",
        "licensed-under",
        "supports-input",
        "context-window",
        "context",
    }
    for claim in snapshot.claims:
        if claim.predicate not in relevant_predicates:
            continue
        entity = entities.get(claim.entity_id)
        reason = (
            "wrong-granularity"
            if entity
            and (entity.type == "company" or (entity.type == "model" and not entity.family_id))
            else "not-current"
            if claim.id not in current_ids
            else "configuration-scope"
            if claim.predicate == "has-default-context"
            else "not-structured"
            if not normalized_facts(claim)
            else None
        )
        if reason:
            unconsumed.append(
                {
                    "claimId": claim.id,
                    "entityId": claim.entity_id,
                    "predicate": claim.predicate,
                    "reason": reason,
                    "sourceIds": claim.source_ids,
                }
            )
    return {
        "generatedAt": datetime.now(UTC).isoformat(),
        "basis": "Original task text and declared structured inputs; public-source qualification, not measured business quality.",
        "taskFixtureSha256": hashlib.sha256(TASKS.read_bytes()).hexdigest(),
        "snapshotSha256": hashlib.sha256(
            snapshot.model_dump_json(by_alias=True).encode()
        ).hexdigest(),
        "counts": {
            "entities": len(snapshot.entities),
            "claims": len(snapshot.claims),
            "currentClaims": len(current),
            "sources": len(snapshot.evidence),
        },
        "cases": cases,
        "passed": sum(case["passed"] for case in cases),
        "unconsumedExistingRecords": unconsumed,
        "paidCalls": 0,
        "privateRecordsRead": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    snapshot = (
        KnowledgeSnapshot.model_validate_json(args.snapshot.read_bytes())
        if args.snapshot
        else KnowledgeRepository(ROOT / "backend/data/demo_snapshot.json").load_seed()
    )
    report = evaluate(snapshot)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "passed": report["passed"],
                "total": len(report["cases"]),
                "cases": [
                    {
                        "id": case["id"],
                        "passed": case["passed"],
                        "state": case["state"],
                        "primary": case["primaryEntityId"],
                    }
                    for case in report["cases"]
                ],
            }
        )
    )


if __name__ == "__main__":
    main()
