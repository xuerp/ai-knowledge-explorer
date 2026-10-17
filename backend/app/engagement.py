from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from uuid import NAMESPACE_URL, uuid4, uuid5
from zoneinfo import ZoneInfo

from fastapi import HTTPException
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
from .decision_candidates import discover_candidates
from .decision_comparison import build_comparisons
from .decision_constraints import constraint_failures, current_claims, date_value
from .decision_dialogue import analysis_context, interpret_answer, normalize_context
from .decision_explanation import explain_decision
from .decision_guidance import build_guidance
from .decision_workflow import REASONS, candidate_dispositions, conflicting_entities, missing_inputs
from .rag import HybridRagRetriever, LexicalRagRetriever, RagRetriever, grounded_retrieval_citations
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


def revalidate_research(result: ResearchView, snapshot: KnowledgeSnapshot) -> ResearchView:
    """Reconcile saved advice against current publication, without rewriting history."""
    public = {item.claim.id: item.claim for item in grounded_retrieval_citations(snapshot)}
    today = datetime.now(UTC).date()
    public = {
        key: claim
        for key, claim in public.items()
        if (
            not claim.valid_from
            or (date_value(claim.valid_from) is not None and date_value(claim.valid_from) <= today)
        )
        and (
            not claim.valid_to
            or (date_value(claim.valid_to) is not None and date_value(claim.valid_to) > today)
        )
    }
    saved = {citation.claim.id: citation for citation in result.citations}
    states = {}
    for claim_id in result.claim_ids:
        if claim_id not in public:
            states[claim_id] = "unavailable"
        elif claim_id not in saved or saved[claim_id].claim != public[claim_id]:
            states[claim_id] = "updated"
        else:
            states[claim_id] = "current"
    stale = any(state != "current" for state in states.values())
    updates = {
        "citation_states": states,
        "claim_ids": [key for key, state in states.items() if state == "current"],
        "citations": [
            saved[key] for key, state in states.items() if state == "current" and key in saved
        ],
    }
    if stale:
        updates["status"] = "insufficient-evidence"
        updates["summary"] = (
            "历史引用已更新或不可用，请重新运行核验。 / Historical citations changed or are unavailable; run again."
        )
        if result.decision:
            updates["decision"] = result.decision.model_copy(
                update={
                    "status": "insufficient-evidence",
                    "claim_ids": [],
                    "tradeoffs": [],
                    "comparisons": [],
                    "candidates": [],
                    "scenario": result.decision.scenario.model_copy(
                        update={"clarification_checks": []}
                    ),
                    "scope": result.decision.scope.model_copy(
                        update={"considered_entity_ids": [], "omitted_entity_ids": []}
                    ),
                    "workflow_state": "insufficient-evidence",
                    "plan": None,
                    "guidance": None,
                    "risks": [],
                    "recommendation": DecisionRecommendation(summary=updates["summary"]),
                    "next_checks": [updates["summary"]],
                }
            )
    if (
        not stale
        and result.decision
        and result.decision_context
        and result.decision_context.workflow_version == 2
        and result.decision.guidance is None
    ):
        # Refresh presentation from the SAME saved, current citations. Keep the
        # original constraints, eligibility, scope and timestamp; never persist.
        groups = {}
        for citation in updates["citations"]:
            if citation.claim.entity_id:
                groups.setdefault(citation.claim.entity_id, []).append(citation.claim)
        language = "zh" if re.search(r"[\u3400-\u9fff]", result.question) else "en"
        base = result.decision.model_copy(
            update={
                "comparisons": [
                    row for row in result.decision.comparisons if not row.id.startswith("feature-")
                ],
                "tradeoffs": [
                    row for row in result.decision.tradeoffs if row.dimension != "business-fit"
                ],
            }
        )
        refreshed = explain_decision(base, result.decision_context, groups, snapshot, language)
        updates["decision"] = refreshed
        updates["summary"] = refreshed.recommendation.summary
    return result.model_copy(update=updates)


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
        context = payload.decision_context
        if payload.parent_research_id:
            parent = self.get_research(session, payload.parent_research_id, user_id=user_id)
            if not parent or not parent.decision_context:
                raise HTTPException(404, "Research not found.")
            if payload.clarification_answer:
                answer = interpret_answer(payload.clarification_answer)
                question = (
                    parent.decision.guidance.clarification
                    if parent.decision and parent.decision.guidance
                    else None
                )
                if not question or answer.question_id != question.id:
                    raise HTTPException(
                        409, "This clarification does not belong to the selected revision."
                    )
                if answer.option_id and answer.option_id not in {
                    "unknown",
                    *(option.id for option in question.options),
                }:
                    raise HTTPException(422, "Unknown clarification option.")
                if not answer.option_id and not (answer.text or "").strip():
                    raise HTTPException(422, "Choose an option or enter an answer.")
                context = parent.decision_context.model_copy(deep=True)
                context.intent_answers.append(answer)
            elif context is None:
                raise HTTPException(422, "Revised requirements are required.")
            elif context.task != parent.decision_context.task:
                context = context.model_copy(update={"intent_answers": []})
            elif context.intent_answers != parent.decision_context.intent_answers:
                raise HTTPException(422, "Clarification history must match the parent revision.")
            context = context.model_copy(update={"parent_research_id": parent.id})
        elif payload.clarification_answer or (
            context and (context.intent_answers or context.parent_research_id)
        ):
            raise HTTPException(
                422, "A saved parent revision is required for clarification history."
            )
        if context and context.workflow_version == 2:
            try:
                context = normalize_context(context)
            except ValueError as error:
                raise HTTPException(422, str(error)) from error
        payload = payload.model_copy(update={"decision_context": context})
        revision_id = (
            str(
                uuid5(
                    NAMESPACE_URL,
                    user_id
                    + ":"
                    + payload.parent_research_id
                    + ":"
                    + payload.language
                    + ":"
                    + context.model_dump_json(),
                )
            )
            if payload.parent_research_id and payload.clarification_answer
            else str(uuid4())
        )
        previous = session.get(ResearchRecord, revision_id)
        if previous:
            return self._research_view(previous)
        workflow_v2 = bool(
            payload.decision_context and payload.decision_context.workflow_version == 2
        )
        # V2's offline boundary is explicit. Reuse the existing hybrid fallback,
        # without inheriting an enabled external embedding provider.
        retriever = HybridRagRetriever(enabled=False) if workflow_v2 else self.retriever
        retrieval = retriever.search(
            session,
            snapshot,
            payload.decision_context.task if workflow_v2 else payload.question,
            limit=32 if workflow_v2 else 8,
            entity_ids=(
                set(payload.decision_context.candidate_entity_ids)
                if payload.decision_context and payload.decision_context.candidate_entity_ids
                else None
            ),
        )
        matched_claims = [item.claim for item in retrieval.citations]
        matched_entity_ids = set(retrieval.diagnostics.matched_entity_ids)
        decision_context = payload.decision_context
        if decision_context and decision_context.workflow_version == 2:
            # Candidate-specific evidence must not compete for eight global search slots.
            grounded = grounded_retrieval_citations(snapshot)
            current = current_claims([item.claim for item in grounded], snapshot)
            current_ids = {claim.id for claim in current}
            current_by_entity = {}
            for claim in current:
                current_by_entity.setdefault(claim.entity_id, []).append(claim)
            requested, decision_scope = discover_candidates(
                analysis_context(decision_context), snapshot, current_by_entity, payload.language
            )
            decision_context = decision_context.model_copy(
                update={"candidate_entity_ids": requested}
            )
            citations = [
                item
                for item in grounded
                if item.claim.entity_id in requested and item.claim.id in current_ids
            ]
            retrieval.citations = citations
            retrieval.diagnostics = retrieval.diagnostics.model_copy(
                update={
                    "returned_count": len(citations),
                    "candidate_count": len(current),
                    "filtered_count": len(current) - len(citations),
                    "matched_entity_ids": requested,
                }
            )
            matched_claims = [item.claim for item in citations]
            matched_entity_ids = set(requested)
        status = "ready" if matched_claims else "insufficient-evidence"
        answer = (CitedAnswerService() if workflow_v2 else self.answer_service).answer(
            payload.question,
            retrieval.citations,
            payload.language,
        )
        summary = answer.summary
        diagnostics = retrieval.diagnostics.model_copy(
            update={"generation_fallback_reason": answer.fallback_reason}
        )
        decision = self._build_decision(
            decision_context,
            matched_claims,
            diagnostics.matched_entity_ids,
            snapshot,
            payload.language,
        )
        if decision:
            if workflow_v2:
                decision.scope = decision_scope
            if workflow_v2:
                decision.guidance = build_guidance(
                    decision, payload.decision_context, snapshot, payload.language
                )
            summary = (
                decision.guidance.recommendation.summary
                if decision.guidance
                else decision.recommendation.summary
            )
            if decision.status != "ready":
                status = "failed" if decision.status == "failed" else "insufficient-evidence"
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
            id=revision_id,
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
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            existing = session.get(ResearchRecord, revision_id)
            if existing is None:
                raise
            return self._research_view(existing)
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
        context = analysis_context(context)

        relevant_entities = (
            set(matched_entity_ids)
            | set(context.candidate_entity_ids)
            | {claim.entity_id for claim in matched_claims if claim.entity_id}
        )
        today = datetime.now(UTC).date()
        conflict_entities = {
            claim.entity_id
            for claim in snapshot.claims
            if claim.confidence == "conflict"
            and claim.entity_id in relevant_entities
            and (
                not claim.valid_from
                or (
                    date_value(claim.valid_from) is not None
                    and date_value(claim.valid_from) <= today
                )
            )
            and (
                not claim.valid_to
                or (date_value(claim.valid_to) is not None and date_value(claim.valid_to) > today)
            )
        }
        matched_claims = current_claims(matched_claims, snapshot)
        claim_ids = [claim.id for claim in matched_claims]
        allowed_entities = set(context.candidate_entity_ids)
        claims_by_entity: dict[str, list[Claim]] = {}
        for claim in matched_claims:
            if claim.entity_id:
                claims_by_entity.setdefault(claim.entity_id, []).append(claim)
        entity_by_id = {entity.id: entity for entity in snapshot.entities}
        if context.workflow_version == 2:
            conflict_entities |= conflicting_entities(claims_by_entity, context)
        matched_entity_ids = list(
            dict.fromkeys([*matched_entity_ids, *context.candidate_entity_ids, *claims_by_entity])
        )

        def is_decision_eligible(entity_id: str) -> bool:
            entity = entity_by_id.get(entity_id)
            if entity is None:
                return False
            if entity_id in conflict_entities:
                return False
            return not constraint_failures(entity, claims_by_entity.get(entity_id, []), context)

        candidates = [
            entity_id
            for entity_id in matched_entity_ids
            if entity_id in claims_by_entity
            and (not allowed_entities or entity_id in allowed_entities)
            and is_decision_eligible(entity_id)
        ]
        has_conflict = bool(conflict_entities)
        status = "conflict" if has_conflict else "ready" if candidates else "insufficient-evidence"
        # Stable comparison order is not a capability ranking. Only a sole eligible
        # candidate can be a conditional first choice without comparable metrics.
        ranked_candidates = list(dict.fromkeys(candidates))
        candidate_types = {entity_by_id[item].type for item in ranked_candidates}
        if context.task_type == "unspecified" and len(candidate_types) > 1:
            ranked_candidates = []
            status = "insufficient-evidence"
        claim_ids = [claim.id for item in ranked_candidates for claim in claims_by_entity[item]]
        blocked = [
            (
                entity_by_id[item].name.zh if language == "zh" else entity_by_id[item].name.en,
                constraint_failures(entity_by_id[item], claims_by_entity.get(item, []), context),
            )
            for item in matched_entity_ids
            if item in entity_by_id and (not allowed_entities or item in allowed_entities)
        ]
        blocked = [(name, reasons) for name, reasons in blocked if reasons]
        primary = (
            ranked_candidates[0] if status == "ready" and len(ranked_candidates) == 1 else None
        )
        alternatives = ranked_candidates[:2] if not primary else []

        def entity_name(entity_id: str) -> str:
            entity = entity_by_id.get(entity_id)
            if not entity:
                return entity_id
            return entity.name.zh if language == "zh" else entity.name.en

        comparison_candidates = (
            [
                item
                for item in matched_entity_ids
                if item in claims_by_entity and (not allowed_entities or item in allowed_entities)
            ]
            if context.workflow_version == 2
            else ranked_candidates
        )
        if context.workflow_version == 2:
            claim_ids = [
                claim.id for item in comparison_candidates for claim in claims_by_entity[item]
            ]
        comparisons, compared_claim_ids = build_comparisons(
            context, comparison_candidates, claims_by_entity, language
        )
        tradeoffs = [
            DecisionTradeoff(
                dimension="additional-evidence",
                finding=claim.text.zh if language == "zh" else claim.text.en,
                claim_ids=[claim.id],
            )
            for entity_id in comparison_candidates[:3]
            for claim in claims_by_entity[entity_id][:2]
            if claim.id not in compared_claim_ids
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
                else (
                    "当前证据仅支持候选比较，尚不能形成能力排名；请核验预算、部署和同维度能力。"
                    if ranked_candidates
                    else "当前没有经证据核验满足全部硬约束的候选；缺失价格、部署或地区信息保持未知。"
                )
            )
            conditions = [
                f"任务：{context.task}",
                f"首要优先级：{ {'balanced': '综合平衡', 'quality': '效果质量', 'cost': '成本', 'speed': '速度', 'privacy': '隐私', 'control': '可控性'}[context.priority] }",
                f"部署方式：{ {'undecided': '暂不确定', 'cloud-api': '云 API', 'private': '私有部署', 'on-device': '端侧', 'hybrid': '混合'}[context.deployment] }",
                f"预算模式：{ {'unknown': '暂不确定', 'cost-first': '成本优先', 'range': '指定区间'}[context.budget.mode] }",
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
                else (
                    "Evidence supports comparison only, without a capability ranking; verify budget, deployment and comparable metrics."
                    if ranked_candidates
                    else "No candidate is verified to meet every hard constraint; missing price, deployment or regional data remains unknown."
                )
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
        if context.service_access:
            access = context.service_access
            conditions.append(
                f"商用服务范围：{access.channel}；账户层级：{access.tier}；服务使用国家：{access.region or '未确认'}。此国家不是数据存储地区；不替代全部条款及业务适用性核验。"
                if language == "zh"
                else f"Commercial service scope: {access.channel}; account tier: {access.tier}; country of service use: {access.region or 'unknown'}. This is not data residency or verification of every term and business condition."
            )
        if context.budget.mode == "range":
            conditions.append(
                "预算仅核算 Standard 未缓存模型 token 费用，不包含工具、缓存、税费或第三方加价。"
                if context.budget.cost_scope == "standard-token-only" and language == "zh"
                else "Budget covers Standard uncached model tokens only, excluding tools, caching, tax and reseller charges."
                if context.budget.cost_scope == "standard-token-only"
                else "预算要求包含全部费用；仅有模型 token 报价不能证明总费用适配。"
                if language == "zh"
                else "Budget covers all costs; a model token quote alone cannot establish total-cost fit."
            )
        if context.workflow_version == 2:
            if context.minimum_context_tokens is not None:
                conditions.append(
                    f"{'最低上下文' if language == 'zh' else 'Minimum context'}: {context.minimum_context_tokens} tokens"
                )
            if context.input_modalities:
                modality_labels = {
                    "text": "文本",
                    "image": "图像",
                    "audio": "音频",
                    "video": "视频",
                }
                conditions.append(
                    f"{'必须支持的输入' if language == 'zh' else 'Required inputs'}: {', '.join(modality_labels[value] if language == 'zh' else value for value in context.input_modalities)}"
                )
            if context.region:
                conditions.append(
                    f"{'部署地区' if language == 'zh' else 'Hosting region'}: {context.region}"
                )
            if context.commercial_use_required:
                conditions.append(
                    "须有当前可核验的商用许可"
                    if language == "zh"
                    else "Current verified commercial-use permission required"
                )
            if context.budget.mode == "range":
                unknown = "未明确" if language == "zh" else "unspecified"
                input_workload = context.budget.monthly_input_tokens
                output_workload = context.budget.monthly_output_tokens
                period = (
                    ("每月" if context.budget.period == "month" else "每百万 token")
                    if language == "zh"
                    else context.budget.period
                )
                conditions.append(
                    f"{'预算上限及口径' if language == 'zh' else 'Budget ceiling and basis'}: {context.budget.max if context.budget.max is not None else unknown} {context.budget.currency or unknown}, {period}, {context.budget.channel or unknown}; {'输入' if language == 'zh' else 'input'}={input_workload if input_workload is not None else unknown}, {'输出' if language == 'zh' else 'output'}={output_workload if output_workload is not None else unknown}"
                )
                if context.budget.maximum_input_tokens_per_request is not None:
                    conditions.append(
                        f"{'每个请求最多输入' if language == 'zh' else 'Maximum input per request'}: {context.budget.maximum_input_tokens_per_request} token"
                    )
        if blocked:
            reason_labels = {
                "excluded": "符合排除条件",
                "open-weights-unverified": "开放权重缺少核验证据",
                "region-unverified": "部署地区缺少核验证据",
                "exclusion-needs-clarification": "排除条件需要澄清",
                "different-task-type": "对象类型不符合选型任务",
                "unavailable-version": "版本尚不可用或已退出当前目录",
                "deployment-unverified": "部署方式缺少核验证据",
                "budget-assumptions-missing": "预算上限、币种或渠道未明确",
                "workload-missing": "月输入或输出工作量未明确",
                "price-unverified-or-conflicting": "价格缺少核验证据或存在冲突",
                "over-budget": "按指定工作量计算超过预算",
            }
            if context.workflow_version == 2:
                next_checks.extend(
                    REASONS[reason][language == "en"]
                    for reason in dict.fromkeys(
                        reason for _name, reasons in blocked for reason in reasons
                    )
                )
            else:
                next_checks.extend(
                    f"{name}: {', '.join(reason_labels.get(reason, reason) if language == 'zh' else reason for reason in reasons)}"
                    for name, reasons in blocked
                )

        risk_state = "conflict" if has_conflict else "inferred" if claim_ids else "unknown"
        dispositions = candidate_dispositions(
            context,
            context.candidate_entity_ids or matched_entity_ids,
            claims_by_entity,
            snapshot,
            conflict_entities,
            language,
        )
        missing = missing_inputs(context)
        if context.workflow_version == 2:
            if ranked_candidates:
                names = "、".join(entity_name(item) for item in ranked_candidates[:3])
                summary = (
                    (
                        f"{names} 的现有资料支持所选硬条件，可作为下一轮实测候选。先用同一批业务样本比较效果，再结合实际工作量核算成本。"
                        if language == "zh"
                        else f"Current evidence supports the selected hard constraints for {names}. Compare these candidates on the same business samples and cost the actual workload."
                    )
                    if not has_conflict
                    else summary
                )
            elif comparison_candidates and not has_conflict:
                reasons = list(
                    dict.fromkeys(reason for _name, items in blocked for reason in items)
                )
                gaps = "；".join(REASONS[reason][language == "en"] for reason in reasons[:3])
                summary = (
                    f"已找到 {len(comparison_candidates)} 个有引用的候选，可以比较下方已收录的事实。暂不能确认最终适配：{gaps or '任务效果尚未实测'}。"
                    if language == "zh"
                    else f"Found {len(comparison_candidates)} cited candidates. Compare the recorded facts below; final fit remains unverified: {gaps or 'task performance has not been tested'}."
                )
        workflow_state = (
            "needs-input"
            if missing
            else "conflict"
            if has_conflict
            else "no-eligible-candidate"
            if dispositions and all(row.eligibility == "excluded" for row in dispositions)
            else "insufficient-evidence"
            if not ranked_candidates
            else "ready"
        )
        result = DecisionResult(
            candidates=dispositions,
            missing_inputs=missing,
            workflow_state=workflow_state,
            status=status,
            as_of=datetime.now(UTC),
            recommendation=DecisionRecommendation(
                primary_entity_id=primary,
                alternative_entity_ids=alternatives,
                summary=summary,
            ),
            conditions=conditions,
            tradeoffs=tradeoffs,
            comparisons=comparisons,
            risks=[
                DecisionRisk(
                    state=risk_state,
                    detail=risk_detail,
                    claim_ids=[]
                    if context.workflow_version == 2 and not has_conflict
                    else claim_ids,
                )
            ],
            next_checks=next_checks,
            claim_ids=claim_ids,
        )
        return (
            explain_decision(result, context, claims_by_entity, snapshot, language)
            if context.workflow_version == 2
            else result
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
        def utc_timestamp(value: datetime | None) -> datetime | None:
            # SQLite drops timezone information from UTC database timestamps.
            # Keep freshly created and reopened research dates consistent.
            return (
                value.replace(tzinfo=UTC) if value is not None and value.tzinfo is None else value
            )

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
            created_at=utc_timestamp(row.created_at),
            published_at=utc_timestamp(row.published_at),
        )
