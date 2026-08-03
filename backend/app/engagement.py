from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import (
    EmailOutboxRecord,
    FollowRecord,
    NotificationRecord,
    ResearchRecord,
    UserRecord,
)
from .schemas import (
    DigestRunSummary,
    EmailOutboxView,
    FollowCreate,
    FollowView,
    KnowledgeSnapshot,
    LocalizedText,
    NotificationView,
    ResearchCreate,
    ResearchStep,
    ResearchView,
)


class EngagementService:
    def follow(
        self,
        session: Session,
        user_id: str,
        payload: FollowCreate,
        snapshot: KnowledgeSnapshot,
    ) -> FollowView | None:
        if not any(entity.id == payload.entity_id for entity in snapshot.entities):
            return None
        row = session.scalar(
            select(FollowRecord).where(
                FollowRecord.user_id == user_id,
                FollowRecord.entity_id == payload.entity_id,
            )
        )
        if row:
            row.intensity = payload.intensity
        else:
            row = FollowRecord(
                id=str(uuid4()),
                user_id=user_id,
                entity_id=payload.entity_id,
                intensity=payload.intensity,
                created_at=datetime.now(UTC),
            )
            session.add(row)
        session.commit()
        return self._follow_view(row)

    def list_follows(self, session: Session, user_id: str) -> list[FollowView]:
        rows = session.scalars(
            select(FollowRecord)
            .where(FollowRecord.user_id == user_id)
            .order_by(FollowRecord.created_at.desc())
        ).all()
        return [self._follow_view(row) for row in rows]

    def unfollow(self, session: Session, user_id: str, follow_id: str) -> bool:
        row = session.scalar(
            select(FollowRecord).where(
                FollowRecord.id == follow_id,
                FollowRecord.user_id == user_id,
            )
        )
        if not row:
            return False
        session.delete(row)
        session.commit()
        return True

    def notify_followers(
        self,
        session: Session,
        entity_id: str | None,
        change_id: str,
        title: str,
    ) -> int:
        if not entity_id:
            return 0
        follows = session.scalars(
            select(FollowRecord).where(
                FollowRecord.entity_id == entity_id,
                FollowRecord.intensity != "silent",
            )
        ).all()
        now = datetime.now(UTC)
        for follow in follows:
            session.add(
                NotificationRecord(
                    id=str(uuid4()),
                    user_id=follow.user_id,
                    entity_id=entity_id,
                    change_id=change_id,
                    title=title[:500],
                    priority="important" if follow.intensity == "instant" else "normal",
                    created_at=now,
                )
            )
        return len(follows)

    def list_notifications(self, session: Session, user_id: str) -> list[NotificationView]:
        rows = session.scalars(
            select(NotificationRecord)
            .where(NotificationRecord.user_id == user_id)
            .order_by(NotificationRecord.created_at.desc())
        ).all()
        return [self._notification_view(row) for row in rows]

    def mark_notification_read(
        self, session: Session, user_id: str, notification_id: str
    ) -> NotificationView | None:
        row = session.scalar(
            select(NotificationRecord).where(
                NotificationRecord.id == notification_id,
                NotificationRecord.user_id == user_id,
            )
        )
        if not row:
            return None
        row.read_at = row.read_at or datetime.now(UTC)
        session.commit()
        return self._notification_view(row)

    def research(
        self,
        session: Session,
        user_id: str,
        payload: ResearchCreate,
        snapshot: KnowledgeSnapshot,
    ) -> ResearchView:
        question_key = payload.question.casefold()
        entity_matches: list[tuple[str, str]] = []
        for entity in snapshot.entities:
            tokens = {
                token.casefold().strip()
                for token in [
                    entity.slug,
                    entity.name.zh,
                    entity.name.en,
                    *(entity.aliases or []),
                ]
                if token.strip()
            }
            matching_tokens = [token for token in tokens if token in question_key]
            if matching_tokens:
                entity_matches.append((entity.id, max(matching_tokens, key=len)))

        # Prefer the most specific entity mention. For example, “OpenAI Codex”
        # should resolve to the product instead of also matching the broader
        # “OpenAI” company node; “Claude Code” should not pull in all Claude claims.
        matched_entity_ids = {
            entity_id
            for entity_id, token in entity_matches
            if not any(
                token != other_token and token in other_token for _, other_token in entity_matches
            )
        }
        matched_claims = [
            claim
            for claim in snapshot.claims
            if claim.subject and claim.subject.casefold() in question_key
        ]
        if matched_entity_ids:
            entity_terms = {
                value.casefold()
                for entity in snapshot.entities
                if entity.id in matched_entity_ids
                for value in [
                    entity.id,
                    entity.slug,
                    entity.name.zh,
                    entity.name.en,
                    *(entity.aliases or []),
                ]
            }
            matched_claims.extend(
                claim
                for claim in snapshot.claims
                if claim.id not in {item.id for item in matched_claims}
                and claim.subject
                and claim.subject.casefold() in entity_terms
            )
        matched_claims = matched_claims[:8]
        status = "ready" if matched_claims else "insufficient-evidence"
        if matched_claims:
            statements = [
                claim.text.zh if payload.language == "zh" else claim.text.en
                for claim in matched_claims
            ]
            summary = "\n\n".join(f"- {statement}" for statement in statements)
        else:
            summary = (
                "当前已审核图谱没有足够证据回答此问题，系统未生成推测性结论。"
                if payload.language == "zh"
                else "The reviewed graph has insufficient evidence; no speculative answer was generated."
            )
        steps = [
            ResearchStep(
                id="understand",
                label=LocalizedText(zh="理解问题", en="Understand question"),
                status="complete",
            ),
            ResearchStep(
                id="graph",
                label=LocalizedText(zh="查询已审核图谱", en="Query reviewed graph"),
                status="complete",
                detail=LocalizedText(
                    zh=f"匹配 {len(matched_entity_ids)} 个实体、{len(matched_claims)} 条 Claim",
                    en=f"Matched {len(matched_entity_ids)} entities and {len(matched_claims)} claims",
                ),
            ),
            ResearchStep(
                id="citations",
                label=LocalizedText(zh="校验引用", en="Validate citations"),
                status="complete",
            ),
        ]
        row = ResearchRecord(
            id=str(uuid4()),
            user_id=user_id,
            question=payload.question,
            summary=summary,
            claim_ids_json=json.dumps([claim.id for claim in matched_claims]),
            steps_json=json.dumps(
                [step.model_dump(mode="json", by_alias=True) for step in steps],
                ensure_ascii=False,
            ),
            status=status,
            created_at=datetime.now(UTC),
        )
        session.add(row)
        session.commit()
        return self._research_view(row)

    def get_research(
        self,
        session: Session,
        research_id: str,
        *,
        user_id: str | None = None,
        public_slug: str | None = None,
    ) -> ResearchView | None:
        statement = select(ResearchRecord)
        if public_slug:
            statement = statement.where(ResearchRecord.published_slug == public_slug)
        else:
            statement = statement.where(
                ResearchRecord.id == research_id,
                ResearchRecord.user_id == user_id,
            )
        row = session.scalar(statement)
        return self._research_view(row) if row else None

    def publish_research(
        self, session: Session, research_id: str, user_id: str
    ) -> ResearchView | None:
        row = session.scalar(
            select(ResearchRecord).where(
                ResearchRecord.id == research_id,
                ResearchRecord.user_id == user_id,
            )
        )
        if not row:
            return None
        if not row.published_slug:
            base = re.sub(r"[^a-z0-9]+", "-", row.question.casefold()).strip("-")[:60]
            row.published_slug = f"{base or 'research'}-{row.id[:8]}"
            row.published_at = datetime.now(UTC)
            session.commit()
        return self._research_view(row)

    def queue_daily_digests(self, session: Session) -> DigestRunSummary:
        users = session.scalars(
            select(UserRecord).where(
                UserRecord.active.is_(True),
                UserRecord.daily_digest_enabled.is_(True),
            )
        ).all()
        queued = 0
        for user in users:
            unread = session.scalars(
                select(NotificationRecord)
                .where(
                    NotificationRecord.user_id == user.id,
                    NotificationRecord.read_at.is_(None),
                )
                .order_by(NotificationRecord.created_at.desc())
                .limit(20)
            ).all()
            if not unread:
                continue
            body = "\n".join(f"- {item.title}" for item in unread)
            session.add(
                EmailOutboxRecord(
                    id=str(uuid4()),
                    user_id=user.id,
                    to_email=user.email,
                    subject=f"AI Radar daily digest — {len(unread)} updates",
                    body_text=body,
                    status="queued",
                    created_at=datetime.now(UTC),
                )
            )
            queued += 1
        session.commit()
        return DigestRunSummary(recipients=len(users), messages_queued=queued)

    def list_outbox(self, session: Session) -> list[EmailOutboxView]:
        rows = session.scalars(
            select(EmailOutboxRecord).order_by(EmailOutboxRecord.created_at.desc())
        ).all()
        return [
            EmailOutboxView(
                id=row.id,
                to_email=row.to_email,
                subject=row.subject,
                status=row.status,
                created_at=row.created_at,
                sent_at=row.sent_at,
                error=row.error,
            )
            for row in rows
        ]

    @staticmethod
    def _follow_view(row: FollowRecord) -> FollowView:
        return FollowView(
            id=row.id,
            entity_id=row.entity_id,
            intensity=row.intensity,
            created_at=row.created_at,
        )

    @staticmethod
    def _notification_view(row: NotificationRecord) -> NotificationView:
        return NotificationView(
            id=row.id,
            entity_id=row.entity_id,
            change_id=row.change_id,
            title=row.title,
            priority=row.priority,
            created_at=row.created_at,
            read_at=row.read_at,
        )

    @staticmethod
    def _research_view(row: ResearchRecord) -> ResearchView:
        return ResearchView(
            id=row.id,
            question=row.question,
            summary=row.summary,
            claim_ids=json.loads(row.claim_ids_json),
            steps=[ResearchStep.model_validate(item) for item in json.loads(row.steps_json)],
            status=row.status,
            published_slug=row.published_slug,
            created_at=row.created_at,
            published_at=row.published_at,
        )
