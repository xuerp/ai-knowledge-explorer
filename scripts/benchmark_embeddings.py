from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import statistics
import subprocess
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import Any, Protocol

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.database import Base
from app.entity_aliases import apply_entity_aliases, load_entity_alias_catalog
from app.rag import LexicalRagRetriever
from app.schemas import KnowledgeSnapshot

EXPECTED_CATEGORIES = {"entity", "relation", "timeline", "comparison"}


class EmbeddingBackend(Protocol):
    model_name: str
    model_version: str
    dimension: int
    provider: str

    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    def embed_queries(self, texts: list[str]) -> list[list[float]]: ...

    def usage(self) -> dict[str, Any]: ...


class FastEmbedBackend:
    provider = "fastembed"

    def __init__(self, model_name: str, cache_dir: Path, threads: int) -> None:
        from fastembed import TextEmbedding

        supported = next(
            item for item in TextEmbedding.list_supported_models() if item["model"] == model_name
        )
        source_id = supported["sources"].get("hf") or model_name
        source_dir = cache_dir / f"models--{source_id.replace('/', '--')}"
        self.cache_warm_before_run = source_dir.exists()
        started = perf_counter()
        self._model = TextEmbedding(
            model_name=model_name,
            cache_dir=str(cache_dir),
            threads=threads,
        )
        self.initialization_ms = round((perf_counter() - started) * 1000)
        self.model_name = model_name
        model_files = sorted(source_dir.rglob("*.onnx"))
        if not model_files:
            raise RuntimeError(f"FastEmbed model artifact was not found below {source_dir}.")
        artifact = model_files[0]
        self.model_artifact_sha256 = hashlib.sha256(artifact.read_bytes()).hexdigest()
        self.model_source = source_id
        self.cache_bytes = sum(
            item.stat().st_size for item in source_dir.rglob("*") if item.is_file()
        )
        self.model_version = f"fastembed-0.8.0+sha256:{self.model_artifact_sha256[:12]}"
        self.dimension = int(self._model.embedding_size)
        self._usage = {"apiCalls": 0, "inputTokens": 0, "estimatedCostUsd": 0.0}

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [item.tolist() for item in self._model.passage_embed(texts)]

    def embed_queries(self, texts: list[str]) -> list[list[float]]:
        return [item.tolist() for item in self._model.query_embed(texts)]

    def usage(self) -> dict[str, Any]:
        return self._usage


class OpenAIEmbeddingBackend:
    provider = "openai"

    def __init__(
        self,
        model_name: str,
        dimension: int,
        api_key_env: str,
        monthly_budget_usd: float,
        price_per_million_tokens: float,
        allow_paid_api: bool,
    ) -> None:
        import httpx

        if not allow_paid_api:
            raise ValueError("OpenAI benchmark requires --allow-paid-api explicit authorization.")
        if monthly_budget_usd <= 0:
            raise ValueError("OpenAI benchmark requires a positive --monthly-budget-usd cap.")
        api_key = os.getenv(api_key_env)
        if not api_key:
            raise ValueError(f"OpenAI benchmark requires the {api_key_env} environment variable.")
        self._client = httpx.Client(
            base_url="https://api.openai.com/v1",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=60,
        )
        self.model_name = model_name
        self.model_version = model_name
        self.model_source = "https://api.openai.com/v1/embeddings"
        self.model_artifact_sha256 = None
        self.cache_warm_before_run = False
        self.cache_bytes = 0
        self.dimension = dimension
        self.monthly_budget_usd = monthly_budget_usd
        self.price_per_million_tokens = price_per_million_tokens
        self.initialization_ms = 0
        self._api_calls = 0
        self._input_tokens = 0

    def _embed(self, texts: list[str]) -> list[list[float]]:
        conservative_tokens = sum(len(text) for text in texts)
        projected_cost = (
            (self._input_tokens + conservative_tokens) / 1_000_000 * self.price_per_million_tokens
        )
        if projected_cost > self.monthly_budget_usd:
            raise RuntimeError(
                "Embedding benchmark would exceed the configured monthly budget cap."
            )
        response = self._client.post(
            "/embeddings",
            json={
                "input": texts,
                "model": self.model_name,
                "dimensions": self.dimension,
            },
        )
        response.raise_for_status()
        payload = response.json()
        self._api_calls += 1
        self._input_tokens += int(payload.get("usage", {}).get("prompt_tokens", 0))
        return [item["embedding"] for item in sorted(payload["data"], key=lambda row: row["index"])]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._embed(texts)

    def embed_queries(self, texts: list[str]) -> list[list[float]]:
        return self._embed(texts)

    def usage(self) -> dict[str, Any]:
        return {
            "apiCalls": self._api_calls,
            "inputTokens": self._input_tokens,
            "estimatedCostUsd": round(
                self._input_tokens / 1_000_000 * self.price_per_million_tokens,
                8,
            ),
            "monthlyBudgetUsd": self.monthly_budget_usd,
        }


