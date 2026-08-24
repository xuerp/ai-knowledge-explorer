from __future__ import annotations

from datetime import UTC, datetime

from .schemas import (
    Claim,
    ClaimEntityAuditItem,
    ClaimEntityAuditReport,
    Entity,
    KnowledgeSnapshot,
)


def _key(value: str | None) -> str:
    return " ".join((value or "").casefold().replace("_", " ").split())


def _entity_references(entity: Entity) -> set[str]:
    return {
        reference
        for reference in (
            _key(entity.id),
            _key(entity.slug),
            _key(entity.name.zh),
            _key(entity.name.en),
            *(_key(alias) for alias in entity.aliases or []),
        )
        if reference
    }


def _exact_matches(claim: Claim, entities: list[Entity]) -> list[str]:
    subject = _key(claim.subject)
    if not subject:
        return []
    return sorted(entity.id for entity in entities if subject in _entity_references(entity))


def _text_matches(claim: Claim, entities: list[Entity]) -> list[str]:
    texts = (_key(claim.text.zh), _key(claim.text.en))
    matches: set[str] = set()
    for entity in entities:
        references = {reference for reference in _entity_references(entity) if len(reference) >= 3}
        if any(reference in text for reference in references for text in texts):
            matches.add(entity.id)
    return sorted(matches)


def classify_unlinked_claim(claim: Claim, entities: list[Entity]) -> ClaimEntityAuditItem:
    exact = _exact_matches(claim, entities)
    if len(exact) == 1:
        return ClaimEntityAuditItem(
            claim_id=claim.id,
            current_entity_id=claim.entity_id,
            subject=claim.subject,
            resolution="deterministic",
            proposed_entity_id=exact[0],
            candidate_entity_ids=exact,
            reason="主体精确命中唯一实体规范名称或别名，可以确定性回填。",
        )
    if len(exact) > 1:
        return ClaimEntityAuditItem(
            claim_id=claim.id,
            current_entity_id=claim.entity_id,
            subject=claim.subject,
            resolution="ambiguous",
            candidate_entity_ids=exact,
            reason="主体同时命中多个实体，需要人工消歧。",
        )

    text_matches = _text_matches(claim, entities)
    if len(text_matches) == 1:
        return ClaimEntityAuditItem(
            claim_id=claim.id,
            current_entity_id=claim.entity_id,
            subject=claim.subject,
            resolution="review-required",
            proposed_entity_id=text_matches[0],
            candidate_entity_ids=text_matches,
            reason="事实文本只命中一个实体，但不是主体精确匹配，需要人工确认。",
        )
    if len(text_matches) > 1:
        return ClaimEntityAuditItem(
            claim_id=claim.id,
            current_entity_id=claim.entity_id,
            subject=claim.subject,
            resolution="ambiguous",
            candidate_entity_ids=text_matches,
            reason="事实文本命中多个实体，需要人工消歧。",
        )
    return ClaimEntityAuditItem(
        claim_id=claim.id,
        current_entity_id=claim.entity_id,
        subject=claim.subject,
        resolution="unresolved",
        reason="主体与事实文本均无法解析到现有实体。",
    )


def audit_claim_entity_links(snapshot: KnowledgeSnapshot) -> ClaimEntityAuditReport:
    entity_ids = {entity.id for entity in snapshot.entities}
    items: list[ClaimEntityAuditItem] = []
    linked_claim_count = 0
    for claim in snapshot.claims:
        if claim.entity_id in entity_ids:
            linked_claim_count += 1
            continue
        item = classify_unlinked_claim(claim, snapshot.entities)
        if claim.entity_id:
            item = item.model_copy(
                update={
                    "resolution": "invalid",
                    "reason": "Claim 关联了不存在的实体，必须修正后才能发布。",
                }
            )
        items.append(item)

    deterministic_count = sum(item.resolution == "deterministic" for item in items)
    return ClaimEntityAuditReport(
        generated_at=datetime.now(UTC),
        public_claim_count=len(snapshot.claims),
        linked_claim_count=linked_claim_count,
        missing_or_invalid_count=len(items),
        deterministic_repair_count=deterministic_count,
        manual_review_count=len(items) - deterministic_count,
        items=items,
    )
