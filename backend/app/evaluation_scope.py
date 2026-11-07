"""Read-only applicability checks for a published retrieval baseline; never runs retrieval."""

import hashlib
import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy.engine import make_url

from .config import Settings
from .schemas import EvaluationApplicability, EvaluationQualityMetrics, KnowledgeSnapshot


def corpus_fingerprint(snapshot: KnowledgeSnapshot, *, version: int = 1) -> str:
    if type(version) is not int or version not in {1, 2}:
        raise ValueError("Unsupported corpus fingerprint version.")
    # Request timestamps in meta change on every read. Compare the actual corpus instead.
    corpus = snapshot.model_dump(mode="json", by_alias=True, exclude={"meta"})
    if version == 2:
        # Generated on every public read; it is not a factual graph revision.
        corpus.get("graph", {}).pop("capturedAt", None)
    # Legacy snapshots predate excerpt classification. Its unknown default adds
    # no evidence; preserve their fingerprint, but hash every actual classification.
    for source in corpus["evidence"]:
        if source.get("sourceExcerptKind") == "unclassified":
            source.pop("sourceExcerptKind")

    def canonical(value: Any) -> Any:
        if isinstance(value, dict):
            return {key: canonical(item) for key, item in value.items()}
        if isinstance(value, list):
            items = [canonical(item) for item in value]
            return sorted(items, key=lambda item: json.dumps(item, sort_keys=True))
        return value

    data = json.dumps(canonical(corpus), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


@lru_cache(maxsize=1)
def retrieval_implementation_fingerprint() -> str:
    root = Path(__file__).resolve().parent
    digest = hashlib.sha256()
    for name in (
        "rag.py",
        "embeddings.py",
        "entity_aliases.py",
        "query_intent.py",
        "schemas.py",
        "database.py",
    ):
        digest.update(name.encode("utf-8"))
        digest.update((root / name).read_bytes().replace(b"\r\n", b"\n"))
    return digest.hexdigest()


def retrieval_configuration(settings: Settings) -> dict[str, Any]:
    hybrid = settings.retrieval_mode == "hybrid"
    return {
        "retrievalMode": settings.retrieval_mode,
        "databaseDialect": make_url(settings.database_url).get_backend_name(),
        "embeddingProvider": settings.embedding_provider if hybrid else "none",
        "embeddingModel": settings.embedding_model if hybrid else None,
        "embeddingVersion": settings.embedding_version if hybrid else None,
        "embeddingDimension": settings.embedding_dimension if hybrid else None,
    }


def assess_evaluation(
    evaluation: EvaluationQualityMetrics,
    reference: dict[str, Any] | None,
    snapshot: KnowledgeSnapshot,
    settings: Settings,
) -> EvaluationApplicability:
    current_embedding = settings.embedding_model if settings.embedding_provider != "none" else None
    config_matches = (
        evaluation.retrieval_mode == settings.retrieval_mode
        and evaluation.embedding_model == current_embedding
    )
    configuration = retrieval_configuration(settings)
    if isinstance(reference, dict) and isinstance(reference.get("retrievalConfiguration"), dict):
        config_matches = reference["retrievalConfiguration"] == configuration
    build_matches = evaluation.evaluation_commit == settings.build_commit
    implementation_matches = None
    corpus_matches = None
    missing_samples = None
    reasons = []
    if not config_matches:
        reasons.append("retrieval-config-changed")
    if isinstance(reference, dict) and "retrievalImplementationSha256" in reference:
        implementation_matches = (
            reference["retrievalImplementationSha256"] == retrieval_implementation_fingerprint()
        )
        if not implementation_matches:
            reasons.append("retrieval-implementation-changed")
    elif not build_matches:
        reasons.append("build-not-matched")
    if isinstance(reference, dict) and isinstance(reference.get("expectedClaimIdsBySample"), list):
        annotations = reference["expectedClaimIdsBySample"]
        if (
            len(annotations) == evaluation.sample_count
            and all(
                isinstance(ids, list) and ids and all(isinstance(id, str) for id in ids)
                for ids in annotations
            )
            and isinstance(reference.get("corpusSha256"), str)
            and re.fullmatch(r"[a-f0-9]{64}", reference["corpusSha256"])
            and type(reference.get("fingerprintVersion", 1)) is int
            and reference.get("fingerprintVersion", 1) in {1, 2}
        ):
            corpus_matches = reference["corpusSha256"] == corpus_fingerprint(
                snapshot, version=reference.get("fingerprintVersion", 1)
            )
            claim_ids = {claim.id for claim in snapshot.claims}
            missing_samples = sum(not set(ids).issubset(claim_ids) for ids in annotations)
    if corpus_matches is None:
        reasons.append("reference-unavailable")
    elif not corpus_matches:
        reasons.append("corpus-changed")
    if missing_samples:
        reasons.append("annotations-missing")
    return EvaluationApplicability(
        status="historical" if reasons else "scope-matched",
        corpus_matches=corpus_matches,
        retrieval_config_matches=config_matches,
        build_matches=build_matches,
        implementation_matches=implementation_matches,
        missing_expected_claim_sample_count=missing_samples,
        configured_retrieval_mode=settings.retrieval_mode,
        configured_configuration=configuration,
        reasons=reasons,
    )
