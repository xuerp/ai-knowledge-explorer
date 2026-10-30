import json
import re
from datetime import UTC, datetime, timedelta
from typing import Literal
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..application_rules import RELATION_CLAIM_PREDICATES, RELATION_PREDICATE_ANCHORS
from ..auth import Principal
from ..database import (
    AuditLogRecord,
    DocumentSnapshotRecord,
    ReviewJobRecord,
    SourceRecord,
)
from ..extraction import (
    EXTRACTION_PIPELINE_VERSION,
    entity_reference_appears,
    extraction_audit_is_current,
)
from ..quality import (
    CORE_ENTITY_RELATION_REQUIREMENT,
    claim_semantic_fingerprint,
    relation_semantic_fingerprint,
    resolve_unique_entity_reference,
)
from ..repository import OPEN_REVIEW_STATUSES
from ..schemas import (
    CandidateCreate,
    Claim,
    RelationBackfillStatus,
    ReviewDecision,
    ReviewQueueItem,
)


class ExtractionServices:
    def build_extraction_plan(
        self,
        session: Session,
        limit: int,
        *,
        automatic_only: bool = False,
        excluded_snapshot_ids: set[str] | None = None,
    ) -> list[tuple[SourceRecord, DocumentSnapshotRecord]]:
        extraction_runs = session.scalars(
            select(AuditLogRecord).where(
                AuditLogRecord.action == "extraction.run",
                AuditLogRecord.target_type == "document_snapshot",
            )
        ).all()
        extracted_snapshot_ids = {
            row.target_id for row in extraction_runs if extraction_audit_is_current(row.detail_json)
        }
        extracted_snapshot_ids.update(excluded_snapshot_ids or set())
        cooling_down_snapshot_ids: set[str] = set()
        if automatic_only:
            retry_after = datetime.now(UTC) - timedelta(
                minutes=self.app_settings.auto_extraction_retry_minutes
            )
            recent_failures = session.scalars(
                select(AuditLogRecord).where(
                    AuditLogRecord.action == "extraction.failed",
                    AuditLogRecord.target_type == "document_snapshot",
                    AuditLogRecord.created_at >= retry_after,
                )
            ).all()
            cooling_down_snapshot_ids = {
                row.target_id
                for row in recent_failures
                if extraction_audit_is_current(row.detail_json)
            }
        snapshots = session.scalars(
            select(DocumentSnapshotRecord).order_by(
                DocumentSnapshotRecord.observed_at.desc(),
                DocumentSnapshotRecord.id.desc(),
            )
        ).all()
        eligible: list[tuple[SourceRecord, DocumentSnapshotRecord]] = []
        seen_sources: set[str] = set()
        for snapshot_row in snapshots:
            if snapshot_row.source_id in seen_sources:
                continue
            seen_sources.add(snapshot_row.source_id)
            if snapshot_row.id in extracted_snapshot_ids:
                continue
            if snapshot_row.id in cooling_down_snapshot_ids:
                continue
            source = session.get(SourceRecord, snapshot_row.source_id)
            if not source or not source.active:
                continue
            eligible.append((source, snapshot_row))

        public_snapshot = self.get_catalog_snapshot(session)
        quality = self.quality_gate.report(public_snapshot)
        priority_ids = set(quality.core_entities_below_five_relations)
        priority_entities = [
            entity for entity in public_snapshot.entities if entity.id in priority_ids
        ]
        priority_weights = {
            entity_id: CORE_ENTITY_RELATION_REQUIREMENT
            - quality.core_entity_relation_counts[entity_id]
            for entity_id in priority_ids
        }

        def priority_mentions(
            item: tuple[SourceRecord, DocumentSnapshotRecord],
        ) -> int:
            return sum(
                priority_weights[entity.id] * entity_reference_appears(item[1].content_text, entity)
                for entity in priority_entities
            )

        eligible.sort(
            key=lambda item: (
                priority_mentions(item),
                item[1].observed_at,
                item[1].id,
            ),
            reverse=True,
        )
        return eligible[:limit]

    def build_relation_backfill_plan(
        self,
        session: Session,
        limit: int,
        *,
        excluded_snapshot_ids: set[str] | None = None,
    ) -> tuple[list[tuple[SourceRecord, DocumentSnapshotRecord]], int]:
        batch_id = self.app_settings.relation_backfill_batch_id
        budget = self.app_settings.relation_backfill_max_snapshots
        if not batch_id or budget <= 0:
            return [], 0

        audit_state = self.relation_backfill_audit_state(session, batch_id)
        attempted_snapshot_ids = audit_state["attemptedSnapshotIds"]
        attempts = int(audit_state["attempts"])
        remaining = max(0, budget - attempts)
        if remaining == 0 or limit <= 0:
            return [], remaining

        public_snapshot = self.get_catalog_snapshot(session)
        quality = self.quality_gate.report(public_snapshot)
        if quality.core_relation_deficit <= 0:
            return [], remaining
        priority_ids = set(quality.core_entities_below_five_relations)
        priority_entities = [
            entity for entity in public_snapshot.entities if entity.id in priority_ids
        ]
        priority_weights = {
            entity_id: CORE_ENTITY_RELATION_REQUIREMENT
            - quality.core_entity_relation_counts[entity_id]
            for entity_id in priority_ids
        }

        snapshots = session.scalars(
            select(DocumentSnapshotRecord).order_by(
                DocumentSnapshotRecord.observed_at.desc(),
                DocumentSnapshotRecord.id.desc(),
            )
        ).all()
        excluded = excluded_snapshot_ids or set()
        eligible: list[tuple[int, SourceRecord, DocumentSnapshotRecord]] = []
        seen_sources: set[str] = set()
        for snapshot_row in snapshots:
            if snapshot_row.source_id in seen_sources:
                continue
            seen_sources.add(snapshot_row.source_id)
            if snapshot_row.id in attempted_snapshot_ids or snapshot_row.id in excluded:
                continue
            source = session.get(SourceRecord, snapshot_row.source_id)
            if not source or not source.active:
                continue
            # 关系补齐只读取已经持久化的不可变快照，不发起采集请求。因此，位于
            # 官方白名单内的人工或熔断信源也可以参与一次性批次，而无需恢复联网采集。
            # 信任边界使用管理员登记的原始官方 URL，不使用为采集兜底准备的镜像地址。
            host = (urlsplit(source.url).hostname or "").lower()
            if host not in self.app_settings.fetch_allowed_hosts:
                continue
            score = sum(
                priority_weights[entity.id]
                for entity in priority_entities
                if entity_reference_appears(snapshot_row.content_text, entity)
            )
            if score <= 0:
                continue
            eligible.append((score, source, snapshot_row))

        eligible.sort(
            key=lambda item: (item[0], item[2].observed_at, item[2].id),
            reverse=True,
        )
        selected = eligible[: min(limit, remaining)]
        return [(source, snapshot) for _, source, snapshot in selected], remaining

    def relation_backfill_audit_state(self, session: Session, batch_id: str) -> dict[str, object]:
        attempt_rows = session.scalars(
            select(AuditLogRecord).where(
                AuditLogRecord.action.in_({"extraction.run", "extraction.failed"}),
                AuditLogRecord.target_type == "document_snapshot",
            )
        ).all()
        attempted_snapshot_ids: set[str] = set()
        state: dict[str, object] = {
            "attempts": 0,
            "succeeded": 0,
            "failed": 0,
            "candidatesCreated": 0,
            "duplicatesSkipped": 0,
            "relationsAutoApproved": 0,
        }
        for row in attempt_rows:
            try:
                detail = json.loads(row.detail_json)
            except (TypeError, ValueError):
                continue
            if detail.get("relationBackfillBatchId") != batch_id:
                continue
            state["attempts"] = int(state["attempts"]) + 1
            outcome = "succeeded" if row.action == "extraction.run" else "failed"
            state[outcome] = int(state[outcome]) + 1
            state["candidatesCreated"] = int(state["candidatesCreated"]) + int(
                detail.get("candidatesCreated", 0)
            )
            state["duplicatesSkipped"] = int(state["duplicatesSkipped"]) + int(
                detail.get("duplicatesSkipped", 0)
            )
            state["relationsAutoApproved"] = int(state["relationsAutoApproved"]) + int(
                detail.get("relationsAutoApproved", 0)
            )
            attempted_snapshot_ids.add(row.target_id)
        state["attemptedSnapshotIds"] = attempted_snapshot_ids
        return state

    def get_relation_backfill_status(self, session: Session) -> RelationBackfillStatus:
        batch_id = self.app_settings.relation_backfill_batch_id
        budget = self.app_settings.relation_backfill_max_snapshots
        quality = self.quality_gate.report(self.get_catalog_snapshot(session))
        if not batch_id or budget <= 0:
            return RelationBackfillStatus(
                configured=False,
                status="disabled",
                budget=0,
                attempts=0,
                succeeded=0,
                failed=0,
                candidates_created=0,
                duplicates_skipped=0,
                relations_auto_approved=0,
                attempts_remaining=0,
                eligible_snapshots=0,
                relation_deficit=quality.core_relation_deficit,
                core_entities_below_requirement=len(quality.core_entities_below_five_relations),
            )
        state = self.relation_backfill_audit_state(session, batch_id)
        attempts = int(state["attempts"])
        remaining = max(0, budget - attempts)
        eligible, _ = self.build_relation_backfill_plan(session, remaining)
        complete = (
            quality.core_relation_deficit <= 0 or remaining == 0 or (attempts > 0 and not eligible)
        )
        phase: Literal["waiting", "running", "complete"] = (
            "complete" if complete else "running" if attempts > 0 else "waiting"
        )
        return RelationBackfillStatus(
            configured=True,
            status=phase,
            batch_id=batch_id,
            budget=budget,
            attempts=attempts,
            succeeded=int(state["succeeded"]),
            failed=int(state["failed"]),
            candidates_created=int(state["candidatesCreated"]),
            duplicates_skipped=int(state["duplicatesSkipped"]),
            relations_auto_approved=int(state["relationsAutoApproved"]),
            attempts_remaining=remaining,
            eligible_snapshots=len(eligible),
            relation_deficit=quality.core_relation_deficit,
            core_entities_below_requirement=len(quality.core_entities_below_five_relations),
        )

    def create_extraction_candidates(
        self,
        session: Session,
        source: SourceRecord,
        snapshot_row: DocumentSnapshotRecord,
        max_candidates: int,
    ) -> tuple[list[ReviewQueueItem], int]:
        public_snapshot = self.get_catalog_snapshot(session)
        quality = self.quality_gate.report(public_snapshot)
        candidates = self.extraction.extract(
            source,
            snapshot_row,
            max_candidates,
            public_snapshot.entities,
            priority_entity_ids=quality.core_entities_below_five_relations,
            priority_entity_deficits={
                entity_id: CORE_ENTITY_RELATION_REQUIREMENT
                - quality.core_entity_relation_counts[entity_id]
                for entity_id in quality.core_entities_below_five_relations
            },
            claims_remaining=quality.claims_remaining,
            relation_deficit=quality.core_relation_deficit,
        )

        def semantic_fingerprint(
            claim: Claim,
            entity_id: str | None = None,
        ) -> tuple[str, str, str, str, str]:
            object_entity_id = None
            if claim.predicate in RELATION_CLAIM_PREDICATES:
                object_entity_id = resolve_unique_entity_reference(
                    claim.object_or_value,
                    public_snapshot.entities,
                )
            return claim_semantic_fingerprint(
                claim,
                entity_id,
                object_entity_id,
            )

        published_fingerprints = {semantic_fingerprint(claim) for claim in public_snapshot.claims}
        published_fingerprints.update(
            relation_semantic_fingerprint(
                edge.from_id,
                edge.kind,
                edge.to_id,
                edge.valid_from or "",
                edge.valid_to or "",
            )
            for edge in public_snapshot.graph.edges
            if edge.kind in RELATION_CLAIM_PREDICATES
        )
        open_review_rows = session.scalars(
            select(ReviewJobRecord).where(ReviewJobRecord.status.in_(OPEN_REVIEW_STATUSES))
        ).all()
        open_rows_by_id = {row.id: row for row in open_review_rows}
        open_fingerprints = {
            semantic_fingerprint(
                Claim.model_validate_json(existing_row.claim_json),
                existing_row.entity_id,
            ): existing_row
            for existing_row in open_review_rows
        }

        def merge_duplicate_evidence(
            existing_row: ReviewJobRecord,
            candidate: CandidateCreate,
        ) -> None:
            existing_claim = Claim.model_validate_json(existing_row.claim_json)
            evidence_by_id = {
                evidence.id: evidence
                for evidence in self.repository.approved_evidence(existing_row)
            }
            changed = False
            for evidence in candidate.evidence:
                existing_evidence = evidence_by_id.get(evidence.id)
                if existing_evidence is not None:
                    if evidence.source_excerpt and not existing_evidence.source_excerpt:
                        evidence_by_id[evidence.id] = existing_evidence.model_copy(
                            update={"source_excerpt": evidence.source_excerpt}
                        )
                        changed = True
                    continue
                evidence_by_id[evidence.id] = evidence.model_copy(
                    update={"supports_claim_ids": [existing_claim.id]}
                )
                changed = True
            if not changed:
                return
            evidence_items = list(evidence_by_id.values())
            existing_claim = existing_claim.model_copy(
                update={"source_ids": [evidence.id for evidence in evidence_items]}
            )
            existing_row.claim_json = existing_claim.model_dump_json(by_alias=True)
            existing_row.evidence_ids_json = json.dumps(
                [evidence.id for evidence in evidence_items]
            )
            existing_row.evidence_json = json.dumps(
                [evidence.model_dump(mode="json", by_alias=True) for evidence in evidence_items],
                ensure_ascii=False,
            )
            existing_row.version += 1
            if not existing_row.review_reason:
                existing_row.review_reason = "检测到重复事实，已合并新增证据。"

        created: list[ReviewQueueItem] = []
        duplicates_skipped = 0
        for candidate in candidates:
            assessment = self.quality_gate.assess(candidate, public_snapshot)
            if assessment.resolved_entity_id:
                candidate = candidate.model_copy(
                    update={"entity_id": assessment.resolved_entity_id}
                )
            if existing_row := open_rows_by_id.get(candidate.id):
                previous_version = existing_row.version
                merge_duplicate_evidence(existing_row, candidate)
                if not existing_row.entity_id and candidate.entity_id:
                    existing_row.entity_id = candidate.entity_id
                    existing_row.version += 1
                if existing_row.version != previous_version:
                    session.commit()
                duplicates_skipped += 1
                continue
            fingerprint = semantic_fingerprint(
                candidate.claim,
                candidate.entity_id,
            )
            if fingerprint in published_fingerprints:
                duplicates_skipped += 1
                continue
            if existing_row := open_fingerprints.get(fingerprint):
                merge_duplicate_evidence(existing_row, candidate)
                duplicates_skipped += 1
                continue
            reason = None
            if assessment.conflicting_claim_ids:
                reason = "Structured conflict detected against: " + ", ".join(
                    assessment.conflicting_claim_ids
                )
            row = self.ingestion.submit_candidate(
                session,
                candidate,
                queue_status=assessment.queue_status,
                conflict_claim_ids=assessment.conflicting_claim_ids,
                review_reason=reason,
            )
            if row:
                created.append(self.repository.to_queue_item(row))
                open_fingerprints[fingerprint] = row
        return created, duplicates_skipped

    def is_grounded_relation_auto_approvable(
        self,
        session: Session,
        row: ReviewJobRecord,
        source: SourceRecord,
        snapshot_row: DocumentSnapshotRecord,
    ) -> bool:
        if not self.app_settings.auto_approve_grounded_relations:
            return False
        item = self.repository.to_queue_item(row)
        claim = item.claim
        if (
            item.status != "pending"
            or item.conflict_claim_ids
            or not item.entity_id
            or claim.predicate not in RELATION_CLAIM_PREDICATES
            or not claim.subject
            or not claim.object_or_value
        ):
            return False

        def reference_key(value: str | None) -> str:
            return " ".join((value or "").casefold().split())

        document = reference_key(snapshot_row.content_text)
        subject_key = reference_key(claim.subject)
        target_key = reference_key(claim.object_or_value)
        if subject_key not in document or target_key not in document:
            return False

        def contains_anchor(anchor: str) -> bool:
            normalized = reference_key(anchor)
            if normalized.isascii():
                return bool(re.search(rf"\b{re.escape(normalized)}\b", document))
            return normalized in document

        if not any(
            contains_anchor(anchor) for anchor in RELATION_PREDICATE_ANCHORS[claim.predicate]
        ):
            return False

        catalog = self.get_catalog_snapshot(session)
        source_entities = [entity for entity in catalog.entities if entity.id == item.entity_id]
        if len(source_entities) != 1:
            return False
        source_entity = source_entities[0]
        source_references = {
            reference_key(source_entity.id),
            reference_key(source_entity.slug),
            reference_key(source_entity.name.zh),
            reference_key(source_entity.name.en),
            *(reference_key(alias) for alias in source_entity.aliases or []),
        }
        if subject_key not in source_references:
            return False
        targets = [
            entity
            for entity in catalog.entities
            if target_key
            in {
                reference_key(entity.id),
                reference_key(entity.slug),
                reference_key(entity.name.zh),
                reference_key(entity.name.en),
                *(reference_key(alias) for alias in entity.aliases or []),
            }
        ]
        if len(targets) != 1 or targets[0].id == item.entity_id:
            return False
        evidence_items = self.repository.approved_evidence(row)
        return bool(evidence_items) and all(
            evidence.type == "official" and str(evidence.url).rstrip("/") == source.url.rstrip("/")
            for evidence in evidence_items
        )

    def run_automatic_extraction(self, session: Session) -> dict[str, object]:
        limit = self.app_settings.auto_extraction_max_snapshots_per_cycle
        summary: dict[str, object] = {
            "configured": self.extraction.enabled,
            "enabled": self.extraction.enabled and limit > 0,
            "pipelineVersion": EXTRACTION_PIPELINE_VERSION,
            "planned": 0,
            "processed": 0,
            "candidatesCreated": 0,
            "duplicatesSkipped": 0,
            "relationsAutoApproved": 0,
            "failed": 0,
        }
        if not summary["enabled"]:
            return summary
        backfill_plan, backfill_remaining = self.build_relation_backfill_plan(session, limit)
        planned: list[tuple[SourceRecord, DocumentSnapshotRecord, bool]] = [
            (source, snapshot_row, True) for source, snapshot_row in backfill_plan
        ]
        regular_plan = self.build_extraction_plan(
            session,
            limit - len(planned),
            automatic_only=True,
            excluded_snapshot_ids={snapshot_row.id for _, snapshot_row, _ in planned},
        )
        planned.extend((source, snapshot_row, False) for source, snapshot_row in regular_plan)
        if self.app_settings.relation_backfill_batch_id:
            summary["relationBackfillBatchId"] = self.app_settings.relation_backfill_batch_id
            summary["relationBackfillAttemptsRemaining"] = backfill_remaining
        summary["planned"] = len(planned)
        errors: list[dict[str, str]] = []
        backfill_attempts_this_cycle = 0
        principal = Principal(
            subject="automation",
            email="automation@ai-radar.local",
            role="admin",
        )
        for source, snapshot_row, is_relation_backfill in planned:
            audit_context = (
                {"relationBackfillBatchId": self.app_settings.relation_backfill_batch_id}
                if is_relation_backfill
                else {}
            )
            try:
                created, duplicates_skipped = self.create_extraction_candidates(
                    session,
                    source,
                    snapshot_row,
                    self.app_settings.auto_extraction_max_candidates_per_snapshot,
                )
                auto_approved = 0
                for item in created:
                    row = session.get(ReviewJobRecord, item.id)
                    if row and self.is_grounded_relation_auto_approvable(
                        session,
                        row,
                        source,
                        snapshot_row,
                    ):
                        self.decide_review(
                            row.id,
                            ReviewDecision(
                                expected_version=row.version,
                                reason="自动批准：官方原文逐字锚定主客体与关系语义，且实体唯一、零冲突。",
                            ),
                            "approved",
                            principal,
                            session,
                        )
                        auto_approved += 1
                self.audit.record(
                    session,
                    principal,
                    "extraction.run",
                    "document_snapshot",
                    snapshot_row.id,
                    {
                        "automatic": True,
                        "candidatesCreated": len(created),
                        "duplicatesSkipped": duplicates_skipped,
                        "relationsAutoApproved": auto_approved,
                        "pipelineVersion": EXTRACTION_PIPELINE_VERSION,
                        "sourceId": source.id,
                        "providerCall": self.extraction.call_metadata(),
                        **audit_context,
                    },
                )
                session.commit()
                if is_relation_backfill:
                    backfill_attempts_this_cycle += 1
                summary["processed"] = int(summary["processed"]) + 1
                summary["candidatesCreated"] = int(summary["candidatesCreated"]) + len(created)
                summary["duplicatesSkipped"] = (
                    int(summary["duplicatesSkipped"]) + duplicates_skipped
                )
                summary["relationsAutoApproved"] = (
                    int(summary["relationsAutoApproved"]) + auto_approved
                )
            except Exception as error:  # noqa: BLE001 - persist diagnostics and retry later
                session.rollback()
                self.audit.record(
                    session,
                    principal,
                    "extraction.failed",
                    "document_snapshot",
                    snapshot_row.id,
                    {
                        "sourceId": source.id,
                        "error": str(error)[:500],
                        "pipelineVersion": EXTRACTION_PIPELINE_VERSION,
                        "providerCall": self.extraction.call_metadata(),
                        **audit_context,
                    },
                )
                session.commit()
                if is_relation_backfill:
                    backfill_attempts_this_cycle += 1
                summary["failed"] = int(summary["failed"]) + 1
                errors.append({"sourceId": source.id, "error": str(error)[:500]})
                continue
        if errors:
            summary["errors"] = errors
        if self.app_settings.relation_backfill_batch_id:
            summary["relationBackfillAttemptsRemaining"] = max(
                0,
                backfill_remaining - backfill_attempts_this_cycle,
            )
        return summary
