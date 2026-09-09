import json
import subprocess
import sys
from pathlib import Path


def test_relation_gap_diagnosis_is_reproducible_and_does_not_invent_pairs(tmp_path: Path):
    root = Path(__file__).resolve().parents[2]
    snapshot_path = root / "docs/eval/snapshots/public_snapshot_2026-08-30.json"
    script_path = root / "scripts/diagnose_relation_gaps.py"

    subprocess.run(
        [
            sys.executable,
            str(script_path),
            "--snapshot",
            str(snapshot_path),
            "--output-dir",
            str(tmp_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    report_path = tmp_path / "relation_gap_diagnosis_v1.0.0_8978fef80e19.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))

    assert report["summary"] == {
        "publishedRelations": 76,
        "publishedGroundedRelations": 76,
        "coreEntities": 19,
        "coreEntitiesBelowExistingQualityThreshold": 16,
        "distanceToExistingQualityThreshold": 44,
        "officialEvidence": 212,
        "officialEvidenceUnusedByRelations": 181,
        "unusedOfficialEvidenceAssociatedWithCoreEntities": 83,
    }
    assert [item["relationKind"] for item in report["ontologyCoverage"]] == [
        "developed-by",
        "based-on",
        "competes-with",
        "benchmarked-on",
        "uses",
        "cited-by",
        "part-of",
        "successor-of",
        "integrates-with",
    ]
    assert sum(item["publishedGroundedRelations"] for item in report["ontologyCoverage"]) == 76
    assert all(
        item["evidenceId"]
        not in {
            source_id
            for relation in json.loads(snapshot_path.read_text(encoding="utf-8"))["graph"]["edges"]
            for source_id in relation["sourceIds"]
        }
        for item in report["unusedOfficialEvidence"]
    )
    assert "suggestedPairs" not in report
    assert "does not propose entity pairs" in report["interpretationBoundary"]
