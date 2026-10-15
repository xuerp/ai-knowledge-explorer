"""The maintenance audit must reveal missing evidence without promoting it."""

import importlib.util
from pathlib import Path

from app.schemas import KnowledgeSnapshot

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "coverage_audit", ROOT / "scripts/audit_decision_coverage.py"
)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def test_missing_facts_stay_missing_and_audit_never_mutates_or_calls_a_model():
    snapshot = KnowledgeSnapshot.model_validate_json(
        (ROOT / "backend/data/demo_snapshot.json").read_bytes()
    ).model_copy(update={"claims": [], "evidence": []})
    original = snapshot.model_dump_json()
    report = audit.evaluate(snapshot)
    assert report["paidCalls"] == 0 and report["privateRecordsRead"] is False
    assert len(report["cases"]) == 12
    assert len({case["id"] for case in report["cases"]}) == 12
    assert all(not case["trialCandidateIds"] for case in report["cases"])
    assert len(report["blockedCases"]) == 12
    assert all(case["state"] != "ready-to-validate" for case in report["cases"])
    assert {item["workKind"] for item in report["backlog"]} <= {
        "source-curation",
        "business-measurement",
        "user-input",
    }
    assert all(not item["sourceClaimIds"] for item in report["backlog"])
    assert report["counts"]["currentClaims"] == 0
    assert snapshot.model_dump_json() == original
