from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.database import Base
from app.rag import LexicalRagRetriever
from app.schemas import KnowledgeSnapshot

EXPECTED_CATEGORIES = {"entity": 30, "relation": 20, "timeline": 20, "comparison": 10}


def read_bytes(path: Path) -> bytes:
    if path.suffix == ".gz":
        with gzip.open(path, "rb") as handle:
            return handle.read()
    return path.read_bytes()


def load_snapshot(path: Path) -> tuple[KnowledgeSnapshot, str]:
    payload = read_bytes(path)
    return KnowledgeSnapshot.model_validate_json(payload), hashlib.sha256(
        payload
    ).hexdigest()


def load_golden_set(path: Path) -> tuple[str, list[dict[str, Any]]]:
    samples = [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not samples:
        raise ValueError("Golden Set 不能为空。")
    versions = {str(item.get("version")) for item in samples}
    if len(versions) != 1:
        raise ValueError("Golden Set 必须且只能包含一个版本。")
    ids = [str(item.get("id")) for item in samples]
    if len(ids) != len(set(ids)):
        raise ValueError("Golden Set 样本 ID 必须唯一。")
    categories = Counter(str(item.get("category")) for item in samples)
    if dict(categories) != EXPECTED_CATEGORIES:
        raise ValueError(f"Golden Set 类别分布错误：{dict(categories)}")
    for item in samples:
        if not item.get("query") or not item.get("expected_entity_ids"):
            raise ValueError(
                f"样本 {item.get('id')} 缺少 query 或 expected_entity_ids。"
            )
        if not item.get("expected_claim_ids"):
            raise ValueError(f"样本 {item.get('id')} 缺少 expected_claim_ids。")
    return versions.pop(), samples


def current_commit(repo_root: Path) -> str:
    return subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=repo_root, text=True
    ).strip()


def average(values: list[float]) -> float:
    return round(sum(values) / len(values), 4) if values else 0.0


def evaluate(
    snapshot: KnowledgeSnapshot,
    samples: list[dict[str, Any]],
    *,
    top_k: int,
    database_url: str,
) -> tuple[dict[str, Any], list[dict[str, Any]], str]:
    claim_ids = {claim.id for claim in snapshot.claims}
    entity_ids = {entity.id for entity in snapshot.entities}
    for sample in samples:
        missing_claims = set(sample["expected_claim_ids"]) - claim_ids
        missing_entities = set(sample["expected_entity_ids"]) - entity_ids
        if missing_claims or missing_entities:
            raise ValueError(
                f"样本 {sample['id']} 引用了快照中不存在的标注："
                f" claims={sorted(missing_claims)}, entities={sorted(missing_entities)}"
            )

    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    retriever = LexicalRagRetriever()
    results: list[dict[str, Any]] = []
    by_category: dict[str, list[dict[str, Any]]] = defaultdict(list)
    with Session(engine) as session:
        retriever.prepare(session, snapshot)
        for sample in samples:
            search = retriever.search(
                session,
                snapshot,
                str(sample["query"]),
                limit=top_k,
                prepared=True,
            )
            retrieved_claim_ids = [item.claim.id for item in search.citations]
            retrieved_entity_ids = {
                item.claim.entity_id
                for item in search.citations
                if item.claim.entity_id is not None
            }
            retrieved_entity_ids = retriever.expand_entity_scope(
                snapshot.entities, retrieved_entity_ids
            )
            expected_claims = set(sample["expected_claim_ids"])
            expected_entities = set(sample["expected_entity_ids"])
            relevant = expected_claims & set(retrieved_claim_ids)
            claim_recall = len(relevant) / len(expected_claims)
            precision = len(relevant) / top_k
            entity_recall = len(expected_entities & retrieved_entity_ids) / len(
                expected_entities
            )
            row = {
                "id": sample["id"],
                "category": sample["category"],
                "query": sample["query"],
                "expectedClaimIds": sorted(expected_claims),
                "retrievedClaimIds": retrieved_claim_ids,
                "claimRecallAtK": round(claim_recall, 4),
                "precisionAtK": round(precision, 4),
                "entityRecallAtK": round(entity_recall, 4),
                "passed": claim_recall == 1.0,
                "diagnostics": search.diagnostics.model_dump(
                    mode="json", by_alias=True
                ),
            }
            results.append(row)
            by_category[str(sample["category"])].append(row)

    def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "samples": len(rows),
            "recallAtK": average([row["claimRecallAtK"] for row in rows]),
            "precisionAtK": average([row["precisionAtK"] for row in rows]),
            "entityRecallAtK": average([row["entityRecallAtK"] for row in rows]),
            "passRatio": average([1.0 if row["passed"] else 0.0 for row in rows]),
        }

    metrics = {
        "overall": summarize(results),
        "categories": {
            category: summarize(by_category[category])
            for category in EXPECTED_CATEGORIES
        },
    }
    return metrics, results, engine.dialect.name


