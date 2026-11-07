from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.evaluation_scope import corpus_fingerprint
from app.schemas import KnowledgeSnapshot


def build_attempt_status(record: dict[str, Any], *, artifact_path: str) -> dict[str, Any]:
    if "failure" in record:
        failure = record["failure"]
        error = re.search(r"HTTP (\d{3})", failure.get("providerFailure") or "")
        return {
            "status": "failed",
            "retrievalMode": "hybrid",
            "observedAt": record["metadata"]["observedAt"],
            "artifactPath": artifact_path,
            "failureCode": f"HTTP {error[1]}" if error else failure["errorType"],
            "completedSamples": len(failure["completedResults"]),
            "sampleCount": failure["preflight"]["queryCount"],
        }
    if (
        record["metadata"]["retrievalMode"] != "hybrid"
        or len(record["results"]) != record["metadata"]["sampleCount"]
    ):
        raise ValueError("A completed hybrid attempt requires all declared samples.")
    if any(
        (row.get("diagnostics", {}).get("fallbackReason") or "").startswith("hybrid-")
        for row in record["results"]
    ):
        raise ValueError(
            "A degraded lexical result cannot be published as completed hybrid evaluation."
        )
    return {
        "status": "completed",
        "retrievalMode": record["metadata"]["retrievalMode"],
        "observedAt": record["metadata"]["evaluatedAt"],
        "artifactPath": artifact_path,
        "failureCode": None,
        "completedSamples": len(record["results"]),
        "sampleCount": record["metadata"]["sampleCount"],
    }


def build_quality_evaluation(
    report: dict[str, Any],
    *,
    artifact_path: str,
    snapshot_bytes: bytes,
) -> dict[str, object]:
    metadata = report["metadata"]
    metrics = report["metrics"]["overall"]
    if hashlib.sha256(snapshot_bytes).hexdigest() != metadata["snapshotSha256"]:
        raise ValueError("The reference snapshot does not match the evaluated artifact.")
    snapshot = KnowledgeSnapshot.model_validate_json(snapshot_bytes)
    samples = report["results"]
    claim_ids = {claim.id for claim in snapshot.claims}
    annotations = [sample["expectedClaimIds"] for sample in samples]
    if len(samples) != metadata["sampleCount"] or any(
        not ids or not set(ids).issubset(claim_ids) for ids in annotations
    ):
        raise ValueError("Evaluation annotations do not match the reference corpus.")
    if metadata["topK"] != 8 or not samples:
        raise ValueError("The public dashboard requires a nonempty TopK=8 report.")
    for name, field in (
        ("recallAtK", "claimRecallAtK"),
        ("precisionAtK", "precisionAtK"),
        ("entityRecallAtK", "entityRecallAtK"),
        ("passRatio", "passed"),
    ):
        calculated = round(sum(row[field] for row in samples) / len(samples), 4)
        if calculated != metrics[name]:
            raise ValueError("Evaluation aggregate metrics do not match the per-question results.")
    return {
        "updatedAt": metadata["evaluatedAt"],
        "cadence": "on-evaluation-publication",
        "artifactPath": artifact_path,
        "goldenSetVersion": metadata["goldenSetVersion"],
        "sampleCount": metadata["sampleCount"],
        "snapshotSha256": metadata["snapshotSha256"],
        "retrievalMode": metadata["retrievalMode"],
        "embeddingModel": metadata.get("embeddingModel"),
        "topK": metadata["topK"],
        "evaluationCommit": metadata["evaluationCommit"],
        "recallAt8": metrics["recallAtK"],
        "precisionAt8": metrics["precisionAtK"],
        "entityRecallAt8": metrics["entityRecallAtK"],
        "passRatio": metrics["passRatio"],
        **(
            {"categories": report["metrics"]["categories"]}
            if metadata.get("fingerprintVersion") == 2
            else {}
        ),
        "reference": {
            "corpusSha256": corpus_fingerprint(
                snapshot, version=metadata.get("fingerprintVersion", 1)
            ),
            "expectedClaimIdsBySample": annotations,
            **(
                {
                    "fingerprintVersion": 2,
                    "retrievalImplementationSha256": metadata["retrievalImplementationSha256"],
                    "goldenSetSha256": metadata["goldenSetSha256"],
                    "retrievalConfiguration": {
                        "retrievalMode": metadata["retrievalMode"],
                        "databaseDialect": metadata["databaseDialect"],
                        "embeddingProvider": metadata.get("embeddingProvider", "none"),
                        "embeddingModel": metadata.get("embeddingModel"),
                        "embeddingVersion": metadata.get("embeddingVersion"),
                        "embeddingDimension": metadata.get("embeddingDimension"),
                    },
                }
                if metadata.get("fingerprintVersion") == 2
                else {}
            ),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="从已提交检索评估产物生成质量看板的低频指标快照。")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--artifact-path", required=True)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--latest-attempt", type=Path)
    parser.add_argument("--attempt-artifact-path")
    parser.add_argument("--attempt-status-output", type=Path)
    args = parser.parse_args()
    if any(
        [args.latest_attempt, args.attempt_artifact_path, args.attempt_status_output]
    ) and not all([args.latest_attempt, args.attempt_artifact_path, args.attempt_status_output]):
        raise ValueError("Attempt publication requires a source, artifact path and status output.")

    report = json.loads(args.source.read_text(encoding="utf-8"))
    payload = build_quality_evaluation(
        report,
        artifact_path=args.artifact_path,
        snapshot_bytes=args.snapshot.read_bytes(),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if args.latest_attempt:
        record = json.loads(args.latest_attempt.read_text(encoding="utf-8"))
        args.attempt_status_output.parent.mkdir(parents=True, exist_ok=True)
        args.attempt_status_output.write_text(
            json.dumps(
                build_attempt_status(record, artifact_path=args.attempt_artifact_path),
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