def read_bytes(path: Path) -> bytes:
    return path.read_bytes()


def current_commit() -> str:
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO_ROOT, text=True).strip()


def load_samples(path: Path) -> tuple[str, list[dict[str, Any]]]:
    samples = [
        json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()
    ]
    versions = {str(item["version"]) for item in samples}
    categories = {str(item["category"]) for item in samples}
    if len(versions) != 1 or categories != EXPECTED_CATEGORIES:
        raise ValueError("Golden Set version or categories are invalid.")
    return versions.pop(), samples


def build_documents(
    snapshot: KnowledgeSnapshot,
) -> tuple[list[str], list[str], dict[str, str]]:
    evidence_by_id = {item.id: item for item in snapshot.evidence}
    entity_by_id = {item.id: item for item in snapshot.entities}
    claim_ids: list[str] = []
    texts: list[str] = []
    claim_entity_ids: dict[str, str] = {}
    for claim in snapshot.claims:
        evidence = [evidence_by_id[item] for item in claim.source_ids if item in evidence_by_id]
        entity = entity_by_id.get(claim.entity_id)
        if (
            claim.confidence != "verified"
            or entity is None
            or len(evidence) != len(claim.source_ids)
        ):
            continue
        claim_ids.append(claim.id)
        texts.append(LexicalRagRetriever.document_text(claim, entity, evidence))
        claim_entity_ids[claim.id] = claim.entity_id
    return claim_ids, texts, claim_entity_ids


def normalize_matrix(vectors: list[list[float]]) -> Any:
    import numpy as np

    matrix = np.asarray(vectors, dtype=np.float32)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    return matrix / np.maximum(norms, 1e-12)


def ranked_vector_ids(document_matrix: Any, query_vector: Any, claim_ids: list[str]) -> list[str]:
    scores = document_matrix @ query_vector
    return [
        claim_ids[index]
        for index in sorted(range(len(claim_ids)), key=lambda i: (-scores[i], claim_ids[i]))
    ]


def rrf_fuse(lexical_ids: list[str], vector_ids: list[str], rrf_k: int) -> list[str]:
    scores: dict[str, float] = defaultdict(float)
    for ranking in (lexical_ids, vector_ids):
        for rank, claim_id in enumerate(ranking, start=1):
            scores[claim_id] += 1 / (rrf_k + rank)
    return sorted(scores, key=lambda claim_id: (-scores[claim_id], claim_id))


def evaluate_ranking(
    samples: list[dict[str, Any]],
    rankings: dict[str, list[str]],
    claim_entity_ids: dict[str, str],
    top_k: int,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    for sample in samples:
        retrieved = rankings[sample["id"]][:top_k]
        expected_claims = set(sample["expected_claim_ids"])
        expected_entities = set(sample["expected_entity_ids"])
        relevant = expected_claims & set(retrieved)
        retrieved_entities = {claim_entity_ids[item] for item in retrieved}
        rows.append(
            {
                "id": sample["id"],
                "category": sample["category"],
                "retrievedClaimIds": retrieved,
                "claimRecallAtK": len(relevant) / len(expected_claims),
                "precisionAtK": len(relevant) / top_k,
                "entityRecallAtK": len(expected_entities & retrieved_entities)
                / len(expected_entities),
                "passed": expected_claims <= set(retrieved),
            }
        )

    def summarize(items: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "samples": len(items),
            "recallAtK": round(statistics.fmean(item["claimRecallAtK"] for item in items), 4),
            "precisionAtK": round(statistics.fmean(item["precisionAtK"] for item in items), 4),
            "entityRecallAtK": round(
                statistics.fmean(item["entityRecallAtK"] for item in items), 4
            ),
            "passRatio": round(statistics.fmean(float(item["passed"]) for item in items), 4),
        }

    return {
        "overall": summarize(rows),
        "categories": {
            category: summarize([item for item in rows if item["category"] == category])
            for category in sorted(EXPECTED_CATEGORIES)
        },
    }, rows


def percentile(values: list[float], quantile: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * quantile)))
    return round(ordered[index], 3)


