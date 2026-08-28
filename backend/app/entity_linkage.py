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


def _curated_recommendation(
    claim: Claim,
    snapshot: KnowledgeSnapshot,
) -> tuple[str, str | None, str] | None:
    """仅在主体、官方发布者和规范 URL 同时满足白名单规则时给出建议。"""
    evidence_by_id = {item.id: item for item in snapshot.evidence}
    evidence = [evidence_by_id[item] for item in claim.source_ids if item in evidence_by_id]
    if not evidence:
        return None
    subject = _key(claim.subject)
    entity_ids = {entity.id for entity in snapshot.entities}

    def from_source(publisher: str, url_prefix: str) -> bool:
        return any(
            _key(item.publisher) == _key(publisher) and item.url.casefold().startswith(url_prefix)
            for item in evidence
        )

    claim_evidence_urls = {item.url.casefold() for item in evidence}
    peer_claims = [item for item in snapshot.claims if item.id != claim.id]
    if (
        subject == "claude 3.7 sonnet"
        and _key(claim.predicate) == "limit"
        and any(
            _key(item.subject) == subject
            and _key(item.predicate) == "thinking-token-limit"
            and bool(
                claim_evidence_urls
                & {
                    evidence_by_id[source_id].url.casefold()
                    for source_id in item.source_ids
                    if source_id in evidence_by_id
                }
            )
            for item in peer_claims
        )
    ):
        return (
            "retract",
            None,
            "同一官方证据已有更具体的 thinking-token-limit 事实，建议撤回泛化重复项。",
        )
    if (
        subject == "sampling"
        and _key(claim.predicate) == "deprecated-as-of"
        and _key(claim.object_or_value) == "2026-07-28"
        and any(
            _key(item.subject) == subject
            and _key(item.predicate) == "deprecated-as-of"
            and "protocol version 2026-07-28" in _key(item.object_or_value)
            and bool(
                claim_evidence_urls
                & {
                    evidence_by_id[source_id].url.casefold()
                    for source_id in item.source_ids
                    if source_id in evidence_by_id
                }
            )
            for item in peer_claims
        )
    ):
        return (
            "retract",
            None,
            "同一官方证据已有包含协议版本语义的等价事实，建议撤回低信息重复项。",
        )

    target: str | None = None
    basis: str | None = None
    if subject in {"data layer", "sampling", "mcp tools"} and from_source(
        "Model Context Protocol",
        "https://modelcontextprotocol.io/docs/",
    ):
        target = "e-mcp"
        basis = "主体属于 MCP 协议概念，且证据来自版本化 MCP 官方文档。"
    elif subject == "claude 3.7 sonnet" and from_source(
        "Anthropic", "https://www.anthropic.com/news/claude-3-7-sonnet"
    ):
        target = "e-claude"
        basis = "主体为 Claude 3.7 Sonnet，当前目录无该版本实体，建议归入 Claude 系列。"
    elif subject == "file search api" and from_source(
        "Google", "https://ai.google.dev/gemini-api/"
    ):
        target = "e-gemini"
        basis = "证据来自 Gemini API 官方更新日志，建议归入 Gemini 系列。"
    elif subject == "all our open-weight models" and from_source(
        "Alibaba Qwen", "https://raw.githubusercontent.com/qwenlm/qwen3/"
    ):
        target = "e-qwen"
        basis = "证据来自 Qwen3 官方仓库，建议归入 Qwen 系列。"
    elif subject in {
        "deprecated models and endpoints",
        "videos api",
        "preview models",
        "specialized variants of generally available models",
        "generally available models",
    } and from_source("OpenAI", "https://developers.openai.com/api/docs/deprecations"):
        target = "e-openai"
        basis = "证据来自 OpenAI API 弃用政策，建议归入 OpenAI 机构实体。"
    elif subject in {"model api for the seed2.0 full series", "seed2.0"} and from_source(
        "ByteDance Seed", "https://seed.bytedance.com/en/blog/seed-2-0-official-launch"
    ):
        target = "e-doubao"
        basis = "事实覆盖 Seed2.0 全系列，建议归入豆包系列而非单一 Pro 版本。"
    elif subject == "transformer" and from_source("arXiv", "https://arxiv.org/abs/1706.03762"):
        target = "e-transformer-paper"
        basis = "证据是 Attention Is All You Need 论文页面，建议归入 Transformer 论文实体。"

    if target in entity_ids:
        return "assign", target, basis or "官方来源与主体共同唯一指向现有实体。"

    root_arxiv = any(
        _key(item.publisher) == "arxiv" and item.url.casefold().rstrip("/") == "https://arxiv.org"
        for item in evidence
    )
    if root_arxiv and subject in {"arxiv", "materials on this site"}:
        return (
            "retract",
            None,
            "内容来自 arXiv 首页通用模板，不是具体论文事实，建议从公开知识库撤回。",
        )
    return None


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
        elif recommendation := _curated_recommendation(claim, snapshot):
            action, target, basis = recommendation
            item = item.model_copy(
                update={
                    "recommended_action": action,
                    "recommended_entity_id": target,
                    "recommendation_reason": basis,
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
