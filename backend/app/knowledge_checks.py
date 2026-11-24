"""Owner requests to verify one "model knowledge, unverified" line.

The line is read from the saved, validated analysis by position, never from the
client, so the staff queue only ever receives text the system itself displayed.
No fetching, paid extraction or publication happens here; staff review decides.
"""

from datetime import UTC, datetime
from typing import Literal
from urllib.parse import urlsplit
from uuid import NAMESPACE_URL, uuid5

from fastapi import HTTPException
from pydantic import Field
from sqlalchemy.orm import Session

from .database import EntryRequestRecord
from .decision_validation import owned_research
from .engagement import EngagementService
from .entry_requests import EntryRequestReceipt, receipt
from .schemas import CamelModel, KnowledgeSnapshot

Section = Literal["summary", "candidate", "tradeoffs", "gaps", "first_steps"]


class KnowledgeCheckCreate(CamelModel):
    section: Section
    index: int = Field(ge=0, le=20)
    candidate_index: int | None = Field(default=None, ge=0, le=10)


def _line(analysis, payload: KnowledgeCheckCreate):
    if payload.section == "summary":
        return analysis.summary, None
    if payload.section == "candidate":
        if payload.candidate_index is None or payload.candidate_index >= len(analysis.candidates):
            raise HTTPException(422, "找不到这条内容，请刷新后重试。")
        candidate = analysis.candidates[payload.candidate_index]
        points = candidate.points
        entity_id = candidate.entity_id
    else:
        points = getattr(analysis, payload.section)
        entity_id = None
    if payload.index >= len(points):
        raise HTTPException(422, "找不到这条内容，请刷新后重试。")
    return points[payload.index], entity_id


def _official_url(entity) -> str | None:
    urls = []
    if entity.knowledge and entity.knowledge.official_url:
        urls.append(entity.knowledge.official_url)
    if entity.release:
        urls.extend(channel.url for channel in entity.release.access_channels if channel.url)
    for url in urls:
        parts = urlsplit(url)
        if parts.scheme == "https" and parts.hostname and not parts.username and not parts.password:
            return url
    return None


class KnowledgeCheckView(EntryRequestReceipt):
    section: Section
    index: int
    candidate_index: int | None = None


def _key(research_id: str, payload: KnowledgeCheckCreate) -> str:
    position = f"{payload.section}:{payload.candidate_index}:{payload.index}"
    return str(uuid5(NAMESPACE_URL, f"ai-radar:knowledge-check:{research_id}:{position}"))


def create_knowledge_check(
    session: Session,
    research_id: str,
    user_id: str,
    payload: KnowledgeCheckCreate,
    snapshot: KnowledgeSnapshot,
) -> KnowledgeCheckView:
    research = EngagementService._research_view(owned_research(session, research_id, user_id))
    analysis = research.decision.model_led if research.decision else None
    if analysis is None:
        raise HTTPException(422, "这条结果没有模型分析，无需核验。")
    line, entity_id = _line(analysis, payload)
    if line.basis != "model-knowledge":
        raise HTTPException(422, "这条内容已有引用来源，不需要再请求核验。")
    request_id = _key(research_id, payload)
    existing = session.get(EntryRequestRecord, request_id)
    if existing:
        return KnowledgeCheckView(**receipt(existing).model_dump(), **payload.model_dump())
    entity = next((row for row in snapshot.entities if row.id == entity_id), None)
    source = _official_url(entity) if entity else None
    task = research.decision_context.task if research.decision_context else research.question
    name = entity.name.zh if entity else task
    entry = EntryRequestRecord(
        id=request_id,
        name=("核验：" + name)[:120],
        entity_type=(
            "model"
            if entity and entity.type == "model"
            else "product"
            if entity and entity.type == "application"
            else "tool"
            if entity
            else "other"
        ),
        # The queue requires an HTTPS reference. Without an official page for
        # the product, staff start from the private research record instead.
        source_url=source or "https://airadar.rainza.cn/admin/review",
        reason=(
            "用户请求核验一条“模型常识，未核验”的内容："
            + line.text[:600]
            + "。请找到官方来源；能证实时按既有事实审核流程发布为已核验事实，"
            "不能证实时驳回并说明原因。处理请求本身不会改变任何已发布内容。"
        )[:2000],
        status="pending",
        created_at=datetime.now(UTC),
        version=1,
    )
    session.add(entry)
    session.commit()
    return KnowledgeCheckView(**receipt(entry).model_dump(), **payload.model_dump())


def _positions(analysis) -> list[KnowledgeCheckCreate]:
    positions = [KnowledgeCheckCreate(section="summary", index=0)]
    for candidate_index, candidate in enumerate(analysis.candidates):
        positions += [
            KnowledgeCheckCreate(section="candidate", index=i, candidate_index=candidate_index)
            for i in range(len(candidate.points))
        ]
    for section in ("tradeoffs", "gaps", "first_steps"):
        positions += [
            KnowledgeCheckCreate(section=section, index=i)
            for i in range(len(getattr(analysis, section)))
        ]
    return positions


def knowledge_checks(session: Session, research_id: str, user_id: str) -> list[KnowledgeCheckView]:
    """Requests already sent for this record, so the page can show their state."""
    research = EngagementService._research_view(owned_research(session, research_id, user_id))
    analysis = research.decision.model_led if research.decision else None
    if analysis is None:
        return []
    views = []
    for position in _positions(analysis):
        row = session.get(EntryRequestRecord, _key(research_id, position))
        if row:
            views.append(KnowledgeCheckView(**receipt(row).model_dump(), **position.model_dump()))
    return views


def delete_pending_checks(session: Session, research_id: str, analysis) -> None:
    """On record deletion, drop untouched requests; reviewed ones stay for audit."""
    if analysis is None:
        return
    for position in _positions(analysis):
        row = session.get(EntryRequestRecord, _key(research_id, position))
        if row and row.status == "pending":
            session.delete(row)
