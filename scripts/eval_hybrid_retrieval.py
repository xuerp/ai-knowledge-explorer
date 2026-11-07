from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy.exc import SQLAlchemyError

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from eval_retrieval import current_commit, evaluate, load_golden_set, read_bytes

from app.embeddings import (
    CloudflareEmbeddingProvider,
    EmbeddingProviderError,
    embedding_token_upper_bound,
)
from app.entity_aliases import apply_entity_aliases, load_entity_alias_catalog
from app.evaluation_scope import retrieval_implementation_fingerprint
from app.rag import (
    HybridRagRetriever,
    LexicalRagRetriever,
    SqlAlchemyVectorClaimIndex,
    grounded_retrieval_citations,
)
from app.schemas import KnowledgeSnapshot

CANARY_TEXT = "AI Radar retrieval contract check"


class AuditedEmbeddingProvider(CloudflareEmbeddingProvider):
    last_failure: str | None = None
    last_failure_details: dict[str, Any] | None = None

    def _embed_batch(self, texts: list[str]) -> list[list[float]]:
        try:
            return super()._embed_batch(texts)
        except EmbeddingProviderError as error:
            self.last_failure = str(error)
            self.last_failure_details = error.upstream_details
            raise


def build_document_texts(snapshot: KnowledgeSnapshot) -> list[str]:
    entity_by_id = {item.id: item for item in snapshot.entities}
    # sync_snapshot upserts by claim ID; shared timeline entries use their last projection.
    citations_by_id = {
        citation.claim.id: citation for citation in grounded_retrieval_citations(snapshot)
    }
    return [
        LexicalRagRetriever.document_text(
            citation.claim, entity_by_id[citation.claim.entity_id], citation.evidence
        )
        for citation in citations_by_id.values()
    ]


