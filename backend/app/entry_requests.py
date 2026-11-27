"""Visitor suggestions remain outside published knowledge until staff review."""

import json
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import Field, HttpUrl, field_validator, model_validator
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import EntryRequestRecord, KnowledgeEntityRecord, ReviewJobRecord
from .schemas import CamelModel

EntryRequestStatus = Literal["pending", "in-review", "resolved", "rejected"]


class EntryRequestCreate(CamelModel):
    request_id: UUID
    name: str = Field(min_length=2, max_length=120)
    entity_type: Literal["model", "product", "organization", "tool", "paper", "benchmark", "other"]
    source_url: HttpUrl = Field(max_length=2048)
    reason: str = Field(min_length=10, max_length=2000)

    @field_validator("name", "reason", mode="before")
    @classmethod
    def trim_text(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("source_url")
    @classmethod
    def require_https(cls, value):
        if value.scheme != "https" or value.username or value.password:
            raise ValueError("请填写不含登录凭据的 HTTPS 官方来源。")
        return value


class EntryRequestReceipt(CamelModel):
    id: str
    status: EntryRequestStatus
    created_at: datetime


class EntryRequestView(EntryRequestReceipt):
    name: str
    entity_type: str
    source_url: str
    reason: str
    reviewed_at: datetime | None
    reviewed_by: str | None
    reviewer_note: str | None
    entity_id: str | None
    version: int
    kind: Literal["release", "verification", "evidence", "visitor"] = "visitor"
    auto_state: Literal["candidates", "no-evidence", "failed", "skipped"] | None = None
    auto_detail: str | None = None
    auto_attempted_at: datetime | None = None
    candidate_ids: list[str] = Field(default_factory=list)
    # Of candidate_ids: still open, approved, rejected. Lets staff see progress.
    candidates_open: int = 0
    candidates_approved: int = 0
    candidates_rejected: int = 0


class EntryRequestDecision(CamelModel):
    status: Literal["in-review", "resolved", "rejected"]
    version: int = Field(ge=1)
    reviewer_note: str = Field(min_length=2, max_length=2000)
    entity_id: str | None = Field(default=None, max_length=128)

    @field_validator("reviewer_note", mode="before")
    @classmethod
    def trim_note(cls, value):
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def require_resolved_entity(self):
        if self.status == "resolved" and not self.entity_id:
            raise ValueError("标记已收录时必须关联已存在的知识对象。")
        return self


def receipt(row: EntryRequestRecord) -> EntryRequestReceipt:
    return EntryRequestReceipt(
        id=row.id,
        status=row.status,
        created_at=row.created_at.replace(tzinfo=UTC)
        if row.created_at.tzinfo is None
        else row.created_at,
    )


STORED_VIEW_FIELDS = (
    "id",
    "status",
    "created_at",
    "name",
    "entity_type",
    "source_url",
    "reason",
    "reviewed_at",
    "reviewed_by",
    "reviewer_note",
    "entity_id",
    "version",
    "auto_state",
    "auto_detail",
    "auto_attempted_at",
)


def view(row: EntryRequestRecord, session: Session | None = None) -> EntryRequestView:
    from .entry_request_automation import request_kind

    values = {key: getattr(row, key) for key in STORED_VIEW_FIELDS}
    for key in ("created_at", "reviewed_at", "auto_attempted_at"):
        if values[key] is not None and values[key].tzinfo is None:
            values[key] = values[key].replace(tzinfo=UTC)
    candidate_ids = json.loads(row.candidate_ids_json or "[]")
    counts = {"open": 0, "approved": 0, "rejected": 0}
    if session is not None and candidate_ids:
        for status in session.scalars(
            select(ReviewJobRecord.status).where(ReviewJobRecord.id.in_(candidate_ids))
        ):
            bucket = status if status in {"approved", "rejected"} else "open"
            counts[bucket] += 1
    return EntryRequestView(
        **values,
        kind=request_kind(row),
        candidate_ids=candidate_ids,
        candidates_open=counts["open"],
        candidates_approved=counts["approved"],
        candidates_rejected=counts["rejected"],
    )


def create_entry_request(session: Session, payload: EntryRequestCreate) -> EntryRequestReceipt:
    request_id = str(payload.request_id)
    values = {
        "name": payload.name,
        "entity_type": payload.entity_type,
        "source_url": str(payload.source_url),
        "reason": payload.reason,
    }
    existing = session.get(EntryRequestRecord, request_id)
    if not existing:
        row = EntryRequestRecord(
            id=request_id, **values, status="pending", created_at=datetime.now(UTC), version=1
        )
        session.add(row)
        try:
            session.commit()
            return receipt(row)
        except IntegrityError:
            session.rollback()
            existing = session.get(EntryRequestRecord, request_id)
            if not existing:
                raise
    if any(getattr(existing, key) != value for key, value in values.items()):
        raise HTTPException(409, "该请求编号已用于其他内容，请重新提交。")
    return receipt(existing)


def list_entry_requests(
    session: Session,
    status: EntryRequestStatus | None,
    offset: int,
    limit: int,
    search: str | None = None,
):
    query = select(EntryRequestRecord)
    if status:
        query = query.where(EntryRequestRecord.status == status)
    if search and search.strip():
        query = query.where(EntryRequestRecord.name.icontains(search.strip(), autoescape=True))
    return [
        view(row, session)
        for row in session.scalars(
            query.order_by(EntryRequestRecord.created_at.desc(), EntryRequestRecord.id)
            .offset(offset)
            .limit(limit)
        )
    ]


def decide_entry_request(
    session: Session, request_id: str, payload: EntryRequestDecision, actor: str
):
    row = session.get(EntryRequestRecord, request_id)
    if not row:
        raise HTTPException(404, "收录请求不存在。")
    if row.status in {"resolved", "rejected"}:
        raise HTTPException(409, "该请求已结束处理。")
    if payload.entity_id and not session.get(KnowledgeEntityRecord, payload.entity_id):
        raise HTTPException(422, "关联知识对象不存在，请先完成目录收录。")
    result = session.execute(
        update(EntryRequestRecord)
        .where(
            EntryRequestRecord.id == request_id,
            EntryRequestRecord.version == payload.version,
            EntryRequestRecord.status.in_(["pending", "in-review"]),
        )
        .values(
            status=payload.status,
            reviewer_note=payload.reviewer_note,
            entity_id=payload.entity_id if payload.status == "resolved" else None,
            reviewed_at=datetime.now(UTC),
            reviewed_by=actor,
            version=payload.version + 1,
        )
    )
    if not result.rowcount:
        session.rollback()
        raise HTTPException(409, "请求已被其他审核人更新，请刷新后重试。")
    session.commit()
    session.expire_all()
    return view(session.get(EntryRequestRecord, request_id), session)
