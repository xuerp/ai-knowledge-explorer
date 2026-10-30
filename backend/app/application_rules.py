from .schemas import (
    RELATION_KINDS,
    ReviewBatchDecision,
    ReviewDecision,
    ReviewQueueItem,
)

DATABASE_SCHEMA_REVISION = "20261023_0029"
SERVICE_RELEASE = "2026.09.01-review-observability-v68"

RELATION_CLAIM_PREDICATES = set(RELATION_KINDS)

RELATION_PREDICATE_ANCHORS = {
    "developed-by": ("developed-by", "developed by", "开发"),
    "based-on": ("based-on", "based on", "基于"),
    "competes-with": ("competes-with", "competes with", "竞争", "竞品"),
    "benchmarked-on": (
        "benchmarked-on",
        "benchmarked on",
        "evaluated on",
        "评测",
        "基准测试",
    ),
    "uses": ("uses", "using", "使用", "采用"),
    "cited-by": ("cited-by", "cited by", "被引用"),
    "part-of": ("part-of", "part of", "属于", "隶属于"),
    "successor-of": ("successor-of", "successor of", "继任", "后继"),
    "integrates-with": ("integrates-with", "integrates with", "集成", "兼容"),
}


def review_item_has_anchored_excerpt(item: ReviewQueueItem) -> bool:
    subject = " ".join((item.claim.subject or "").casefold().split())
    object_or_value = " ".join((item.claim.object_or_value or "").casefold().split())
    if not subject or not object_or_value:
        return False
    return any(
        subject in " ".join((evidence.source_excerpt or "").casefold().split())
        and object_or_value in " ".join((evidence.source_excerpt or "").casefold().split())
        for evidence in item.evidence_items
    )


def review_item_is_deterministically_invalid(item: ReviewQueueItem) -> bool:
    return (
        not item.entity_id or not item.evidence_items or not review_item_has_anchored_excerpt(item)
    )


def review_decision_note(decision: ReviewDecision | ReviewBatchDecision) -> str | None:
    """Prefer the Epic 4 field while accepting the pre-Epic 4 request contract."""
    return decision.reason_note or decision.reason