def markdown_summary(report: dict[str, Any]) -> str:
    metadata = report["metadata"]
    lines = [
        "# Lexical 检索基线评估",
        "",
        f"- Golden Set：v{metadata['goldenSetVersion']}（{metadata['sampleCount']} 条）",
        f"- 数据快照：`{metadata['snapshotSha256']}`",
        f"- 检索配置：`{metadata['retrievalMode']}`，TopK={metadata['topK']}",
        f"- 数据库方言：`{metadata['databaseDialect']}`",
        f"- 评估脚本提交：`{metadata['evaluationCommit']}`",
        "- Embedding：未启用",
        "",
        "| 范围 | 样本 | Recall@K | Precision@K | Entity Recall@K | 通过率 |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    rows = [
        ("总体", report["metrics"]["overall"]),
        *report["metrics"]["categories"].items(),
    ]
    for label, metrics in rows:
        lines.append(
            f"| {label} | {metrics['samples']} | {metrics['recallAtK']:.2%} | "
            f"{metrics['precisionAtK']:.2%} | {metrics['entityRecallAtK']:.2%} | "
            f"{metrics['passRatio']:.2%} |"
        )
    boundary = (
        "SQLite 结果是便携式基线，不等同于 PostgreSQL FTS 候选过滤结果。"
        if metadata["databaseDialect"] == "sqlite"
        else "PostgreSQL 结果来自隔离测试数据库，不代表生产数据库状态。"
    )
    lines.extend(
        [
            "",
            "Precision@K 固定以 K 为分母；目标 Claim 少于 K 时，其理论上限低于 100%。",
            "指标未做阈值美化，失败样本保留在 JSON 明细中。",
            boundary,
            "",
        ]
    )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="运行可复现的 AI Radar lexical 检索评估。"
    )
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--golden-set", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--top-k", type=int, default=8)
    parser.add_argument(
        "--database-url",
        default="sqlite://",
        help="评估专用数据库；默认使用隔离的内存 SQLite。",
    )
    parser.add_argument("--evaluation-commit")
    args = parser.parse_args()
    if args.top_k <= 0:
        raise ValueError("top-k 必须为正整数。")

    snapshot, snapshot_hash = load_snapshot(args.snapshot)
    version, samples = load_golden_set(args.golden_set)
    metrics, results, database_dialect = evaluate(
        snapshot,
        samples,
        top_k=args.top_k,
        database_url=args.database_url,
    )
    commit = args.evaluation_commit or current_commit(REPO_ROOT)
    report = {
        "metadata": {
            "goldenSetVersion": version,
            "sampleCount": len(samples),
            "snapshotPath": args.snapshot.as_posix(),
            "snapshotSha256": snapshot_hash,
            "snapshotRetrievedAt": snapshot.meta.retrieved_at,
            "snapshotCounts": {
                "entities": len(snapshot.entities),
                "claims": len(snapshot.claims),
                "evidence": len(snapshot.evidence),
                "relations": len(snapshot.graph.edges),
                "timeline": sum(len(items) for items in snapshot.timeline.values()),
            },
            "retrievalMode": "lexical",
            "databaseDialect": database_dialect,
            "embeddingModel": None,
            "topK": args.top_k,
            "evaluationCommit": commit,
            "evaluatedAt": datetime.now(UTC).isoformat(),
        },
        "metrics": metrics,
        "results": results,
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    stem = f"v{version}_{snapshot_hash[:12]}_{database_dialect}_lexical_top{args.top_k}"
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
                **metrics["overall"],
            }
        )
    )


if __name__ == "__main__":
    main()
