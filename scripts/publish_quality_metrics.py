from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.evaluation_scope import corpus_fingerprint
from app.schemas import KnowledgeSnapshot


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
        "reference": {
            "corpusSha256": corpus_fingerprint(snapshot),
            "expectedClaimIdsBySample": annotations,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="从已提交检索评估产物生成质量看板的低频指标快照。")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--artifact-path", required=True)
    parser.add_argument("--snapshot", type=Path, required=True)
    args = parser.parse_args()

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


if __name__ == "__main__":
    main()
