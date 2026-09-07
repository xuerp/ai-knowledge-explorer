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

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from eval_retrieval import current_commit, evaluate, load_golden_set, read_bytes

from app.embeddings import CloudflareEmbeddingProvider
from app.entity_aliases import apply_entity_aliases, load_entity_alias_catalog
from app.rag import HybridRagRetriever, LexicalRagRetriever, SqlAlchemyVectorClaimIndex
from app.schemas import KnowledgeSnapshot


def build_document_texts(snapshot: KnowledgeSnapshot) -> list[str]:
    evidence_by_id = {item.id: item for item in snapshot.evidence}
    entity_by_id = {item.id: item for item in snapshot.entities}
    texts: list[str] = []
    for claim in snapshot.claims:
        evidence = [
            evidence_by_id[source_id]
            for source_id in claim.source_ids
            if source_id in evidence_by_id
        ]
        entity = entity_by_id.get(claim.entity_id or "")
        if (
            claim.confidence != "verified"
            or entity is None
            or not evidence
            or len(evidence) != len(claim.source_ids)
        ):
            continue
        texts.append(LexicalRagRetriever.document_text(claim, entity, evidence))
    return texts


def markdown_summary(report: dict[str, Any]) -> str:
    metadata = report["metadata"]
    metrics = report["metrics"]["overall"]
    usage = report["usage"]
    return "\n".join(
        [
            "# 生产 Hybrid 检索路径评估",
            "",
            f"- Provider：`{metadata['embeddingProvider']}`",
            f"- 模型：`{metadata['embeddingModel']}`",
            f"- 版本：`{metadata['embeddingVersion']}`；维度：{metadata['embeddingDimension']}",
            f"- Golden Set：v{metadata['goldenSetVersion']}（{metadata['sampleCount']} 条）",
            f"- 快照：`{metadata['snapshotSha256']}`",
            f"- 别名目录：v{metadata['aliasCatalogVersion']} (`{metadata['aliasCatalogSha256']}`)",
            f"- 评测提交：`{metadata['evaluationCommit']}`",
            "",
            "| Recall@8 | Precision@8 | Entity Recall@8 | 通过率 |",
            "| ---: | ---: | ---: | ---: |",
            (
                f"| {metrics['recallAtK']:.2%} | {metrics['precisionAtK']:.2%} | "
                f"{metrics['entityRecallAtK']:.2%} | {metrics['passRatio']:.2%} |"
            ),
            "",
            f"- API 调用：{usage['apiCalls']} / {usage['dailyApiCallBudget']}",
            (
                f"- 保守 token 上界：{usage['conservativeTokenUpperBound']}；"
                f"估算 Neurons：{usage['estimatedNeurons']} / {usage['dailyNeuronBudget']}"
            ),
            "",
            "本结果执行的是生产 Cloudflare provider、版本化持久索引与 RRF union 路径。",
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
    parser.add_argument("--max-batch-size", type=int, default=100)
    parser.add_argument("--daily-neuron-budget", type=float, default=0)
    parser.add_argument("--neurons-per-million-tokens", type=float, default=1075)
    parser.add_argument("--daily-api-call-budget", type=int, default=0)
    parser.add_argument("--account-id-env", default="CLOUDFLARE_ACCOUNT_ID")
    parser.add_argument("--api-token-env", default="CLOUDFLARE_API_TOKEN")
    parser.add_argument("--evaluation-commit")
    parser.add_argument("--allow-external-api", action="store_true")
    args = parser.parse_args()
    if not args.allow_external_api:
        raise ValueError("Hybrid evaluation requires --allow-external-api authorization.")
    if args.daily_neuron_budget <= 0 or args.daily_api_call_budget <= 0:
        raise ValueError("Hybrid evaluation requires positive daily hard budgets.")
    account_id = os.getenv(args.account_id_env)
    api_token = os.getenv(args.api_token_env)
    if not account_id or not api_token:
        raise ValueError("Cloudflare evaluation credentials are not configured.")

    snapshot_bytes = read_bytes(args.snapshot)
    snapshot = KnowledgeSnapshot.model_validate_json(snapshot_bytes)
    golden_version, samples = load_golden_set(args.golden_set)
    alias_version, alias_definitions, alias_hash = load_entity_alias_catalog(args.alias_catalog)
    apply_entity_aliases(snapshot.entities, alias_definitions)
    document_texts = build_document_texts(snapshot)
    all_inputs = document_texts + [str(item["query"]) for item in samples]
    conservative_tokens = sum(len(text) for text in all_inputs)
    estimated_neurons = conservative_tokens / 1_000_000 * args.neurons_per_million_tokens
    expected_calls = math.ceil(len(document_texts) / args.max_batch_size) + len(samples)
    if estimated_neurons > args.daily_neuron_budget:
        raise ValueError("Full evaluation would exceed the Neuron hard budget.")
    if expected_calls > args.daily_api_call_budget:
        raise ValueError("Full evaluation would exceed the API call hard budget.")

    provider = CloudflareEmbeddingProvider(
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
    try:
        metrics, results, dialect = evaluate(
            snapshot,
            samples,
            top_k=args.top_k,
            database_url="sqlite://",
            retriever=retriever,
        )
        usage = provider.usage()
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
            "topK": args.top_k,
            "rrfK": args.rrf_k,
            "evaluationCommit": args.evaluation_commit or current_commit(REPO_ROOT),
            "evaluatedAt": datetime.now(UTC).isoformat(),
        },
        "preflight": {
            "documentCount": len(document_texts),
            "expectedApiCalls": expected_calls,
            "conservativeTokenUpperBound": conservative_tokens,
            "estimatedNeurons": round(estimated_neurons, 4),
        },
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
