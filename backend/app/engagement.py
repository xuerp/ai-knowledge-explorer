from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .answer_generation import CitedAnswerService
from .database import (
    EmailOutboxRecord,
    FollowRecord,
    NotificationRecord,
    ResearchRecord,
    UserRecord,
)
from .rag import LexicalRagRetriever, RagRetriever
from .schemas import (
    Claim,
    DecisionContext,
    DecisionRecommendation,
    DecisionResult,
    DecisionRisk,
    DecisionTradeoff,
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
    def __init__(
        self,
        retriever: RagRetriever | None = None,
        answer_service: CitedAnswerService | None = None,
    ):
        self.retriever = retriever or LexicalRagRetriever()
        self.answer_service = answer_service or CitedAnswerService()

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
        retrieval = self.retriever.search(session, snapshot, payload.question, limit=8)
        matched_claims = [item.claim for item in retrieval.citations]
        matched_entity_ids = set(retrieval.diagnostics.matched_entity_ids)
        status = "ready" if matched_claims else "insufficient-evidence"
        answer = self.answer_service.answer(
            payload.question,
            retrieval.citations,
            payload.language,
        )
        summary = answer.summary
        diagnostics = retrieval.diagnostics.model_copy(
            update={"generation_fallback_reason": answer.fallback_reason}
        )
        decision = self._build_decision(
            payload.decision_context,
            matched_claims,
            diagnostics.matched_entity_ids,
            snapshot,
            payload.language,
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
            citations_json=json.dumps(
                [item.model_dump(mode="json", by_alias=True) for item in retrieval.citations],
                ensure_ascii=False,
            ),
            retrieval_mode=retrieval.retrieval_mode,
            answer_mode=answer.answer_mode,
            retrieval_diagnostics_json=diagnostics.model_dump_json(by_alias=True),
            decision_context_json=(
                payload.decision_context.model_dump_json(by_alias=True)
                if payload.decision_context
                else "null"
            ),
            decision_json=decision.model_dump_json(by_alias=True) if decision else "null",
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

    @staticmethod
    def _build_decision(
        context: DecisionContext | None,
        matched_claims: list[Claim],
        matched_entity_ids: list[str],
        snapshot: KnowledgeSnapshot,
        language: str,
    ) -> DecisionResult | None:
        if context is None:
            return None

        claim_ids = [claim.id for claim in matched_claims]
        allowed_entities = set(context.candidate_entity_ids)
        claims_by_entity: dict[str, list[Claim]] = {}
        for claim in matched_claims:
            if claim.entity_id:
                claims_by_entity.setdefault(claim.entity_id, []).append(claim)
        candidates = [
            entity_id
            for entity_id in matched_entity_ids
            if entity_id in claims_by_entity
            and (not allowed_entities or entity_id in allowed_entities)
        ]
        has_conflict = any(claim.confidence == "conflict" for claim in matched_claims)
        status = "conflict" if has_conflict else "ready" if candidates else "insufficient-evidence"
        priority_keywords = {
            "quality": ("quality", "accuracy", "benchmark", "质量", "准确", "评测"),
            "cost": ("price", "pricing", "cost", "cheap", "价格", "成本", "便宜"),
            "speed": ("speed", "latency", "fast", "速度", "时延", "延迟"),
            "privacy": ("privacy", "data", "安全", "隐私", "数据"),
            "control": ("open", "weight", "self-host", "可控", "开源", "权重", "自托管"),
            "balanced": (),
        }[context.priority]
        deployment_keywords = {
            "cloud-api": ("api", "cloud", "云"),
            "private": ("private", "self-host", "私有", "自托管", "开放权重"),
            "on-device": ("device", "edge", "端侧", "设备"),
            "hybrid": ("hybrid", "混合"),
            "undecided": (),
        }[context.deployment]

        def score(entity_id: str) -> tuple[int, int, str]:
            entity_claims = claims_by_entity[entity_id]
            searchable = " ".join(
                f"{claim.text.zh} {claim.text.en}" for claim in entity_claims
            ).casefold()
            confidence_score = sum(
                {"verified": 3, "inferred": 1, "unverified": 0, "conflict": -5}[claim.confidence]
                for claim in entity_claims
            )
            constraint_score = sum(
                2 for keyword in (*priority_keywords, *deployment_keywords) if keyword in searchable
            )
            return confidence_score + constraint_score, len(entity_claims), entity_id

        ranked_candidates = sorted(candidates, key=score, reverse=True)
        primary = ranked_candidates[0] if status == "ready" and ranked_candidates else None
        alternatives = ranked_candidates[1:3] if primary else []
        entity_by_id = {entity.id: entity for entity in snapshot.entities}

        def entity_name(entity_id: str) -> str:
            entity = entity_by_id.get(entity_id)
            if not entity:
                return entity_id
            return entity.name.zh if language == "zh" else entity.name.en

        tradeoffs = [
            DecisionTradeoff(
                dimension=context.priority,
                finding=claim.text.zh if language == "zh" else claim.text.en,
                claim_ids=[claim.id],
            )
            for entity_id in ranked_candidates[:3]
            for claim in claims_by_entity[entity_id][:2]
        ]

        if language == "zh":
            summary = (
                f"在当前约束与已匹配证据下，优先核验 {entity_name(primary)}"
                + (
                    f"，并将 {', '.join(entity_name(item) for item in alternatives)} 作为备选。"
                    if alternatives
                    else "。"
                )
                if primary
                else "当前证据不足以形成有来源的候选优先级；请先完成后续核验。"
            )
            conditions = [
                f"任务：{context.task}",
                f"首要优先级：{context.priority}",
                f"部署方式：{context.deployment}",
                f"预算模式：{context.budget.mode}",
            ]
            next_checks = [
                "用真实样本进行小规模 PoC，并记录质量、时延与单位成本。",
                "在采购或上线前复核当前价格、版本与部署条款。",
            ]
            risk_detail = (
                "匹配证据中存在相互冲突的 Claim，需要人工复核。"
                if has_conflict
                else "部分结论仍依赖当前证据覆盖范围，未覆盖维度保持未知。"
            )
        else:
            summary = (
                f"Under the current constraints and matched evidence, validate {entity_name(primary)} first"
                + (
                    f", with {', '.join(entity_name(item) for item in alternatives)} as alternatives."
                    if alternatives
                    else "."
                )
                if primary
                else "The current evidence cannot support a sourced candidate priority; complete the next checks first."
            )
            conditions = [
                f"Task: {context.task}",
                f"Top priority: {context.priority}",
                f"Deployment: {context.deployment}",
                f"Budget mode: {context.budget.mode}",
            ]
            next_checks = [
                "Run a small proof of concept on representative samples and record quality, latency, and unit cost.",
                "Re-check current pricing, versions, and deployment terms before purchase or launch.",
            ]
            risk_detail = (
                "Matched claims conflict and require human review."
                if has_conflict
                else "Some conclusions remain bounded by current evidence coverage; uncovered dimensions stay unknown."
            )

        if context.exclusions:
            label = "排除条件：" if language == "zh" else "Exclusions: "
            conditions.append(label + ", ".join(context.exclusions))

        risk_state = "conflict" if has_conflict else "inferred" if claim_ids else "unknown"
        return DecisionResult(
            status=status,
            as_of=datetime.now(UTC),
            recommendation=DecisionRecommendation(
                primary_entity_id=primary,
                alternative_entity_ids=alternatives,
                summary=summary,
            ),
            conditions=conditions,
            tradeoffs=tradeoffs,
            risks=[DecisionRisk(state=risk_state, detail=risk_detail, claim_ids=claim_ids)],
            next_checks=next_checks,
            claim_ids=claim_ids,
        )

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

    def queue_daily_digests(
        self,
        session: Session,
        *,
        now: datetime | None = None,
        timezone_name: str = "Asia/Shanghai",
        due_only: bool = False,
    ) -> DigestRunSummary:
        current = now or datetime.now(UTC)
        if current.tzinfo is None:
            current = current.replace(tzinfo=UTC)
        local_now = current.astimezone(ZoneInfo(timezone_name))
        users = session.scalars(
            select(UserRecord).where(
                UserRecord.active.is_(True),
                UserRecord.daily_digest_enabled.is_(True),
            )
        ).all()
        queued = 0
        recipients = 0
        for user in users:
            if due_only and local_now.strftime("%H:%M") < user.digest_hour:
                continue
            recipients += 1
            delivery_key = f"daily:{user.id}:{local_now.date().isoformat()}"
            if session.scalar(
                select(EmailOutboxRecord.id).where(EmailOutboxRecord.delivery_key == delivery_key)
            ):
                continue
            previous_digest = session.scalar(
                select(EmailOutboxRecord)
                .where(
                    EmailOutboxRecord.user_id == user.id,
                    EmailOutboxRecord.delivery_key.is_not(None),
                )
                .order_by(EmailOutboxRecord.created_at.desc())
                .limit(1)
            )
            unread_query = select(NotificationRecord).where(
                NotificationRecord.user_id == user.id,
                NotificationRecord.read_at.is_(None),
            )
            if previous_digest:
                unread_query = unread_query.where(
                    NotificationRecord.created_at > previous_digest.created_at
                )
            unread = session.scalars(
                unread_query.order_by(NotificationRecord.created_at.desc()).limit(20)
            ).all()
            if not unread:
                continue
            body = "\n".join(f"- {item.title}" for item in unread)
            try:
                with session.begin_nested():
                    session.add(
                        EmailOutboxRecord(
                            id=str(uuid4()),
                            user_id=user.id,
                            to_email=user.email,
                            subject=f"AI Radar daily digest — {len(unread)} updates",
                            body_text=body,
                            status="queued",
                            delivery_key=delivery_key,
                            created_at=current,
                        )
                    )
                    session.flush()
            except IntegrityError:
                # A concurrent scheduler may have inserted the same per-user,
                # per-day digest after our pre-check. The unique delivery key
                # is authoritative; keep processing the rest of the batch.
                continue
            queued += 1
        session.commit()
        return DigestRunSummary(recipients=recipients, messages_queued=queued)

    def list_outbox(self, session: Session, limit: int = 200) -> list[EmailOutboxView]:
        rows = session.scalars(
            select(EmailOutboxRecord).order_by(EmailOutboxRecord.created_at.desc()).limit(limit)
        ).all()
        return [self.to_outbox_view(row) for row in rows]

    @staticmethod
    def to_outbox_view(row: EmailOutboxRecord) -> EmailOutboxView:
        return EmailOutboxView(
            id=row.id,
            to_email=row.to_email,
            subject=row.subject,
            status=row.status,
            created_at=row.created_at,
            sent_at=row.sent_at,
            attempt_count=row.attempt_count,
            last_attempt_at=row.last_attempt_at,
            next_attempt_at=row.next_attempt_at,
            delivery_lease_expires_at=row.delivery_lease_expires_at,
            error=row.error,
        )

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
            citations=json.loads(row.citations_json or "[]"),
            retrieval_mode=row.retrieval_mode,
            answer_mode=row.answer_mode,
            retrieval_diagnostics=json.loads(row.retrieval_diagnostics_json or "{}"),
            decision_context=json.loads(row.decision_context_json or "null"),
            decision=json.loads(row.decision_json or "null"),
            steps=[ResearchStep.model_validate(item) for item in json.loads(row.steps_json)],
            status=row.status,
            published_slug=row.published_slug,
            created_at=row.created_at,
            published_at=row.published_at,
        )
