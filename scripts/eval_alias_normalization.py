from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.entity_aliases import apply_entity_aliases, load_entity_alias_catalog
from app.rag import LexicalRagRetriever
from eval_retrieval import current_commit, evaluate, load_golden_set, load_snapshot


def metric_delta(after: dict[str, Any], before: dict[str, Any]) -> dict[str, Any]:
    return {
        key: (
            metric_delta(after[key], before[key])
            if isinstance(after[key], dict)
            else round(after[key] - before[key], 4)
            if isinstance(after[key], float)
            else after[key] - before[key]
            if isinstance(after[key], int) and key != "samples"
            else 0
        )
        for key in after
    }


def markdown_summary(report: dict[str, Any]) -> str:
    metadata = report["metadata"]
    before = report["before"]["metrics"]["overall"]
    after = report["after"]["metrics"]["overall"]
    probes = report["aliasProbes"]
    lines = [
        "# 实体别名归一化前后对照",
        "",
        f"- Golden Set：v{metadata['goldenSetVersion']}（{metadata['sampleCount']} 条）",
        f"- 固定快照：`{metadata['snapshotSha256']}`",
        (
            f"- 别名目录：v{metadata['aliasCatalogVersion']} "
            f"(`{metadata['aliasCatalogSha256']}`)"
        ),
        f"- 数据库方言：`{metadata['databaseDialect']}`；TopK={metadata['topK']}",
        f"- 评估脚本提交：`{metadata['evaluationCommit']}`",
        "- Embedding：未启用",
        "",
        "| 范围 | Recall@8 | Precision@8 | Entity Recall@8 | 通过率 |",
        "|---|---:|---:|---:|---:|",
        (
            f"| 归一化前 | {before['recallAtK']:.2%} | {before['precisionAtK']:.2%} | "
            f"{before['entityRecallAtK']:.2%} | {before['passRatio']:.2%} |"
        ),
        (
            f"| 归一化后 | {after['recallAtK']:.2%} | {after['precisionAtK']:.2%} | "
            f"{after['entityRecallAtK']:.2%} | {after['passRatio']:.2%} |"
        ),
        "",
        (
            f"别名探针：归一化前 {probes['beforePassed']}/{probes['samples']}，"
            f"归一化后 {probes['afterPassed']}/{probes['samples']}。"
        ),
        (
            "Golden Set 已处于实体召回天花板时，主指标不应被人为美化；新增覆盖由同快照的"
            "逐别名确定性探针补充证明。"
        ),
        "独立 alias 表是 payload 别名的可重建规范化索引，不是第二事实源。",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="对照实体别名归一化前后的检索结果。")
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--golden-set", type=Path, required=True)
    parser.add_argument("--alias-catalog", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--top-k", type=int, default=8)
    parser.add_argument("--database-url", default="sqlite://")
    parser.add_argument("--evaluation-commit")
    parser.add_argument("--evaluated-at")
    args = parser.parse_args()
    if args.top_k <= 0:
        raise ValueError("top-k 必须为正整数。")

    before_snapshot, snapshot_hash = load_snapshot(args.snapshot)
    after_snapshot = before_snapshot.model_copy(deep=True)
    version, definitions, alias_hash = load_entity_alias_catalog(args.alias_catalog)
    apply_entity_aliases(after_snapshot.entities, definitions)
    golden_version, samples = load_golden_set(args.golden_set)

    before_metrics, before_results, before_dialect = evaluate(
        before_snapshot, samples, top_k=args.top_k, database_url=args.database_url
    )
    after_metrics, after_results, after_dialect = evaluate(
        after_snapshot, samples, top_k=args.top_k, database_url=args.database_url
    )
    if before_dialect != after_dialect:
        raise RuntimeError("前后评估数据库方言不一致。")

    probe_rows = []
    for definition in definitions:
        before_matches = sorted(
            LexicalRagRetriever.resolve_mentions(
                before_snapshot.entities, definition.alias
            )
        )
        after_matches = sorted(
            LexicalRagRetriever.resolve_mentions(
                after_snapshot.entities, definition.alias
            )
        )
        probe_rows.append(
            {
                "entityId": definition.entity_id,
                "alias": definition.alias,
                "aliasType": definition.alias_type,
                "beforeMatchedEntityIds": before_matches,
                "afterMatchedEntityIds": after_matches,
                "beforePassed": definition.entity_id in before_matches,
                "afterPassed": definition.entity_id in after_matches,
            }
        )

    evaluated_at = args.evaluated_at or datetime.now(UTC).isoformat()
    report = {
        "metadata": {
            "goldenSetVersion": golden_version,
            "sampleCount": len(samples),
            "snapshotSha256": snapshot_hash,
            "aliasCatalogVersion": version,
            "aliasCatalogSha256": alias_hash,
            "retrievalMode": "lexical",
            "databaseDialect": before_dialect,
            "topK": args.top_k,
            "evaluationCommit": args.evaluation_commit or current_commit(REPO_ROOT),
            "evaluatedAt": evaluated_at,
        },
        "before": {"metrics": before_metrics, "results": before_results},
        "after": {"metrics": after_metrics, "results": after_results},
        "delta": metric_delta(after_metrics, before_metrics),
        "aliasProbes": {
            "samples": len(probe_rows),
            "beforePassed": sum(row["beforePassed"] for row in probe_rows),
            "afterPassed": sum(row["afterPassed"] for row in probe_rows),
            "results": probe_rows,
        },
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    stem = f"alias_v{version}_{snapshot_hash[:12]}_{before_dialect}_top{args.top_k}"
    json_path = args.output_dir / f"{stem}.json"
    markdown_path = args.output_dir / f"{stem}.md"
    json_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    markdown_path.write_text(markdown_summary(report), encoding="utf-8")
    print(
        json.dumps(
            {
                "json": str(json_path),
                "markdown": str(markdown_path),
                "before": before_metrics["overall"],
                "after": after_metrics["overall"],
                "aliasProbes": report["aliasProbes"] | {"results": None},
            }
        )
    )


if __name__ == "__main__":
    main()
