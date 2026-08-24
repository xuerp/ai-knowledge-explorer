from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .schemas import ReleaseBaseline


def render_markdown(payload: dict[str, Any]) -> str:
    report = ReleaseBaseline.model_validate(payload)
    rag = report.golden_questions.rag_metrics
    lines = [
        "# AI Radar 发布基线",
        "",
        f"- 生成时间：{report.generated_at.isoformat()}",
        f"- 发布标识：`{report.build.release}`",
        f"- 构建提交：`{report.build.build_commit}`",
        f"- 数据库迁移：`{report.build.schema_revision}`",
        f"- 数据模式：`{report.build.data_mode}`",
        "",
        "## Claim 口径",
        "",
        "| 指标 | 数量 |",
        "| --- | ---: |",
        f"| 公开 Claim | {report.claims.public_claim_count} |",
        f"| 已关联实体的公开 Claim | {report.claims.entity_linked_public_claim_count} |",
        f"| 已批准 Claim | {report.claims.approved_claim_count} |",
        f"| 人工审核 Claim | {report.claims.human_reviewed_claim_count} |",
        f"| 自动批准关系 Claim | {report.claims.auto_approved_relation_claim_count} |",
        f"| 当前 Claim | {report.claims.current_claim_count} |",
        f"| 历史 Claim | {report.claims.historical_claim_count} |",
        "",
        "## 数据质量与 RAG",
        "",
        "| 指标 | 当前值 |",
        "| --- | ---: |",
        f"| 实体 | {report.quality.entity_count} |",
        f"| Evidence | {report.quality.evidence_count} |",
        f"| 关系 | {report.quality.relation_count} |",
        f"| 核心关系缺口 | {report.quality.core_relation_deficit} |",
        f"| 缺失实体 Claim | {len(report.quality.claims_with_missing_entity)} |",
        f"| 黄金问题通过率 | {report.golden_questions.pass_ratio:.2%} |",
        f"| RAG 检索通过率 | {(report.golden_questions.retrieval_pass_ratio or 0):.2%} |",
        f"| RAG 实体 Recall@8 | {(rag.entity_recall_at_8 if rag else 0):.2%} |",
        f"| Live Ready | {'是' if report.quality.live_ready else '否'} |",
        "",
        "## 运行与审核",
        "",
        f"- 自动任务心跳：`{report.operations.heartbeat_status}`",
        f"- 待审核总数：{report.review_queue.open_total}",
        f"- 待抽取快照：{report.operations.queues.extraction_ready}",
        f"- 抽取冷却：{report.operations.queues.extraction_retrying}",
        f"- 正式就绪阻塞项：{report.readiness.blocking_count}",
        "",
        "## 信源健康",
        "",
        "| 状态 | 数量 |",
        "| --- | ---: |",
    ]
    labels = {
        "healthy": "健康",
        "retrying": "重试中",
        "paused": "已熔断",
        "manual": "手动采集",
        "unverified": "待预检",
    }
    lines.extend(
        f"| {labels.get(state, state)} | {count} |" for state, count in report.source_health.items()
    )
    return "\n".join(lines) + "\n"


def _read_payload(path: str) -> dict[str, Any]:
    raw = sys.stdin.read() if path == "-" else Path(path).read_text(encoding="utf-8")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise TypeError("发布基线输入必须是 JSON 对象。")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="把脱敏的 AI Radar 发布基线 JSON 转换为中文报告。")
    parser.add_argument(
        "--input",
        default="-",
        help="基线 JSON 文件路径；默认从标准输入读取。",
    )
    parser.add_argument("--format", choices=("markdown",), default="markdown")
    args = parser.parse_args()
    try:
        payload = _read_payload(args.input)
        sys.stdout.write(render_markdown(payload))
    except (OSError, TypeError, ValueError, json.JSONDecodeError) as error:
        print(f"无法生成发布基线：{error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