def markdown_summary(report: dict[str, Any]) -> str:
    metadata = report["metadata"]
    resources = report["resources"]
    lines = [
        f"# Embedding benchmark：{metadata['modelName']}",
        "",
        f"- Provider：`{metadata['provider']}`",
        f"- 模型版本：`{metadata['modelVersion']}`；维度：{metadata['dimension']}",
        f"- 模型来源：`{metadata['modelSource']}`",
        f"- 模型文件 SHA-256：`{metadata['modelArtifactSha256'] or 'API 托管，不适用'}`",
        f"- Golden Set：v{metadata['goldenSetVersion']}；TopK={metadata['topK']}",
        f"- 固定快照：`{metadata['snapshotSha256']}`",
        f"- 别名目录：v{metadata['aliasCatalogVersion']} (`{metadata['aliasCatalogSha256']}`)",
        f"- 评测提交：`{metadata['evaluationCommit']}`",
        "",
        "| 模式 | Recall@8 | Precision@8 | Entity Recall@8 | 通过率 |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for mode in ("vector", "hybrid"):
        metrics = report["metrics"][mode]["overall"]
        lines.append(
            f"| {mode} | {metrics['recallAtK']:.2%} | {metrics['precisionAtK']:.2%} | "
            f"{metrics['entityRecallAtK']:.2%} | {metrics['passRatio']:.2%} |"
        )
    lines.extend(
        [
            "",
            f"- 初始化：{resources['initializationMs']} ms",
            f"- 文档向量化：{resources['documentEmbeddingMs']} ms（{metadata['documentCount']} 条）",
            f"- 查询向量化：p50 {resources['queryLatencyP50Ms']} ms；p95 {resources['queryLatencyP95Ms']} ms",
            f"- RSS 增量：{resources['rssDeltaMb']} MB；峰值 RSS：{resources['peakRssMb']} MB",
            f"- 模型缓存：{resources['cacheMb']} MB；运行前已缓存：{resources['cacheWarmBeforeRun']}",
            f"- API 调用：{report['usage']['apiCalls']}；估算费用：${report['usage']['estimatedCostUsd']:.8f}",
            "",
            "本结果只代表固定快照和当前执行环境，不等同于生产选型结论。",
            "",
        ]
    )
    return "\n".join(lines)


def create_backend(args: argparse.Namespace) -> EmbeddingBackend:
    if args.provider == "fastembed":
        return FastEmbedBackend(args.model, args.cache_dir, args.threads)
    return OpenAIEmbeddingBackend(
        args.model,
        args.dimension,
        args.api_key_env,
        args.monthly_budget_usd,
        args.price_per_million_tokens,
        args.allow_paid_api,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="运行可复现的 Embedding 与 hybrid 检索 benchmark。"
    )
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--golden-set", type=Path, required=True)
    parser.add_argument("--alias-catalog", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--provider", choices=("fastembed", "openai"), required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--dimension", type=int, default=512)
    parser.add_argument("--cache-dir", type=Path, default=Path(".cache/fastembed"))
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--top-k", type=int, default=8)
    parser.add_argument("--rrf-k", type=int, default=60)
    parser.add_argument("--evaluation-commit")
    parser.add_argument("--api-key-env", default="OPENAI_API_KEY")
    parser.add_argument("--monthly-budget-usd", type=float, default=0)
    parser.add_argument("--price-per-million-tokens", type=float, default=0.02)
    parser.add_argument("--allow-paid-api", action="store_true")
    args = parser.parse_args()
    if args.top_k <= 0 or args.rrf_k <= 0 or args.dimension <= 0 or args.threads <= 0:
        raise ValueError("top-k、rrf-k、dimension 和 threads 必须为正整数。")

    import psutil

    snapshot_bytes = read_bytes(args.snapshot)
    snapshot = KnowledgeSnapshot.model_validate_json(snapshot_bytes)
    golden_version, samples = load_samples(args.golden_set)
    alias_version, alias_definitions, alias_hash = load_entity_alias_catalog(args.alias_catalog)
    apply_entity_aliases(snapshot.entities, alias_definitions)
    claim_ids, document_texts, claim_entity_ids = build_documents(snapshot)
    process = psutil.Process()
    initial_rss = process.memory_info().rss
    backend = create_backend(args)
    after_init_rss = process.memory_info().rss

    started = perf_counter()
    document_vectors = backend.embed_documents(document_texts)
    document_embedding_ms = round((perf_counter() - started) * 1000)
    document_matrix = normalize_matrix(document_vectors)
    after_documents_rss = process.memory_info().rss

    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    lexical = LexicalRagRetriever()
    vector_rankings: dict[str, list[str]] = {}
    hybrid_rankings: dict[str, list[str]] = {}
    query_latencies: list[float] = []
    with Session(engine) as session:
        lexical.prepare(session, snapshot)
        for sample in samples:
            started = perf_counter()
            query_vector = normalize_matrix(backend.embed_queries([sample["query"]]))[0]
            query_latencies.append((perf_counter() - started) * 1000)
            vector_ids = ranked_vector_ids(document_matrix, query_vector, claim_ids)
            lexical_ids = [
                item.claim.id
                for item in lexical.search(
                    session,
                    snapshot,
                    sample["query"],
                    limit=max(32, args.top_k * 4),
                    prepared=True,
                ).citations
            ]
            vector_rankings[sample["id"]] = vector_ids
            hybrid_rankings[sample["id"]] = rrf_fuse(
                lexical_ids,
                vector_ids[: max(32, args.top_k * 4)],
                args.rrf_k,
            )

    vector_metrics, vector_results = evaluate_ranking(
        samples, vector_rankings, claim_entity_ids, args.top_k
    )
    hybrid_metrics, hybrid_results = evaluate_ranking(
        samples, hybrid_rankings, claim_entity_ids, args.top_k
    )
    peak_rss = max(after_init_rss, after_documents_rss, process.memory_info().rss)
    report = {
        "metadata": {
            "provider": backend.provider,
            "modelName": backend.model_name,
            "modelVersion": backend.model_version,
            "dimension": backend.dimension,
            "modelSource": backend.model_source,
            "modelArtifactSha256": backend.model_artifact_sha256,
            "goldenSetVersion": golden_version,
            "sampleCount": len(samples),
            "snapshotSha256": hashlib.sha256(snapshot_bytes).hexdigest(),
            "aliasCatalogVersion": alias_version,
            "aliasCatalogSha256": alias_hash,
            "documentCount": len(claim_ids),
            "topK": args.top_k,
            "rrfK": args.rrf_k,
            "evaluationCommit": args.evaluation_commit or current_commit(),
            "evaluatedAt": datetime.now(UTC).isoformat(),
        },
        "environment": {
            "platform": platform.platform(),
            "python": platform.python_version(),
            "logicalCpuCount": os.cpu_count(),
            "threads": args.threads,
        },
        "resources": {
            "initializationMs": backend.initialization_ms,
            "documentEmbeddingMs": document_embedding_ms,
            "queryLatencyP50Ms": percentile(query_latencies, 0.5),
            "queryLatencyP95Ms": percentile(query_latencies, 0.95),
            "initialRssMb": round(initial_rss / 1024 / 1024, 2),
            "peakRssMb": round(peak_rss / 1024 / 1024, 2),
            "rssDeltaMb": round((peak_rss - initial_rss) / 1024 / 1024, 2),
            "cacheWarmBeforeRun": backend.cache_warm_before_run,
            "cacheMb": round(backend.cache_bytes / 1024 / 1024, 2),
        },
        "usage": backend.usage(),
        "metrics": {"vector": vector_metrics, "hybrid": hybrid_metrics},
        "results": {"vector": vector_results, "hybrid": hybrid_results},
    }
    safe_model = "".join(character if character.isalnum() else "-" for character in args.model)
    stem = f"embedding_{backend.provider}_{safe_model}_{hashlib.sha256(snapshot_bytes).hexdigest()[:12]}"
    args.output_dir.mkdir(parents=True, exist_ok=True)
    json_path = args.output_dir / f"{stem}.json"
    markdown_path = args.output_dir / f"{stem}.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    markdown_path.write_text(markdown_summary(report), encoding="utf-8")
    print(json.dumps({"json": str(json_path), "markdown": str(markdown_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