def markdown_summary(report: dict[str, Any]) -> str:
    metadata = report["metadata"]
    metrics = report["metrics"]["overall"]
    usage = report["usage"]
    return "\n".join(
        [
            "# Hybrid 检索路径评估（隔离数据库）",
            "",
            f"- Provider：`{metadata['embeddingProvider']}`",
            f"- 模型：`{metadata['embeddingModel']}`",
            f"- 版本：`{metadata['embeddingVersion']}`；维度：{metadata['embeddingDimension']}",
            f"- Golden Set：v{metadata['goldenSetVersion']}（{metadata['sampleCount']} 条）",
            f"- 快照：`{metadata['snapshotSha256']}`",
            f"- 别名目录：v{metadata['aliasCatalogVersion']} (`{metadata['aliasCatalogSha256']}`)",
            f"- 评测提交：`{metadata['evaluationCommit']}`",
            f"- 数据库方言：`{metadata['databaseDialect']}`（隔离评估数据库）",
            "",
            "| Recall@8 | Precision@8 | Entity Recall@8 | 通过率 |",
            "| ---: | ---: | ---: | ---: |",
            (
                f"| {metrics['recallAtK']:.2%} | {metrics['precisionAtK']:.2%} | "
                f"{metrics['entityRecallAtK']:.2%} | {metrics['passRatio']:.2%} |"
            ),
            "",
            f"- API 请求尝试：{usage.get('attemptedApiCalls', usage['apiCalls'])} / {usage['dailyApiCallBudget']}",
            (
                f"- 保守 token 上界：{usage['conservativeTokenUpperBound']}；"
                f"估算 Neurons：{usage['estimatedNeurons']} / {usage['dailyNeuronBudget']}"
            ),
            "",
            "本结果使用与线上配置匹配的 Cloudflare provider、版本化索引与 RRF union 路径。",
            "评估在隔离数据库中执行，不代表线上延迟、稳定性或业务问答准确率。",
            "Cloudflare 响应不提供可核验账单金额；免费层状态仍需在账户控制台确认。",
            "",
        ]
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="评估生产 Cloudflare hybrid 检索路径。")
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--golden-set", type=Path, required=True)
    parser.add_argument("--alias-catalog", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--model", default="@cf/baai/bge-m3")
    parser.add_argument(
        "--model-version",
        default="cloudflare-managed:@cf/baai/bge-m3:2026-08-31-baseline",
    )
    parser.add_argument("--dimension", type=int, default=1024)
    parser.add_argument("--top-k", type=int, default=8)
    parser.add_argument("--rrf-k", type=int, default=60)
    parser.add_argument("--database-url", default="sqlite://", help="仅使用评估专用隔离数据库。")
    parser.add_argument("--max-batch-size", type=int, default=100)
    parser.add_argument("--daily-neuron-budget", type=float, default=0)
    parser.add_argument("--neurons-per-million-tokens", type=float, default=1075)
    parser.add_argument("--daily-api-call-budget", type=int, default=0)
    parser.add_argument("--account-id-env", default="CLOUDFLARE_ACCOUNT_ID")
    parser.add_argument("--api-token-env", default="CLOUDFLARE_API_TOKEN")
    parser.add_argument("--evaluation-commit")
    parser.add_argument("--allow-external-api", action="store_true")
    parser.add_argument(
        "--canary-first",
        action="store_true",
        help="先验证一次未计分的接口小样本，成功后才进行固定题集。",
    )
    parser.add_argument(
        "--preflight-only", action="store_true", help="只保存预算预检，不读取凭证或请求模型。"
    )
    args = parser.parse_args()
    if not 1 <= args.max_batch_size <= 100 or args.top_k <= 0 or args.dimension <= 0:
        raise ValueError("Batch size, top K and embedding dimension must be positive.")

    snapshot_bytes = read_bytes(args.snapshot)
    snapshot = KnowledgeSnapshot.model_validate_json(snapshot_bytes)
    golden_version, samples = load_golden_set(args.golden_set)
    alias_version, alias_definitions, alias_hash = load_entity_alias_catalog(args.alias_catalog)
    apply_entity_aliases(snapshot.entities, alias_definitions)
    document_texts = build_document_texts(snapshot)
    all_inputs = document_texts + [str(item["query"]) for item in samples]
    if args.canary_first:
        all_inputs.append(CANARY_TEXT)
    conservative_tokens = embedding_token_upper_bound(all_inputs)
    estimated_neurons = conservative_tokens / 1_000_000 * args.neurons_per_million_tokens
    expected_calls = (
        math.ceil(len(document_texts) / args.max_batch_size) + len(samples) + int(args.canary_first)
    )
    preflight = {
        "documentCount": len(document_texts),
        "queryCount": len(samples),
        "unscoredCanaryCount": int(args.canary_first),
        "expectedApiCalls": expected_calls,
        "conservativeTokenUpperBound": conservative_tokens,
        "estimatedNeurons": round(estimated_neurons, 4),
        "model": args.model,
        "modelVersion": args.model_version,
        "embeddingDimension": args.dimension,
        "snapshotSha256": hashlib.sha256(snapshot_bytes).hexdigest(),
        "goldenSetSha256": hashlib.sha256(args.golden_set.read_bytes()).hexdigest(),
        "externalCallsExecuted": 0,
    }
    if args.preflight_only:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        (args.output_dir / "hybrid-preflight.json").write_text(
            json.dumps(preflight, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(json.dumps(preflight))
        return
    if not args.allow_external_api:
        raise ValueError("Hybrid evaluation requires --allow-external-api authorization.")
    if args.daily_neuron_budget <= 0 or args.daily_api_call_budget <= 0:
        raise ValueError("Hybrid evaluation requires positive daily hard budgets.")
    if estimated_neurons > args.daily_neuron_budget:
        raise ValueError("Full evaluation would exceed the Neuron hard budget.")
    if expected_calls > args.daily_api_call_budget:
        raise ValueError("Full evaluation would exceed the API call hard budget.")
    account_id = os.getenv(args.account_id_env)
    api_token = os.getenv(args.api_token_env)
    if not account_id or not api_token:
        raise ValueError("Cloudflare evaluation credentials are not configured.")

    provider = AuditedEmbeddingProvider(
        account_id=account_id,
        api_token=api_token,
        model_name=args.model,
        model_version=args.model_version,
        dimension=args.dimension,
        daily_neuron_budget=args.daily_neuron_budget,
        neurons_per_million_tokens=args.neurons_per_million_tokens,
        daily_api_call_budget=args.daily_api_call_budget,
        max_batch_size=args.max_batch_size,
        timeout_seconds=60,
    )
    index = SqlAlchemyVectorClaimIndex(
        embedding_provider=provider.provider_name,
        embedding_model=provider.model_name,
        embedding_version=provider.model_version,
        embedding_dimension=provider.dimension,
    )
    retriever = HybridRagRetriever(
        embedding_provider=provider,
        vector_index=index,
        enabled=True,
        rrf_k=args.rrf_k,
    )
    completed: list[dict[str, Any]] = []
    canary_passed = False
    try:
        if args.canary_first:
            vector = provider.embed_query(CANARY_TEXT)
            if not any(value != 0 for value in vector):
                raise ValueError("The endpoint canary returned a zero vector.")
            canary_passed = True
        metrics, results, dialect = evaluate(
            snapshot,
            samples,
            top_k=args.top_k,
            database_url=args.database_url,
            retriever=retriever,
            result_sink=completed,
            require_hybrid=True,
        )
        usage = provider.usage()
    except (EmbeddingProviderError, SQLAlchemyError, ValueError) as error:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        (args.output_dir / "hybrid-failure.json").write_text(
            json.dumps(
                {
                    "status": "failed-no-retry",
                    "errorType": type(error).__name__,
                    "providerFailure": provider.last_failure,
                    "providerDetails": provider.last_failure_details,
                    "canaryPassed": canary_passed,
                    "preflight": preflight,
                    "usage": provider.usage(),
                    "completedResults": completed,
                    "nextQuestionId": samples[len(completed)]["id"]
                    if len(completed) < len(samples)
                    else None,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        raise SystemExit(
            "Hybrid evaluation stopped; inspect the redacted failure artifact. No retry was made."
        ) from None
    finally:
        provider.close()

    report = {
        "metadata": {
            "goldenSetVersion": golden_version,
            "sampleCount": len(samples),
            "snapshotSha256": hashlib.sha256(snapshot_bytes).hexdigest(),
            "aliasCatalogVersion": alias_version,
            "aliasCatalogSha256": alias_hash,
            "retrievalMode": "hybrid",
            "databaseDialect": dialect,
            "embeddingProvider": provider.provider_name,
            "embeddingModel": provider.model_name,
            "embeddingVersion": provider.model_version,
            "embeddingDimension": provider.dimension,
            "embeddingTransport": "cloudflare-native-run",
            "topK": args.top_k,
            "rrfK": args.rrf_k,
            "evaluationCommit": args.evaluation_commit or current_commit(REPO_ROOT),
            "evaluatedAt": datetime.now(UTC).isoformat(),
            **(
                {
                    "fingerprintVersion": 2,
                    "retrievalImplementationSha256": retrieval_implementation_fingerprint(),
                    "goldenSetSha256": hashlib.sha256(args.golden_set.read_bytes()).hexdigest(),
                }
                if golden_version == "2.0.0"
                else {}
            ),
        },
        "preflight": preflight,
        "unscoredCanaryPassed": canary_passed,
        "usage": usage,
        "metrics": metrics,
        "results": results,
    }
    safe_model = "".join(character if character.isalnum() else "-" for character in args.model)
    stem = (
        f"v{golden_version}_{report['metadata']['snapshotSha256'][:12]}_"
        f"{dialect}_hybrid_cloudflare_{safe_model}_top{args.top_k}"
    )
    args.output_dir.mkdir(parents=True, exist_ok=True)
    json_path = args.output_dir / f"{stem}.json"
    markdown_path = args.output_dir / f"{stem}.md"
    json_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    markdown_path.write_text(markdown_summary(report), encoding="utf-8", newline="\n")
    print(json.dumps({"json": str(json_path), "markdown": str(markdown_path)}))


if __name__ == "__main__":
    main()
