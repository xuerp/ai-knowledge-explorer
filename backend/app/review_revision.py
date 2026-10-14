"""Text corrections create another review candidate; source records stay intact."""

import hashlib
import json
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .database import AuditLogRecord, ReviewJobRecord
from .schemas import CandidateCreate


def create_revision(
    review_id, request, principal, session, repository, quality_gate, audit, snapshot
):
    digest = hashlib.sha256(
        f"{review_id}|{request.expected_version}|{request.idempotency_key}".encode()
    ).hexdigest()
    revision_id = "revision-" + digest
    fingerprint = hashlib.sha256(request.model_dump_json().encode()).hexdigest()

    def existing_revision():
        row = session.get(ReviewJobRecord, revision_id)
        if row is None:
            return None
        entry = session.scalar(
            select(AuditLogRecord).where(
                AuditLogRecord.action == "review.revision", AuditLogRecord.target_id == revision_id
            )
        )
        if entry is None or json.loads(entry.detail_json).get("requestFingerprint") != fingerprint:
            raise HTTPException(409, "This revision key was already used for different content.")
        return repository.to_queue_item(row)

    existing = existing_revision()
    if existing:
        return existing
    source = session.get(ReviewJobRecord, review_id)
    if source is None:
        raise HTTPException(404, "Review job not found.")
    if source.version != request.expected_version:
        raise HTTPException(409, "The original review changed; refresh before revising.")
    original = repository.to_queue_item(source)
    zh, en, reason = request.text_zh.strip(), request.text_en.strip(), request.reason.strip()
    if not zh or not en or len(reason) < 3:
        raise HTTPException(422, "Both languages and a revision reason are required.")
    if zh == original.claim.text.zh.strip() and en == original.claim.text.en.strip():
        raise HTTPException(422, "Revise the claim text before creating another candidate.")
    if not original.evidence_items:
        raise HTTPException(422, "The original review has no source evidence to preserve.")
    claim_id = "revision-claim-" + digest
    source_ids = {item.id for item in original.evidence_items}
    if not set(original.claim.source_ids) <= source_ids:
        raise HTTPException(422, "The original review has unresolved source evidence.")
    evidence = [
        item.model_copy(
            update={
                "id": f"revision-evidence-{digest}-{index}",
                "supports_claim_ids": [
                    claim_id if key == original.claim.id else key for key in item.supports_claim_ids
                ]
                if item.supports_claim_ids is not None
                else None,
                "verified_at": None,
            },
            deep=True,
        )
        for index, item in enumerate(original.evidence_items)
    ]
    evidence_map = {
        old.id: new.id for old, new in zip(original.evidence_items, evidence, strict=True)
    }
    claim = original.claim.model_copy(
        update={
            "id": claim_id,
            "confidence": "unverified",
            "text": original.claim.text.model_copy(update={"zh": zh, "en": en}, deep=True),
            "source_ids": [evidence_map[key] for key in original.claim.source_ids],
        },
        deep=True,
    )
    payload = CandidateCreate(
        id=revision_id, entity_id=original.entity_id, claim=claim, evidence=evidence
    )
    assessment = quality_gate.assess(payload, snapshot)
    row = ReviewJobRecord(
        id=revision_id,
        entity_id=original.entity_id,
        claim_id=claim_id,
        claim_json=claim.model_dump_json(by_alias=True),
        evidence_ids_json=json.dumps(claim.source_ids),
        evidence_json=json.dumps(
            [item.model_dump(mode="json", by_alias=True) for item in evidence], ensure_ascii=False
        ),
        conflict_ids_json=json.dumps(assessment.conflicting_claim_ids),
        status=assessment.queue_status,
        created_at=datetime.now(UTC),
        version=1,
        review_reason=reason,
    )
    session.add(row)
    audit.record(
        session,
        principal,
        "review.revision",
        "review_job",
        revision_id,
        {
            "sourceReviewId": source.id,
            "sourceClaimId": source.claim_id,
            "sourceVersion": source.version,
            "claimId": claim_id,
            "reason": reason,
            "requestFingerprint": fingerprint,
            "sourceEvidenceIds": original.evidence_ids,
        },
    )
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        existing = existing_revision()
        if existing:
            return existing
        raise
    session.refresh(row)
    return repository.to_queue_item(row)
