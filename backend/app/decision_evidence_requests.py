"""Owner-only gap receipts backed by the existing staff intake queue.

Only public entity names, public source URLs and dimension keys enter that queue.
No automatic fetching, paid extraction, publication or eligibility promotion.
"""

import json
import re
from datetime import UTC, datetime
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import HTTPException
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import DecisionEvidenceRequestRecord, EntryRequestRecord
from .decision_comparison import fields_for_claim
from .decision_constraints import current_claims
from .decision_validation import owned_research
from .engagement import EngagementService, revalidate_research
from .entry_requests import EntryRequestReceipt, receipt
from .schemas import CamelModel, DecisionContext, KnowledgeSnapshot


def public_source_reference(context: DecisionContext | None, dimensions: list[str]):
    """Route known public channels without forwarding private gateway names."""
    public_channels = {
        "google gemini developer api": (
            "Google Gemini Developer API",
            "https://ai.google.dev/gemini-api/terms",
            "https://ai.google.dev/gemini-api/docs/pricing",
        ),
        "ccsub": (
            "CCSub（公开参考站点；实际网关归属仍须核对）",
            "https://www.ccsub.net/zh/terms-of-service",
            "https://www.ccsub.net/docs/pricing",
        ),
    }
    channel = (
        context.service_access.channel
        if context and context.service_access and "commercial-use" in dimensions
        else context.budget.channel
        if context and "api-price" in dimensions
        else None
    )
    reference = public_channels.get((channel or "").strip().casefold())
    if reference is None:
        return None
    return reference[0], reference[1 if "commercial-use" in dimensions else 2]


class DecisionEvidenceRequestCreate(CamelModel):
    request_id: UUID
    candidate_id: str = Field(min_length=1, max_length=128)


class DecisionEvidenceRequestView(EntryRequestReceipt):
    candidate_id: str
    dimensions: list[str]
    source_url: str
    verification_state: Literal["awaiting-evidence", "evidence-ready", "candidate-unavailable"]
    remaining_dimensions: list[str]
    verified_dimensions: list[str]
    current_eligibility: Literal["eligible", "unknown", "excluded", "conflict"] | None = None
    checked_at: datetime


def evidence_progress(
    session: Session, link: DecisionEvidenceRequestRecord, snapshot: KnowledgeSnapshot
):
    """Check the saved requirements against current published facts, read-only.

    Queue disposition is intentionally not an input. A resolved/rejected request
    cannot prove coverage; retraction/expiry must make a prior result unknown.
    No task text, thresholds, notes or private measurements leave this function.
    """
    dimensions = json.loads(link.dimensions_json)
    research = EngagementService._research_view(
        owned_research(session, link.research_id, link.user_id)
    )
    context = research.decision_context
    if context is None or not any(entity.id == link.candidate_id for entity in snapshot.entities):
        return {
            "verification_state": "candidate-unavailable",
            "remaining_dimensions": dimensions,
            "verified_dimensions": [],
            "current_eligibility": None,
            "checked_at": datetime.now(UTC),
        }
    claims = current_claims(
        [claim for claim in snapshot.claims if claim.entity_id == link.candidate_id], snapshot
    )
    context = context.model_copy(update={"candidate_entity_ids": [link.candidate_id]})
    language = "zh" if re.search(r"[\u3400-\u9fff]", research.question) else "en"
    decision = EngagementService._build_decision(
        context, claims, [link.candidate_id], snapshot, language
    )
    candidate = (
        next((row for row in decision.candidates if row.entity_id == link.candidate_id), None)
        if decision
        else None
    )
    missing = (
        {
            gap.dimension
            for gap in candidate.gaps
            if gap.reason in {"not-recorded", "not-structured", "not-current", "conflicting"}
        }
        if candidate
        else set(dimensions)
    )
    if candidate and candidate.eligibility == "conflict":
        missing.update(dimensions)
    # Verified negative facts can settle a request by ruling a candidate out.
    # They do not make it eligible for a trial or an adoption recommendation.
    if candidate and candidate.eligibility == "excluded":
        covered = {
            field[0] for claim in claims for field in fields_for_claim(claim, official_specs=True)
        }
        missing -= covered
    remaining = [dimension for dimension in dimensions if dimension in missing]
    return {
        "verification_state": "awaiting-evidence" if remaining else "evidence-ready",
        "remaining_dimensions": remaining,
        "verified_dimensions": [
            dimension for dimension in dimensions if dimension not in remaining
        ],
        "current_eligibility": candidate.eligibility if candidate else None,
        "checked_at": datetime.now(UTC),
    }


def require_completed_evidence(
    session: Session, request_id: str, entity_id: str | None, snapshot: KnowledgeSnapshot
):
    link = session.get(DecisionEvidenceRequestRecord, request_id)
    if link is None:
        return  # Ordinary catalogue requests retain their existing workflow.
    if entity_id != link.candidate_id:
        raise HTTPException(422, "补证请求必须关联原具体候选，不能用其他型号或家族替代。")
    progress = evidence_progress(session, link, snapshot)
    if progress["verification_state"] != "evidence-ready":
        raise HTTPException(
            422,
            "尚有未补齐、已失效或冲突的公开证据，不能标记完成。请先审核并启用对应事实，再刷新核验。",
        )


