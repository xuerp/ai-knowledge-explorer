"""Measure actionable evidence gaps on public data; no HTTP, users, or model calls."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.decision_candidates import CATALOG, discover_candidates
from app.decision_constraints import current_claims
from app.engagement import EngagementService
from app.repository import KnowledgeRepository
from app.schemas import DecisionContext, KnowledgeSnapshot


def evaluate(snapshot: KnowledgeSnapshot) -> dict:
    current = current_claims(snapshot.claims, snapshot)
    by_entity = defaultdict(list)
    for claim in current:
        by_entity[claim.entity_id].append(claim)
    names = {entity.id: entity.name.en for entity in snapshot.entities}
    cases, gaps = [], {}
    for scenario in CATALOG["scenarios"]:
        deployments = (
            ["undecided", "cloud-api"]
            if scenario["taskType"] == "model-api"
            else ["undecided"]
        )
        for deployment in deployments:
            case_id = f"{scenario['id']}:{deployment}"
            context = DecisionContext(
                workflow_version=2,
                task=scenario["name"]["zh"] + "选型",
                task_type=scenario["taskType"],
                priority="balanced",
                deployment=deployment,
            )
            ids, _ = discover_candidates(context, snapshot, by_entity, "zh")
            decision = EngagementService._build_decision(
                context,
                [claim for claim in current if claim.entity_id in ids],
                ids,
                snapshot,
                "zh",
            )
            ready = decision.plan.trial_candidate_ids
            cases.append(
                {
                    "id": case_id,
                    "scenario": scenario["id"],
                    "deployment": deployment,
                    "candidateCount": len(ids),
                    "trialCandidateIds": ready,
                    "trialCandidates": [names.get(key, key) for key in ready],
                    "state": decision.plan.state,
                }
            )
            for candidate in decision.candidates:
                for gap in candidate.gaps:
                    key = (candidate.entity_id, gap.dimension, gap.reason)
                    entry = gaps.setdefault(
                        key,
                        {
                            "entityId": candidate.entity_id,
                            "name": names.get(candidate.entity_id),
                            "dimension": gap.dimension,
                            "reason": gap.reason,
                            "caseIds": [],
                            "sourceClaimIds": set(),
                            "blocksAllCandidatesInCases": [],
                        },
                    )
                    entry["caseIds"].append(case_id)
                    entry["sourceClaimIds"].update(gap.claim_ids)
                    if not ready:
                        entry["blocksAllCandidatesInCases"].append(case_id)
    backlog = []
    for entry in gaps.values():
        entry["sourceClaimIds"] = sorted(entry["sourceClaimIds"])
        entry["caseIds"] = sorted(set(entry["caseIds"]))
        entry["workKind"] = (
            "user-input"
            if entry["reason"] == "needs-input"
            else "business-measurement"
            if entry["reason"] == "requires-poc"
            else "source-curation"
        )
        backlog.append(entry)
    backlog.sort(
        key=lambda row: (
            row["workKind"] != "source-curation",
            -len(row["blocksAllCandidatesInCases"]),
            -len(row["caseIds"]),
            row["entityId"],
            row["dimension"],
            row["reason"],
        )
    )
    return {
        "basis": "reviewed public evidence; trial eligibility, never measured quality",
        "counts": {
            "entities": len(snapshot.entities),
            "claims": len(snapshot.claims),
            "currentClaims": len(current),
            "sources": len(snapshot.evidence),
        },
        "currentPredicates": dict(
            sorted(
                Counter(claim.predicate or "unspecified" for claim in current).items()
            )
        ),
        "cases": cases,
        "blockedCases": [
            {
                "caseId": row["id"],
                "reason": "no-relevant-candidate"
                if not row["candidateCount"]
                else "no-qualified-candidate",
            }
            for row in cases
            if not row["trialCandidateIds"]
        ],
        "backlog": backlog,
        "paidCalls": 0,
        "privateRecordsRead": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--snapshot",
        type=Path,
        help="An explicit public snapshot; defaults to the reviewed repository catalog",
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    snapshot = (
        KnowledgeSnapshot.model_validate_json(args.snapshot.read_bytes())
        if args.snapshot
        else KnowledgeRepository(ROOT / "backend/data/demo_snapshot.json").load_seed()
    )
    report = evaluate(snapshot)
    report.update(
        generatedAt=datetime.now(UTC).isoformat(),
        sourceCommit=subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        sourceKind="explicit-public-snapshot"
        if args.snapshot
        else "committed-public-catalog",
        snapshotSha256=hashlib.sha256(
            snapshot.model_dump_json(by_alias=True).encode()
        ).hexdigest(),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "output": str(args.output),
                **report["counts"],
                "cases": len(report["cases"]),
                "blockedCases": [
                    row["id"] for row in report["cases"] if not row["trialCandidateIds"]
                ],
            }
        )
    )


if __name__ == "__main__":
    main()
