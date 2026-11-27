from __future__ import annotations

import json
import re
from datetime import UTC, datetime, timedelta
from uuid import NAMESPACE_URL, uuid4, uuid5
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .answer_generation import AnswerResult, CitedAnswerService
from .database import (
    DecisionEvidenceRequestRecord,
    DecisionValidationRecord,
    EmailOutboxRecord,
    FollowRecord,
    NotificationRecord,
    ResearchRecord,
    UserRecord,
)
from .decision_candidates import discover_candidates
from .decision_comparison import build_comparisons
from .decision_constraints import (
    constraint_failures,
    current_claims,
    date_value,
    is_available_version,
)
from .decision_dialogue import analysis_context, interpret_answer, normalize_context
from .decision_explanation import explain_decision
from .decision_guidance import build_guidance
from .decision_resolution import reconcile_resolution
from .decision_semantics import TaskMeaningService, meaning_source
from .decision_workflow import REASONS, candidate_dispositions, conflicting_entities, missing_inputs
from .rag import LexicalRagRetriever, RagRetriever, RagSearchResult, grounded_retrieval_citations
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
    ResearchSummaryView,
    ResearchView,
    RetrievalDiagnostics,
)


def revalidate_research(result: ResearchView, snapshot: KnowledgeSnapshot) -> ResearchView:
    """Reconcile saved advice against current publication, without rewriting history."""
    public_citations = {item.claim.id: item for item in grounded_retrieval_citations(snapshot)}
    public = {key: item.claim for key, item in public_citations.items()}
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
    groups: dict[str, list[Claim]] = {}
    for claim in public.values():
        if claim.entity_id:
            groups.setdefault(claim.entity_id, []).append(claim)
    conflicts = conflicting_entities(groups, result.decision_context)
    conflicts.update(
        claim.entity_id
        for claim in snapshot.claims
        if claim.confidence == "conflict"
        and (
            not claim.valid_from
            or (date_value(claim.valid_from) is not None and date_value(claim.valid_from) <= today)
        )
        and (
            not claim.valid_to
            or (date_value(claim.valid_to) is not None and date_value(claim.valid_to) > today)
        )
    )
    saved_groups: dict[str, list[Claim]] = {}
    for citation in result.citations:
        if citation.claim.entity_id:
            saved_groups.setdefault(citation.claim.entity_id, []).append(citation.claim)
    # A conflict already present in the saved evidence is not a publication change.
    conflicts -= conflicting_entities(saved_groups, result.decision_context)
    states = {}
    for claim_id in result.claim_ids:
        if claim_id not in public:
            states[claim_id] = "unavailable"
        elif (
            claim_id not in saved
            or saved[claim_id] != public_citations[claim_id]
            or (
                result.decision is not None
                and result.decision.status != "conflict"
                and public[claim_id].entity_id in conflicts
            )
        ):
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
            "历史引用已更新、不可用或出现冲突，请重新运行核验。 / Historical citations changed, are unavailable or now conflict; run again."
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
                    "model_led": None,
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
    updated = result.model_copy(update=updates)
    if (
        not stale
        and updated.decision
        and updated.decision_context
        and updated.decision_context.workflow_version == 2
        and updated.decision.plan
        and updated.decision.plan.trial
        and (
            updated.decision.scenario.id == "document-extraction"
            or (
                (guidance := updated.decision.guidance)
                and guidance.schema_version == 1
                and guidance.outcome in {"advice", "conditional"}
                and guidance.next_action.kind in {"start", "compare"}
            )
        )
    ):
        # Refresh proposed next steps from the original task and still-current
        # saved evidence. Do not persist the refresh or change validation records.
        from .decision_plan import build_plan

        language = "zh" if re.search(r"[\u3400-\u9fff]", updated.question) else "en"
        decision = updated.decision.model_copy()
        decision.plan = build_plan(decision, updated.decision_context, language, snapshot)
        decision.guidance = build_guidance(decision, updated.decision_context, snapshot, language)
        updated.decision = reconcile_resolution(decision, updated.decision_context, language)
        updated.summary = decision.guidance.recommendation.summary
    if updated.decision:
        updated.decision = reconcile_resolution(updated.decision)
    return updated


