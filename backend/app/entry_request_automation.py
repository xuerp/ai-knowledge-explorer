"""Handle entry requests automatically so staff only review the resulting facts.

Every request kind (release discovery, verification, decision evidence, visitor
suggestion) carries an official HTTPS page. The automation fetches that page
through the allow-listed fetcher, extracts facts with the same budgeted model
and quality gate as scheduled extraction, and records what happened. Facts
enter the ordinary review queue; nothing is published by this step itself.
"""

import hashlib
import json
from datetime import datetime, timedelta
from typing import Literal
from urllib.parse import urlsplit

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .database import EntryRequestRecord, SourceRecord
from .extraction import REQUEST_SOURCE_PREFIX
from .ingestion import normalize_source_url

EntryRequestKind = Literal["release", "verification", "evidence", "visitor"]
AutoState = Literal["candidates", "no-evidence", "failed", "skipped"]

RELEASE_PREFIXES = ("官方目录发现新模型：", "Official release discovery:")
VERIFY_PREFIX = "用户请求核验"
EVIDENCE_PREFIX = "决策资料补充请求"
# A failed request is retried at most this many times, a day apart.
MAX_AUTO_ATTEMPTS = 3
RETRY_AFTER = timedelta(hours=24)
# The placeholder used when a verification request had no official page.
PLACEHOLDER_HOSTS = {"airadar.rainza.cn"}


def request_kind(row: EntryRequestRecord) -> EntryRequestKind:
    reason = row.reason or ""
    if reason.startswith(RELEASE_PREFIXES):
        return "release"
    if reason.startswith(VERIFY_PREFIX) or (row.name or "").startswith("核验："):
        return "verification"
    if reason.startswith(EVIDENCE_PREFIX):
        return "evidence"
    return "visitor"


def request_source_id(row: EntryRequestRecord) -> str:
    digest = hashlib.sha256(normalize_source_url(row.source_url).encode()).hexdigest()[:16]
    return f"{REQUEST_SOURCE_PREFIX}{digest}"


def automation_candidates(session: Session, now: datetime, limit: int) -> list[EntryRequestRecord]:
    """Open requests not yet tried, or failed ones due for a retry, oldest first."""
    if limit <= 0:
        return []
    retry_before = now - RETRY_AFTER
    return list(
        session.scalars(
            select(EntryRequestRecord)
            .where(
                EntryRequestRecord.status.in_(("pending", "in-review")),
                or_(
                    EntryRequestRecord.auto_state.is_(None),
                    (EntryRequestRecord.auto_state == "failed")
                    & (EntryRequestRecord.auto_attempts < MAX_AUTO_ATTEMPTS)
                    & (EntryRequestRecord.auto_attempted_at <= retry_before),
                ),
            )
            .order_by(EntryRequestRecord.created_at.asc(), EntryRequestRecord.id)
            .limit(limit)
        )
    )


def skip_reason(row: EntryRequestRecord, allowed: tuple[str, ...]) -> str | None:
    """Why a request cannot be handled automatically, in Chinese, or None."""
    parsed = urlsplit(row.source_url or "")
    host = (parsed.hostname or "").casefold()
    if parsed.scheme != "https" or not host or host in PLACEHOLDER_HOSTS:
        return "没有可访问的官方页面，需要人工找到来源后处理。"
    if not any(host == item or host.endswith(f".{item}") for item in allowed):
        return f"官方页面所在域名 {host} 不在采集允许名单里，需要先把它加入名单。"
    return None


def request_source(session: Session, row: EntryRequestRecord, now: datetime) -> SourceRecord:
    """Reuse the registered source for this page, or register a request-owned one.

    A request-owned source is active for extraction scope only: it is never put on
    the collection schedule, so it does not add recurring fetches.
    """
    target = normalize_source_url(row.source_url)
    for existing in session.scalars(select(SourceRecord)):
        if normalize_source_url(existing.url) == target:
            return existing
    source = SourceRecord(
        id=request_source_id(row),
        url=row.source_url.rstrip("/"),
        title=f"收录请求：{row.name}"[:500],
        publisher=urlsplit(row.source_url).hostname or "official",
        active=True,
        fetch_enabled=False,
        fetch_interval_minutes=1440,
        next_fetch_at=None,
        created_at=now,
    )
    session.add(source)
    session.flush()
    return source


def record_outcome(
    row: EntryRequestRecord,
    state: AutoState,
    detail: str,
    now: datetime,
    candidate_ids: list[str] | None = None,
) -> None:
    row.auto_state = state
    row.auto_detail = detail[:2000]
    row.auto_attempted_at = now
    if state != "skipped":
        row.auto_attempts = (row.auto_attempts or 0) + 1
    if candidate_ids is not None:
        row.candidate_ids_json = json.dumps(candidate_ids)
    if state == "candidates" and row.status == "pending":
        # Candidates exist; the request now waits on their review.
        row.status = "in-review"
    row.version += 1


def rewrite_legacy_release_reasons(session: Session) -> int:
    """Give release requests queued with the English wording the Chinese one."""
    legacy = RELEASE_PREFIXES[1]
    rows = session.scalars(
        select(EntryRequestRecord).where(EntryRequestRecord.reason.startswith(legacy))
    ).all()
    for row in rows:
        publisher = row.reason.removeprefix(legacy).split(".", 1)[0].strip() or "官方"
        row.reason = (
            f"{RELEASE_PREFIXES[0]}{publisher} 官方模型目录出现新型号，请核对型号和发布范围。"
        )
    if rows:
        session.commit()
    return len(rows)


def close_reviewed_requests(session: Session, now: datetime) -> int:
    """Close requests whose generated facts have all been reviewed.

    Any approved fact resolves the request and links its entity; all rejected
    rejects it. Evidence requests stay with their own completeness check.
    """
    from .database import DecisionEvidenceRequestRecord, ReviewJobRecord

    closed = 0
    rows = session.scalars(
        select(EntryRequestRecord).where(
            EntryRequestRecord.status == "in-review",
            EntryRequestRecord.auto_state == "candidates",
        )
    ).all()
    for row in rows:
        if session.get(DecisionEvidenceRequestRecord, row.id) is not None:
            continue
        ids = json.loads(row.candidate_ids_json or "[]")
        jobs = session.scalars(select(ReviewJobRecord).where(ReviewJobRecord.id.in_(ids))).all()
        if not jobs or any(job.status not in {"approved", "rejected"} for job in jobs):
            continue
        approved = [job for job in jobs if job.status == "approved"]
        row.status = "resolved" if approved else "rejected"
        row.entity_id = approved[0].entity_id if approved else None
        row.reviewer_note = (
            f"自动结束：{len(approved)} 条事实已批准，{len(jobs) - len(approved)} 条已驳回。"
        )
        row.reviewed_by = "automation@ai-radar.local"
        row.reviewed_at = now
        row.version += 1
        closed += 1
    if closed:
        session.commit()
    return closed
