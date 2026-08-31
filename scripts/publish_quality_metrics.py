from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def build_quality_evaluation(
    report: dict[str, Any],
    *,
    artifact_path: str,
) -> dict[str, object]:
    metadata = report["metadata"]
    metrics = report["metrics"]["overall"]
    return {
        "updatedAt": metadata["evaluatedAt"],
        "cadence": "daily-or-on-retrieval-change",
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
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="从已提交检索评估产物生成质量看板的低频指标快照。")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--artifact-path", required=True)
    args = parser.parse_args()

    report = json.loads(args.source.read_text(encoding="utf-8"))
    payload = build_quality_evaluation(report, artifact_path=args.artifact_path)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