def catalog_fingerprint(snapshot: KnowledgeSnapshot) -> str:
    """A short digest of the published facts a research result depends on."""
    import hashlib

    digest = hashlib.sha256()
    for claim in sorted(snapshot.claims, key=lambda item: item.id):
        digest.update(
            f"{claim.id}|{claim.updated_at}|{claim.confidence}|{claim.valid_to or ''}\n".encode()
        )
    for evidence in sorted(snapshot.evidence, key=lambda item: item.id):
        digest.update(f"{evidence.id}|{evidence.verified_at or ''}\n".encode())
    for entity in sorted(snapshot.entities, key=lambda item: item.id):
        digest.update(f"{entity.id}|{entity.status}|{entity.last_updated_at}\n".encode())
    return digest.hexdigest()[:32]


class EngagementService:
    def __init__(
        self,
        retriever: RagRetriever | None = None,
        answer_service: CitedAnswerService | None = None,
        task_meaning_service: TaskMeaningService | None = None,
        *,
        model_led: bool = False,
    ):
        self.retriever = retriever or LexicalRagRetriever()
        self.answer_service = answer_service or CitedAnswerService()
        self.task_meaning_service = task_meaning_service or TaskMeaningService()
        # Model-led analysis replaces rule gating only when explicitly enabled.
        self.model_led = model_led

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
            # A client-supplied interpretation is never trusted. Recompute with
            # the server-owned service; persist the validated receipt for replay.
            context = context.model_copy(update={"task_meaning": None})
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
        duplicate = self._recent_duplicate(session, user_id, payload, snapshot)
        if duplicate is not None:
            # A double click, second tab or refresh resubmits the identical task.
            # Return the record already made instead of paying for another one.
            return self._research_view(duplicate)
        if (
            context
            and context.workflow_version == 2
            # Model-led analysis states its own task understanding. A separate
            # interpretation call would double latency and spend for one request.
            and not (self.model_led and self.answer_service.enabled)
        ):
            # Parse only a new revision. A provider's nondeterministic wording
            # must not change revision identity or trigger duplicate paid work.
            context = context.model_copy(
                update={
                    "task_meaning": self.task_meaning_service.understand(
                        meaning_source(context), owner_id=user_id
                    )
                }
            )
            payload = payload.model_copy(update={"decision_context": context})
        workflow_v2 = bool(
            payload.decision_context and payload.decision_context.workflow_version == 2
        )
        decision_context = payload.decision_context
        if workflow_v2:
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
            retrieval = RagSearchResult(
                citations,
                RetrievalDiagnostics(
                    returned_count=len(citations),
                    candidate_count=len(current),
                    filtered_count=len(current) - len(citations),
                    matched_entity_ids=requested,
                    fallback_reason="hybrid-disabled",
                ),
            )
        else:
            retrieval = self.retriever.search(
                session,
                snapshot,
                payload.question,
                entity_ids=(
                    set(decision_context.candidate_entity_ids)
                    if decision_context and decision_context.candidate_entity_ids
                    else None
                ),
            )
            if self.answer_service.enabled:
                # Retrieval may flush index maintenance. Release the write
                # transaction before the independent budget reservation.
                session.commit()
        matched_claims = [item.claim for item in retrieval.citations]
        matched_entity_ids = set(retrieval.diagnostics.matched_entity_ids)
        status = "ready" if matched_claims else "insufficient-evidence"
        decision = self._build_decision(
            decision_context,
            matched_claims,
            retrieval.diagnostics.matched_entity_ids,
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
                decision = reconcile_resolution(
                    decision, payload.decision_context, payload.language
                )
            if decision.status != "ready":
                status = "failed" if decision.status == "failed" else "insufficient-evidence"
        model_led_outcome = None
        if decision and workflow_v2 and self.model_led and self.answer_service.enabled:
            # Model-led replaces rule gating, including clarification: the model
            # states its assumptions and the rule question stays available below.
            model_led_outcome = self._model_led(session, snapshot, payload, retrieval, user_id)
            if model_led_outcome.analysis:
                decision.model_led = model_led_outcome.analysis
                status = "ready"
                saved = {item.claim.id for item in retrieval.citations}
                retrieval.citations = [
                    *retrieval.citations,
                    *(item for item in model_led_outcome.citations if item.claim.id not in saved),
                ]
                matched_claims = [item.claim for item in retrieval.citations]
        # Resolve constraints BEFORE synthesis. The model cannot promote an
        # excluded/unknown candidate, replace a choice or erase a blocking limit.
        generation_citations = retrieval.citations
        generation_context = None
        if decision:
            eligible = {
                item.entity_id for item in decision.candidates if item.eligibility == "eligible"
            }
            if decision.guidance:
                eligible.intersection_update(decision.guidance.recommendation.entity_ids)
            generation_citations = [
                item for item in retrieval.citations if item.claim.entity_id in eligible
            ]
            generation_context = {
                "requirements": payload.decision_context.model_dump(
                    mode="json",
                    by_alias=True,
                    exclude={"notes", "parent_research_id"},
                ),
                "eligibleEntityIds": sorted(eligible),
                "recommendation": decision.recommendation.model_dump(mode="json", by_alias=True),
                "conditions": decision.conditions,
            }
            if decision.guidance:
                chosen = decision.guidance.recommendation
                generation_context["choice"] = {
                    "headline": chosen.headline,
                    "entityIds": chosen.entity_ids,
                    "primaryEntityId": chosen.primary_entity_id,
                    "tradeoff": chosen.tradeoff,
                }
            if decision.guidance and decision.guidance.outcome in {
                "clarify",
                "blocked",
                "unsupported",
            }:
                generation_citations = []
        if model_led_outcome and model_led_outcome.analysis:
            # One paid call per research. The validated model-led analysis is the
            # synthesis; do not spend a second call on the legacy answer.
            answer = AnswerResult(model_led_outcome.analysis.summary.text, "generated")
        elif model_led_outcome is not None:
            # Model analysis ran and failed. Show the rule result openly instead of
            # quietly spending a second paid call that hides the failure.
            answer = AnswerResult(
                self.answer_service._extractive(generation_citations, payload.language),
                "extractive",
                model_led_outcome.fallback_reason,
            )
        else:
            answer = self.answer_service.answer(
                payload.question,
                generation_citations,
                payload.language,
                user_id=user_id,
                context=generation_context,
            )
        summary = answer.summary
        if not decision and answer.fallback_reason == "generation-insufficient-evidence":
            status = "insufficient-evidence"
        if decision:
            recommendation = (
                decision.guidance.recommendation if decision.guidance else decision.recommendation
            )
            if answer.statements:
                # Store once in the structured authority consumed by the inline
                # page, saved view, public share and Markdown/PDF exporters.
                recommendation.reasons = [
                    DecisionTradeoff(
                        dimension="evidence-synthesis",
                        finding=item.text_zh if payload.language == "zh" else item.text_en,
                        claim_ids=item.claim_ids,
                    )
                    for item in answer.statements
                ]
            if answer.lead and decision.guidance and decision.guidance.outcome == "advice":
                # The model writes the lead sentence only for plain advice; conditional,
                # clarify and blocked summaries keep the host's caveats verbatim. The
                # headline, candidates and constraints remain host decisions.
                recommendation.summary = (
                    answer.lead.text_zh if payload.language == "zh" else answer.lead.text_en
                )
                recommendation.summary_source = "model"
                recommendation.summary_claim_ids = answer.lead.claim_ids
            summary = recommendation.summary
        diagnostics = retrieval.diagnostics.model_copy(
            update={
                "generation_fallback_reason": (
                    model_led_outcome.fallback_reason if model_led_outcome else None
                )
                or answer.fallback_reason,
                "generation_fallback_detail": (
                    model_led_outcome.detail if model_led_outcome else None
                ),
                "generation_attempts": (model_led_outcome.attempts if model_led_outcome else 0),
                "catalog_fingerprint": catalog_fingerprint(snapshot),
            }
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

    DUPLICATE_WINDOW_SECONDS = 60

    @staticmethod
    def _submission_key(question, language, context) -> str:
        """What the user actually typed and chose; server-derived fields are ignored."""
        if context is None:
            return language + "\n" + question
        chosen = context.model_dump(
            mode="json",
            include={
                "task",
                "notes",
                "priority",
                "deployment",
                "budget",
                "exclusions",
                "task_type",
                "region",
                "commercial_use_required",
                "input_modalities",
                "minimum_context_tokens",
            },
        )
        return language + "\n" + question + "\n" + json.dumps(chosen, sort_keys=True)

    def _recent_duplicate(self, session, user_id, payload, snapshot):
        """The same owner's identical submission from the last minute, if any.

        Reused only while every saved citation is still current: after a fact is
        published, withdrawn or superseded, the same question is researched afresh.
        """
        if payload.parent_research_id or payload.clarification_answer:
            return None
        since = datetime.now(UTC) - timedelta(seconds=self.DUPLICATE_WINDOW_SECONDS)
        key = self._submission_key(payload.question, payload.language, payload.decision_context)
        fingerprint = catalog_fingerprint(snapshot)
        rows = session.scalars(
            select(ResearchRecord)
            .where(
                ResearchRecord.user_id == user_id,
                ResearchRecord.question == payload.question,
                ResearchRecord.created_at >= since,
            )
            .order_by(ResearchRecord.created_at.desc())
            .limit(5)
        ).all()
        for row in rows:
            saved = self._research_view(row)
            saved_language = "zh" if re.search(r"[\u3400-\u9fff]", saved.question) else "en"
            if saved_language != payload.language:
                continue
            saved_key = self._submission_key(
                saved.question, payload.language, saved.decision_context
            )
            if saved_key != key:
                continue
            # Any publication, withdrawal or new fact changes the fingerprint, so
            # the same question then gets fresh research instead of a stale copy.
            if saved.retrieval_diagnostics.catalog_fingerprint != fingerprint:
                continue
            return row
        return None

    def _model_led(self, session, snapshot, payload, retrieval, user_id):
        """Whole-catalog retrieval plus one model-led call; never raises."""
        from .decision_model_led import run_model_led

        context = payload.decision_context
        task = (context.task if context else None) or payload.question
        try:
            broad = self.retriever.search(session, snapshot, task, limit=24)
            session.commit()
        except Exception:  # noqa: BLE001 -- retrieval failure keeps the rule path
            session.rollback()
            broad = retrieval
        # Retired, unreleased and rumoured versions stay in the catalog for history
        # but are never offered to the model: it cannot recommend what it never sees.
        # Previews remain available, matching the rule screening.
        usable = {entity.id for entity in snapshot.entities if is_available_version(entity)}
        merged, seen = [], set()
        for item in [*broad.citations, *retrieval.citations]:
            entity_id = item.claim.entity_id
            if entity_id and entity_id not in usable:
                continue
            if item.claim.id not in seen:
                seen.add(item.claim.id)
                merged.append(item)
        return run_model_led(
            self.answer_service.generator,
            task,
            merged[:40],
            snapshot,
            context,
            payload.language,
            user_id=user_id,
        )

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

    def count_research(self, session: Session, user_id: str) -> int:
        return (
            session.scalar(
                select(func.count())
                .select_from(ResearchRecord)
                .where(ResearchRecord.user_id == user_id)
            )
            or 0
        )

    def list_research(
        self, session: Session, user_id: str, *, limit: int = 30, offset: int = 0
    ) -> list[ResearchSummaryView]:
        """The owner's records, newest first, one page at a time. Never another user's."""
        rows = session.scalars(
            select(ResearchRecord)
            .where(ResearchRecord.user_id == user_id)
            # The id breaks ties so pages never repeat or skip a record.
            .order_by(ResearchRecord.created_at.desc(), ResearchRecord.id.desc())
            .offset(max(0, offset))
            .limit(max(1, min(limit, 100)))
        ).all()
        summaries = []
        for row in rows:
            try:
                decision = json.loads(row.decision_json or "null") or {}
                context = json.loads(row.decision_context_json or "null") or {}
            except ValueError:
                decision, context = {}, {}
            model_led = decision.get("modelLed") or {}
            guidance = decision.get("guidance") or {}
            # A clarifying question is not a title for a saved result: it reads
            # as if the record asked the user something. Show the task instead.
            asks_back = guidance.get("outcome") == "clarify" or bool(guidance.get("clarification"))
            headline = model_led.get("headline") or (
                None if asks_back else (guidance.get("recommendation") or {}).get("headline")
            )
            headline = headline or (context.get("task") or row.question or row.summary)
            created = row.created_at
            summaries.append(
                ResearchSummaryView(
                    id=row.id,
                    question=(context.get("task") or row.question)[:300],
                    headline=(headline or "")[:200],
                    status=row.status,
                    answer_mode=row.answer_mode,
                    model_led=bool(model_led),
                    published_slug=row.published_slug,
                    created_at=created.replace(tzinfo=UTC) if created.tzinfo is None else created,
                )
            )
        return summaries

    def delete_research(self, session: Session, research_id: str, user_id: str) -> bool:
        """Permanently delete the owner's record and its private links.

        Shared public maintenance requests (entry_requests) are kept; only this
        record's private link to them is removed. A published share stops working.
        """
        row = session.scalar(
            select(ResearchRecord).where(
                ResearchRecord.id == research_id, ResearchRecord.user_id == user_id
            )
        )
        if not row:
            return False
        from .knowledge_checks import delete_pending_checks

        saved = self._research_view(row)
        delete_pending_checks(
            session, research_id, saved.decision.model_led if saved.decision else None
        )
        session.execute(
            delete(DecisionEvidenceRequestRecord).where(
                DecisionEvidenceRequestRecord.research_id == research_id
            )
        )
        session.execute(
            delete(DecisionValidationRecord).where(
                DecisionValidationRecord.research_id == research_id
            )
        )
        session.delete(row)
        session.commit()
        return True

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
