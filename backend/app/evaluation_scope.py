"""Read-only applicability checks for a published retrieval baseline; never runs retrieval."""

import hashlib
import json
from typing import Any

from .config import Settings
from .schemas import EvaluationApplicability, EvaluationQualityMetrics, KnowledgeSnapshot


def corpus_fingerprint(snapshot: KnowledgeSnapshot) -> str:
    # Request timestamps in meta change on every read. Compare the actual corpus instead.
    corpus = snapshot.model_dump(mode="json", by_alias=True, exclude={"meta"})

    def canonical(value: Any) -> Any:
        if isinstance(value, dict):
            return {key: canonical(item) for key, item in value.items()}
        if isinstance(value, list):
            items = [canonical(item) for item in value]
            return sorted(items, key=lambda item: json.dumps(item, sort_keys=True))
        return value

    data = json.dumps(canonical(corpus), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


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
    build_matches = evaluation.evaluation_commit == settings.build_commit
    corpus_matches = None
    missing_samples = None
    reasons = []
    if not config_matches:
        reasons.append("retrieval-config-changed")
    if not build_matches:
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
        ):
            corpus_matches = reference["corpusSha256"] == corpus_fingerprint(snapshot)
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
        missing_expected_claim_sample_count=missing_samples,
        configured_retrieval_mode=settings.retrieval_mode,
        reasons=reasons,
    )