def request_view(
    session: Session, link: DecisionEvidenceRequestRecord, snapshot: KnowledgeSnapshot
):
    row = session.get(EntryRequestRecord, link.id)
    return DecisionEvidenceRequestView(
        **receipt(row).model_dump(),
        candidate_id=link.candidate_id,
        dimensions=json.loads(link.dimensions_json),
        source_url=row.source_url,
        **evidence_progress(session, link, snapshot),
    )


def evidence_requests(
    session: Session, research_id: str, user_id: str, snapshot: KnowledgeSnapshot
):
    owned_research(session, research_id, user_id)
    return [
        request_view(session, row, snapshot)
        for row in session.scalars(
            select(DecisionEvidenceRequestRecord)
            .where(
                DecisionEvidenceRequestRecord.research_id == research_id,
                DecisionEvidenceRequestRecord.user_id == user_id,
            )
            .order_by(DecisionEvidenceRequestRecord.id)
        )
    ]


def create_evidence_request(
    session: Session,
    research_id: str,
    user_id: str,
    payload: DecisionEvidenceRequestCreate,
    snapshot: KnowledgeSnapshot,
):
    research = owned_research(session, research_id, user_id)
    query = select(DecisionEvidenceRequestRecord).where(
        DecisionEvidenceRequestRecord.research_id == research_id,
        DecisionEvidenceRequestRecord.candidate_id == payload.candidate_id,
    )
    previous = session.scalar(query)
    if previous:
        return request_view(session, previous, snapshot)
    current = revalidate_research(EngagementService._research_view(research), snapshot)
    candidate = (
        next(
            (row for row in current.decision.candidates if row.entity_id == payload.candidate_id),
            None,
        )
        if current.decision
        else None
    )
    if candidate is None or candidate.eligibility == "excluded":
        raise HTTPException(422, "该候选不在本次可核验范围内。")
    dimensions = sorted(
        {
            gap.dimension
            for gap in candidate.gaps
            if gap.reason in {"not-recorded", "not-structured", "not-current", "conflicting"}
        }
    )
    if not dimensions:
        raise HTTPException(422, "此候选没有待补充的公开资料项；业务效果需要实际试用。")
    entity = next((row for row in snapshot.entities if row.id == payload.candidate_id), None)
    urls = [
        evidence.url
        for citation in current.citations
        if citation.claim.entity_id == payload.candidate_id
        for evidence in citation.evidence
        if evidence.type == "official"
    ]
    if entity and entity.knowledge and entity.knowledge.official_url:
        urls.append(entity.knowledge.official_url)
    if entity and entity.release:
        urls.extend(channel.url for channel in entity.release.access_channels if channel.url)
    # Reference routing is not a licensing assertion. Only exact PUBLIC channel
    # names are forwarded; arbitrary gateways, URLs and private notes stay out.
    public_channel = public_source_reference(current.decision_context, dimensions)
    if public_channel:
        urls.insert(0, public_channel[1])
    source = next(
        (
            url
            for url in urls
            if urlsplit(url).scheme == "https"
            and urlsplit(url).hostname
            and not urlsplit(url).username
            and not urlsplit(url).password
        ),
        None,
    )
    if entity is None or source is None:
        raise HTTPException(
            422, "当前没有可定位的官方来源，请先查看其他候选；未创建虚构的补证请求。"
        )
    request_id = str(payload.request_id)
    if session.get(EntryRequestRecord, request_id):
        raise HTTPException(409, "请求编号已用于其他内容，请刷新后重试。")
    entry = EntryRequestRecord(
        id=request_id,
        name=entity.name.zh[:120],
        entity_type="model"
        if entity.type == "model"
        else "product"
        if entity.type == "application"
        else "tool",
        source_url=source,
        reason="决策资料补充请求，仅核验公开对象；待补维度："
        + "、".join(dimensions)
        + ("；公开服务参考：" + public_channel[0] if public_channel else "")
        + "。须核对具体版本、来源日期与适用边界，经既有事实审核流程后才能驱动选型。处理请求不等于资格通过。",
        status="pending",
        created_at=datetime.now(UTC),
        version=1,
    )
    link = DecisionEvidenceRequestRecord(
        id=request_id,
        research_id=research_id,
        user_id=user_id,
        candidate_id=payload.candidate_id,
        dimensions_json=json.dumps(dimensions),
    )
    try:
        session.add(entry)
        session.flush()
        session.add(link)
        session.commit()
    except IntegrityError:
        session.rollback()
        previous = session.scalar(query)
        if previous:
            return request_view(session, previous, snapshot)
        raise HTTPException(409, "请求编号已冲突，请刷新后重试。") from None
    return request_view(session, link, snapshot)
