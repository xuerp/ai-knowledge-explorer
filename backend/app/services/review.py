import json
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..application_rules import review_decision_note, review_item_has_anchored_excerpt
from ..auth import Principal
from ..database import (
    KnowledgeEntityRecord,
    PublicationRecordRow,
    ReviewJobRecord,
)
from ..quality import (
    claim_semantic_fingerprint,
)
from ..repository import OPEN_REVIEW_STATUSES, RELATION_PREDICATES
from ..schemas import (
    Claim,
    GraphEdge,
    KnowledgeSnapshot,
    RelationClaimAuditItem,
    ReviewDecision,
    ReviewInventoryReport,
    ReviewLifecycleDecision,
    ReviewQueueItem,
)


class ReviewServices:
    def require_publishable_entity(self, row: ReviewJobRecord, session: Session) -> None:
        if not row.entity_id or session.get(KnowledgeEntityRecord, row.entity_id) is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="A claim cannot be published without one valid knowledge entity.",
            )

    def approved_relation_rows(
        self,
        session: Session,
        claim_ids: list[str] | None = None,
    ) -> list[ReviewJobRecord]:
        statement = select(ReviewJobRecord).where(
            ReviewJobRecord.status == "approved",
            ReviewJobRecord.publication_action != "merged-evidence",
        )
        if claim_ids:
            statement = statement.where(ReviewJobRecord.claim_id.in_(claim_ids))
        rows = session.scalars(
            statement.order_by(ReviewJobRecord.created_at, ReviewJobRecord.id).limit(500)
        ).all()
        relation_rows: list[ReviewJobRecord] = []
        for row in rows:
            try:
                claim = Claim.model_validate_json(row.claim_json)
            except (ValueError, TypeError, json.JSONDecodeError):
                if claim_ids:
                    relation_rows.append(row)
                continue
            predicate_key = " ".join((claim.predicate or "").casefold().split())
            if predicate_key in RELATION_PREDICATES:
                relation_rows.append(row)
        return relation_rows

    def assess_historical_relation_claim(
        self,
        session: Session,
        row: ReviewJobRecord,
        snapshot: KnowledgeSnapshot,
    ) -> tuple[RelationClaimAuditItem, GraphEdge | None]:
        try:
            claim = Claim.model_validate_json(row.claim_json)
        except (ValueError, TypeError, json.JSONDecodeError):
            return (
                RelationClaimAuditItem(
                    review_job_id=row.id,
                    claim_id=row.claim_id,
                    source_entity_id=row.entity_id,
                    status="invalid",
                    reason="Claim 结构无效，必须先人工修复原始记录。",
                ),
                None,
            )

        predicate_key = " ".join((claim.predicate or "").casefold().split())
        relation_kind = RELATION_PREDICATES.get(predicate_key)
        if relation_kind is None:
            return (
                RelationClaimAuditItem(
                    review_job_id=row.id,
                    claim_id=row.claim_id,
                    source_entity_id=row.entity_id,
                    predicate=claim.predicate,
                    target_reference=claim.object_or_value,
                    status="invalid",
                    reason="该 Claim 不是受支持的关系谓词。",
                ),
                None,
            )

        entity_ids = {entity.id for entity in snapshot.entities}
        if row.entity_id not in entity_ids:
            return (
                RelationClaimAuditItem(
                    review_job_id=row.id,
                    claim_id=row.claim_id,
                    source_entity_id=row.entity_id,
                    predicate=claim.predicate,
                    target_reference=claim.object_or_value,
                    relation_kind=relation_kind,
                    status="review-required",
                    reason="关系 Claim 缺少合法源实体，必须先完成实体关联修复。",
                ),
                None,
            )

        proposed = self.repository.relation_from_approved_claim(session, row, snapshot)
        if proposed is None:
            return (
                RelationClaimAuditItem(
                    review_job_id=row.id,
                    claim_id=row.claim_id,
                    source_entity_id=row.entity_id,
                    predicate=claim.predicate,
                    target_reference=claim.object_or_value,
                    relation_kind=relation_kind,
                    status="review-required",
                    reason="关系目标未唯一解析到现有实体，不能自动生成图谱边。",
                ),
                None,
            )

        target_entity_id = proposed.to_id if proposed.from_id == row.entity_id else proposed.from_id
        existing = next((edge for edge in snapshot.graph.edges if edge.id == proposed.id), None)
        if existing is None:
            status_value: Literal["repairable", "linked"] = "repairable"
            reason = "已审核关系 Claim 可唯一解析，图谱中尚无对应关系，可以确定性补建。"
        elif existing.confidence != proposed.confidence or set(existing.source_ids) != set(
            proposed.source_ids
        ):
            status_value = "repairable"
            reason = "图谱关系已存在，但需要确定性合并该 Claim 的 Evidence。"
        else:
            status_value = "linked"
            reason = "关系 Claim 已完整发布到图谱，无需修复。"
        return (
            RelationClaimAuditItem(
                review_job_id=row.id,
                claim_id=row.claim_id,
                source_entity_id=row.entity_id,
                predicate=claim.predicate,
                target_reference=claim.object_or_value,
                proposed_target_entity_id=target_entity_id,
                relation_id=proposed.id,
                relation_kind=proposed.kind,
                status=status_value,
                reason=reason,
            ),
            proposed,
        )

    def decide_review(
        self,
        review_id: str,
        decision: ReviewDecision,
        action: Literal["approved", "rejected"],
        actor: Principal,
        session: Session,
        *,
        commit: bool = True,
        batch_safe_only: bool = False,
    ) -> ReviewQueueItem:
        row = session.scalar(
            select(ReviewJobRecord).where(ReviewJobRecord.id == review_id).with_for_update()
        )
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Review job not found."
            )
        if row.status not in OPEN_REVIEW_STATUSES:
            if row.status == action:
                return self.repository.to_queue_item(row)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Review job is already {row.status}.",
            )
        queue_item = self.repository.to_queue_item(row)

        if batch_safe_only and (
            row.status != "pending"
            or json.loads(row.conflict_ids_json or "[]")
            or not review_item_has_anchored_excerpt(queue_item)
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=("Review job requires an anchored source excerpt and individual review."),
            )
        if row.version != decision.expected_version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Review job version is {row.version}; refresh before deciding.",
            )
        if action == "approved" and not queue_item.evidence_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="A claim cannot be published without evidence.",
            )
        if action == "approved":
            self.require_publishable_entity(row, session)
        if action == "rejected" and decision.reason_category is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="A rejection reason category is required.",
            )
        note = review_decision_note(decision)
        reviewed_at = datetime.now(UTC)
        claimed = session.execute(
            update(ReviewJobRecord)
            .where(
                ReviewJobRecord.id == review_id,
                ReviewJobRecord.status.in_(OPEN_REVIEW_STATUSES),
                ReviewJobRecord.version == decision.expected_version,
            )
            .values(
                status=action,
                reason_category=(decision.reason_category if action == "rejected" else None),
                review_reason=note,
                reviewed_at=reviewed_at,
                reviewed_by=actor.email,
                version=ReviewJobRecord.version + 1,
            )
        )
        if claimed.rowcount != 1:
            session.expire(row)
            session.refresh(row)
            if row.status == action:
                return self.repository.to_queue_item(row)
            if row.status not in OPEN_REVIEW_STATUSES:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Review job is already {row.status}.",
                )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Review job version is {row.version}; refresh before deciding.",
            )
        session.expire(row)
        session.refresh(row)
        published_relation = None
        if action == "approved":
            self.repository.persist_approved_verification(row)
            queue_item = self.repository.to_queue_item(row)
            published_relation = self.repository.relation_from_approved_claim(session, row)
            if published_relation:
                self.repository.upsert_relation(session, published_relation)
            session.add(
                PublicationRecordRow(
                    review_job_id=row.id,
                    claim_id=row.claim_id,
                    published_at=row.reviewed_at,
                    actor=actor.email,
                )
            )
            notifications_created = self.engagement.notify_followers(
                session,
                row.entity_id,
                row.claim_id,
                queue_item.claim.text.zh,
            )
        else:
            notifications_created = 0
        self.audit.record(
            session,
            actor,
            f"review.{action}",
            "review_job",
            row.id,
            {
                "claimId": row.claim_id,
                "reason": note,
                "reasonCategory": row.reason_category,
                "reasonNote": note,
                "notificationsCreated": notifications_created,
                "relationId": published_relation.id if published_relation else None,
            },
        )
        if commit:
            session.commit()
        return self.repository.to_queue_item(row)

    def decide_claim_lifecycle(
        self,
        review_id: str,
        decision: ReviewLifecycleDecision,
        publication_action: Literal["merged-evidence", "superseding"],
        actor: Principal,
        session: Session,
        *,
        commit: bool = True,
    ) -> ReviewQueueItem:
        row = session.scalar(
            select(ReviewJobRecord).where(ReviewJobRecord.id == review_id).with_for_update()
        )
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Review job not found.",
            )
        if row.decision_idempotency_key:
            if (
                row.decision_idempotency_key == decision.idempotency_key
                and row.publication_action == publication_action
                and row.target_claim_id == decision.target_claim_id
            ):
                return self.repository.to_queue_item(row)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Review job already has a different lifecycle decision.",
            )
        if row.status not in OPEN_REVIEW_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Review job is already {row.status}.",
            )
        if row.version != decision.expected_version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Review job version is {row.version}; refresh before deciding.",
            )
        queue_item = self.repository.to_queue_item(row)
        self.require_publishable_entity(row, session)
        if not queue_item.evidence_items:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="A claim cannot be published without evidence.",
            )

        key_owner = session.scalar(
            select(ReviewJobRecord).where(
                ReviewJobRecord.decision_idempotency_key == decision.idempotency_key
            )
        )
        if key_owner is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Idempotency key is already used by another review decision.",
            )
        target = session.scalars(
            select(ReviewJobRecord)
            .where(
                ReviewJobRecord.claim_id == decision.target_claim_id,
                ReviewJobRecord.status == "approved",
                ReviewJobRecord.lifecycle_status == "current",
                ReviewJobRecord.publication_action != "merged-evidence",
            )
            .order_by(ReviewJobRecord.created_at.desc())
            .with_for_update()
        ).first()
        if target is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Current approved target claim not found.",
            )
        if target.id == row.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A review job cannot target itself.",
            )
        if target.version != decision.expected_target_version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Target claim version is {target.version}; refresh before deciding.",
            )

        candidate_claim = queue_item.claim
        target_claim = self.repository.approved_claim(target)
        candidate_subject = " ".join((candidate_claim.subject or "").casefold().split())
        target_subject = " ".join((target_claim.subject or "").casefold().split())
        candidate_predicate = " ".join((candidate_claim.predicate or "").casefold().split())
        target_predicate = " ".join((target_claim.predicate or "").casefold().split())
        # A reviewed correction can qualify the same number (for example adding
        # benchmark conditions). IDs, evidence additions and collection times alone
        # do not constitute a replacement; identical facts should merge evidence.
        content_changed = (
            any(
                " ".join((incoming or "").split()) != " ".join((previous or "").split())
                for incoming, previous in (
                    (candidate_claim.text.zh, target_claim.text.zh),
                    (candidate_claim.text.en, target_claim.text.en),
                )
            )
            or candidate_claim.text.technical != target_claim.text.technical
        )
        value_changed = candidate_claim.object_or_value != target_claim.object_or_value
        validity_changed = (
            candidate_claim.valid_from != target_claim.valid_from
            or candidate_claim.valid_to != target_claim.valid_to
        )
        if publication_action == "merged-evidence":
            if claim_semantic_fingerprint(
                candidate_claim, row.entity_id
            ) != claim_semantic_fingerprint(target_claim, target.entity_id):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Evidence can only be merged into the same semantic claim.",
                )
        elif (
            row.entity_id != target.entity_id
            or not candidate_subject
            or candidate_subject != target_subject
            or not candidate_predicate
            or candidate_predicate != target_predicate
            or not (value_changed or content_changed or validity_changed)
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A superseding claim must revise the value, content or validity of the same entity fact.",
            )

        now = datetime.now(UTC)
        row.status = "approved"
        row.reason_category = None
        row.review_reason = review_decision_note(decision)
        row.reviewed_at = now
        row.reviewed_by = actor.email
        row.version += 1
        row.publication_action = publication_action
        row.target_review_job_id = target.id
        row.target_claim_id = target.claim_id
        row.decision_idempotency_key = decision.idempotency_key

        notifications_created = 0
        published_relation = None
        if publication_action == "merged-evidence":
            row.lifecycle_status = "historical"
            incoming_evidence = [
                evidence.model_copy(
                    update={
                        "supports_claim_ids": list(
                            dict.fromkeys([*(evidence.supports_claim_ids or []), target.claim_id])
                        )
                    }
                )
                for evidence in queue_item.evidence_items
            ]
            row.evidence_json = json.dumps(
                [item.model_dump(mode="json", by_alias=True) for item in incoming_evidence],
                ensure_ascii=False,
            )
            existing_evidence = self.repository.approved_evidence(target)
            evidence_by_id = {item.id: item for item in existing_evidence}
            evidence_by_id.update({item.id: item for item in incoming_evidence})
            merged_evidence = list(evidence_by_id.values())
            merged_claim = target_claim.model_copy(
                update={
                    "source_ids": list(
                        dict.fromkeys(
                            [
                                *target_claim.source_ids,
                                *(item.id for item in incoming_evidence),
                            ]
                        )
                    )
                }
            )
            target.reviewed_at = now
            target.reviewed_by = actor.email
            target.version += 1
            target.claim_json = merged_claim.model_dump_json(by_alias=True)
            target.evidence_ids_json = json.dumps(merged_claim.source_ids, ensure_ascii=False)
            target.evidence_json = json.dumps(
                [item.model_dump(mode="json", by_alias=True) for item in merged_evidence],
                ensure_ascii=False,
            )
            self.repository.persist_approved_verification(target)
        else:
            row.lifecycle_status = "current"
            target.lifecycle_status = "superseded"
            target.superseded_by_claim_id = row.claim_id
            target.reviewed_at = now
            target.reviewed_by = actor.email
            target.version += 1
            # Publication replacement is separate from a fact's effective period.
            # Clarifying a historical score does not make it expire on review day.
            if value_changed and candidate_claim.valid_from:
                target_claim = target_claim.model_copy(
                    update={"valid_to": candidate_claim.valid_from}
                )
            target.claim_json = target_claim.model_dump_json(by_alias=True)
            self.repository.persist_approved_verification(target)
            self.repository.persist_approved_verification(row)
            published_relation = self.repository.relation_from_approved_claim(session, row)
            if published_relation:
                self.repository.upsert_relation(session, published_relation)
            session.add(
                PublicationRecordRow(
                    review_job_id=row.id,
                    claim_id=row.claim_id,
                    published_at=now,
                    actor=actor.email,
                )
            )
            notifications_created = self.engagement.notify_followers(
                session,
                row.entity_id,
                row.claim_id,
                self.repository.approved_claim(row).text.zh,
            )

        self.audit.record(
            session,
            actor,
            f"review.{publication_action.replace('-', '_')}",
            "review_job",
            row.id,
            {
                "claimId": row.claim_id,
                "targetClaimId": target.claim_id,
                "reason": row.review_reason,
                "reasonNote": row.review_reason,
                "notificationsCreated": notifications_created,
                "relationId": published_relation.id if published_relation else None,
            },
        )
        if commit:
            try:
                session.commit()
            except IntegrityError as error:
                session.rollback()
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Lifecycle decision conflicts with a concurrent request.",
                ) from error
        else:
            session.flush()
        return self.repository.to_queue_item(row)

    def review_queue_inventory(
        self,
        _: Principal,
        session: Session,
    ) -> ReviewInventoryReport:
        open_items = self.repository.queue(session, scope="open", limit=500)
        published_rows = session.scalars(
            select(ReviewJobRecord).where(
                ReviewJobRecord.status == "approved",
                ReviewJobRecord.lifecycle_status == "current",
                ReviewJobRecord.publication_action != "merged-evidence",
            )
        ).all()
        published_fingerprints = {
            claim_semantic_fingerprint(self.repository.approved_claim(row), row.entity_id)
            for row in published_rows
        }
        by_entity: dict[str, int] = {}
        by_source: dict[str, int] = {}
        by_month: dict[str, int] = {}
        risk_counts = {"standard": 0, "high": 0}
        fingerprints: dict[tuple[str, str, str, str, str], int] = {}
        update_values: dict[tuple[str, str, str], set[str]] = {}
        conflict_items = 0
        missing_evidence_items = 0
        invalid_anchor_items = 0
        stale_items = 0
        duplicate_with_published_items = 0
        now = datetime.now(UTC)
        high_risk_predicates = {
            "price",
            "pricing",
            "availability",
            "context-window",
            "benchmark",
            "released-at",
            "deprecated-at",
        }

        for item in open_items:
            entity_key = item.entity_id or "未解析实体"
            by_entity[entity_key] = by_entity.get(entity_key, 0) + 1
            month = item.created_at[:7]
            by_month[month] = by_month.get(month, 0) + 1
            publishers = {evidence.publisher for evidence in item.evidence_items} or {"缺少信源"}
            for publisher in publishers:
                by_source[publisher] = by_source.get(publisher, 0) + 1

            predicate = " ".join((item.claim.predicate or "").casefold().split())
            subject = " ".join((item.claim.subject or "").casefold().split())
            value = " ".join((item.claim.object_or_value or "").casefold().split())
            high_risk = bool(
                item.conflict_claim_ids
                or predicate in high_risk_predicates
                or any(evidence.type == "community" for evidence in item.evidence_items)
            )
            risk_counts["high" if high_risk else "standard"] += 1
            conflict_items += int(bool(item.conflict_claim_ids))
            missing_evidence_items += int(not item.evidence_items)
            anchored = bool(
                subject
                and value
                and any(
                    subject in " ".join((evidence.source_excerpt or "").casefold().split())
                    and value in " ".join((evidence.source_excerpt or "").casefold().split())
                    for evidence in item.evidence_items
                )
            )
            invalid_anchor_items += int(not anchored)
            try:
                created_at = datetime.fromisoformat(item.created_at)
                if created_at.tzinfo is None:
                    created_at = created_at.replace(tzinfo=UTC)
                stale_items += int(now - created_at.astimezone(UTC) > timedelta(days=90))
            except ValueError:
                stale_items += 1

            fingerprint = claim_semantic_fingerprint(item.claim, item.entity_id)
            fingerprints[fingerprint] = fingerprints.get(fingerprint, 0) + 1
            duplicate_with_published_items += int(fingerprint in published_fingerprints)
            update_key = (entity_key.casefold(), subject, predicate)
            update_values.setdefault(update_key, set()).add(value)

        return ReviewInventoryReport(
            generated_at=now.isoformat(),
            open_total=len(open_items),
            by_entity=dict(sorted(by_entity.items(), key=lambda pair: (-pair[1], pair[0]))),
            by_source=dict(sorted(by_source.items(), key=lambda pair: (-pair[1], pair[0]))),
            by_month=dict(sorted(by_month.items())),
            risk_counts=risk_counts,
            deterministic_duplicate_groups=sum(count > 1 for count in fingerprints.values()),
            possible_update_groups=sum(len(values) > 1 for values in update_values.values()),
            conflict_items=conflict_items,
            missing_evidence_items=missing_evidence_items,
            invalid_anchor_items=invalid_anchor_items,
            stale_items=stale_items,
            duplicate_with_published_items=duplicate_with_published_items,
        )
