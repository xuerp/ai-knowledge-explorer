from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

from .schemas import (
    CandidateAssessment,
    CandidateCreate,
    Claim,
    DataQualityReport,
    Entity,
    KnowledgeSnapshot,
)


def _key(value: str | None) -> str:
    return " ".join((value or "").casefold().split())


def _periods_overlap(
    left_start: str | None,
    left_end: str | None,
    right_start: str | None,
    right_end: str | None,
) -> bool:
    return (not left_end or not right_start or left_end >= right_start) and (
        not right_end or not left_start or right_end >= left_start
    )


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _ratio(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


FORMAL_CLAIM_REQUIREMENT = 150
CORE_ENTITY_RELATION_REQUIREMENT = 5


def claim_semantic_fingerprint(
    claim: Claim,
    entity_id: str | None = None,
    object_entity_id: str | None = None,
) -> tuple[str, str, str, str, str]:
    return relation_semantic_fingerprint(
        entity_id or claim.entity_id or claim.subject or "",
        claim.predicate,
        object_entity_id or claim.object_or_value or "",
        claim.valid_from or "",
        claim.valid_to or "",
    )


def relation_semantic_fingerprint(
    from_id: str,
    kind: str,
    to_id: str,
    valid_from: str = "",
    valid_to: str = "",
) -> tuple[str, str, str, str, str]:
    from_key = _key(from_id)
    kind_key = _key(kind)
    to_key = _key(to_id)
    if kind_key == "competes-with":
        from_key, to_key = sorted((from_key, to_key))
    return from_key, kind_key, to_key, valid_from, valid_to


def resolve_unique_entity_reference(
    value: str | None,
    entities: list[Entity],
) -> str | None:
    reference = _key(value)
    if not reference:
        return None
    matches = [
        entity.id
        for entity in entities
        if reference
        in {
            _key(entity.id),
            _key(entity.slug),
            _key(entity.name.zh),
            _key(entity.name.en),
            *(_key(alias) for alias in entity.aliases or []),
        }
    ]
    return matches[0] if len(matches) == 1 else None


@dataclass(slots=True)
class KnowledgeQualityGate:
    def _resolve_entity(
        self,
        candidate: CandidateCreate,
        entities: list[Entity],
    ) -> tuple[str | None, str]:
        if candidate.entity_id:
            if any(entity.id == candidate.entity_id for entity in entities):
                return candidate.entity_id, "resolved"
            return None, "unresolved"
        subject = _key(candidate.claim.subject)
        if not subject:
            return None, "unresolved"
        matches = [
            entity.id
            for entity in entities
            if subject
            in {
                _key(entity.id),
                _key(entity.slug),
                _key(entity.name.zh),
                _key(entity.name.en),
                *(_key(alias) for alias in entity.aliases or []),
            }
        ]
        if len(matches) == 1:
            return matches[0], "resolved"
        return None, "ambiguous" if matches else "unresolved"

    def assess(
        self,
        candidate: CandidateCreate,
        snapshot: KnowledgeSnapshot,
    ) -> CandidateAssessment:
        resolved_entity_id, resolution = self._resolve_entity(candidate, snapshot.entities)
        claim = candidate.claim
        subject = _key(claim.subject)
        predicate = _key(claim.predicate)
        value = _key(claim.object_or_value)
        conflicts: list[str] = []
        if subject and predicate and value:
            for existing in snapshot.claims:
                if (
                    existing.id != claim.id
                    and _key(existing.subject) == subject
                    and _key(existing.predicate) == predicate
                    and _key(existing.object_or_value)
                    and _key(existing.object_or_value) != value
                    and _periods_overlap(
                        claim.valid_from,
                        claim.valid_to,
                        existing.valid_from,
                        existing.valid_to,
                    )
                ):
                    conflicts.append(existing.id)
        queue_status = (
            "needs-more-evidence" if conflicts or resolution == "ambiguous" else "pending"
        )
        return CandidateAssessment(
            resolved_entity_id=resolved_entity_id,
            resolution=resolution,
            conflicting_claim_ids=conflicts,
            queue_status=queue_status,
        )

    def report(
        self,
        snapshot: KnowledgeSnapshot,
        *,
        now: datetime | None = None,
    ) -> DataQualityReport:
        current = (now or datetime.now(UTC)).astimezone(UTC)
        evidence_ids = {item.id for item in snapshot.evidence}
        claims_with_missing_evidence = [
            claim.id
            for claim in snapshot.claims
            if not claim.source_ids or not set(claim.source_ids).issubset(evidence_ids)
        ]
        relations_with_missing_evidence = [
            edge.id
            for edge in snapshot.graph.edges
            if edge.confidence == "verified"
            and (not edge.source_ids or not set(edge.source_ids).issubset(evidence_ids))
        ]
        timeline_entries_with_missing_evidence = [
            entry.id
            for entries in snapshot.timeline.values()
            for entry in entries
            if entry.confidence == "verified"
            and (not entry.source_ids or not set(entry.source_ids).issubset(evidence_ids))
        ]
        timeline_entries = [entry for entries in snapshot.timeline.values() for entry in entries]
        all_reference_sets = (
            [claim.source_ids for claim in snapshot.claims]
            + [edge.source_ids for edge in snapshot.graph.edges]
            + [entry.source_ids for entry in timeline_entries]
        )
        resolved_reference_sets = sum(
            bool(source_ids) and set(source_ids).issubset(evidence_ids)
            for source_ids in all_reference_sets
        )
        official_evidence_count = sum(item.type == "official" for item in snapshot.evidence)
        reviewed_evidence_count = sum(bool(item.verified_at) for item in snapshot.evidence)
        freshness_cutoff = current - timedelta(days=180)
        fresh_evidence_count = sum(
            bool(collected_at := _parse_date(item.collected_at))
            and collected_at >= freshness_cutoff
            for item in snapshot.evidence
        )
        evidence_domains = {
            host
            for item in snapshot.evidence
            if (host := (urlparse(item.url).hostname or "").casefold())
        }
        content_items = [*snapshot.claims, *snapshot.graph.edges, *timeline_entries]
        verified_content_count = sum(item.confidence == "verified" for item in content_items)
        conflict_content_count = sum(item.confidence == "conflict" for item in content_items)
        evidence_reference_coverage = _ratio(resolved_reference_sets, len(all_reference_sets))
        official_evidence_ratio = _ratio(official_evidence_count, len(snapshot.evidence))
        reviewed_evidence_ratio = _ratio(reviewed_evidence_count, len(snapshot.evidence))
        fresh_evidence_ratio = _ratio(fresh_evidence_count, len(snapshot.evidence))
        verified_content_ratio = _ratio(verified_content_count, len(content_items))
        degrees = {entity.id: 0 for entity in snapshot.entities}
        for edge in snapshot.graph.edges:
            if edge.from_id in degrees:
                degrees[edge.from_id] += 1
            if edge.to_id in degrees:
                degrees[edge.to_id] += 1
        # A concrete model version inherits its family context.  The acceptance
        # threshold applies to navigable model families plus standalone Agent /
        # framework objects; requiring every historical version to have five
        # links would make an otherwise complete catalogue fail by design.
        core_entities_below_five = [
            entity.id
            for entity in snapshot.entities
            if (
                (entity.type == "model" and entity.family_id is None)
                or entity.type in {"agent", "framework"}
            )
            and degrees[entity.id] < CORE_ENTITY_RELATION_REQUIREMENT
        ]
        issues: list[str] = []
        if len(snapshot.entities) < 40:
            issues.append("Formal acceptance requires at least 40 reviewed entities.")
        if len(snapshot.claims) < FORMAL_CLAIM_REQUIREMENT:
            issues.append(
                f"Formal acceptance requires at least {FORMAL_CLAIM_REQUIREMENT} reviewed claims."
            )
        if core_entities_below_five:
            issues.append("Every core entity requires at least five explainable relations.")
        if claims_with_missing_evidence:
            issues.append("Every published claim must resolve all evidence references.")
        if relations_with_missing_evidence:
            issues.append("Every verified relation must resolve all evidence references.")
        if timeline_entries_with_missing_evidence:
            issues.append("Every verified timeline entry must resolve all evidence references.")
        if evidence_reference_coverage < 0.98:
            issues.append("At least 98% of published content must resolve evidence references.")
        if official_evidence_ratio < 0.6:
            issues.append("At least 60% of evidence must come from official first-party sources.")
        if reviewed_evidence_ratio < 0.9:
            issues.append("At least 90% of evidence must record a completed human verification.")
        if fresh_evidence_ratio < 0.8:
            issues.append("At least 80% of evidence must have been collected within 180 days.")
        if len(evidence_domains) < 8:
            issues.append("Formal acceptance requires evidence from at least eight source domains.")
        if verified_content_ratio < 0.8:
            issues.append(
                "At least 80% of claims, relations, and timeline entries must be verified."
            )
        if conflict_content_count:
            issues.append("Published conflict records must be resolved before live acceptance.")
        return DataQualityReport(
            entity_count=len(snapshot.entities),
            claim_count=len(snapshot.claims),
            evidence_count=len(snapshot.evidence),
            relation_count=len(snapshot.graph.edges),
            timeline_entry_count=len(timeline_entries),
            official_evidence_count=official_evidence_count,
            reviewed_evidence_count=reviewed_evidence_count,
            fresh_evidence_count=fresh_evidence_count,
            evidence_domain_count=len(evidence_domains),
            verified_content_count=verified_content_count,
            conflict_content_count=conflict_content_count,
            evidence_reference_coverage=evidence_reference_coverage,
            official_evidence_ratio=official_evidence_ratio,
            reviewed_evidence_ratio=reviewed_evidence_ratio,
            fresh_evidence_ratio=fresh_evidence_ratio,
            verified_content_ratio=verified_content_ratio,
            claims_required=FORMAL_CLAIM_REQUIREMENT,
            claims_remaining=max(0, FORMAL_CLAIM_REQUIREMENT - len(snapshot.claims)),
            core_entities_below_five_relations=core_entities_below_five,
            core_entity_relation_counts={
                entity_id: degrees[entity_id] for entity_id in core_entities_below_five
            },
            core_entity_relation_labels={
                entity.id: entity.name
                for entity in snapshot.entities
                if entity.id in core_entities_below_five
            },
            core_relation_deficit=sum(
                CORE_ENTITY_RELATION_REQUIREMENT - degrees[entity_id]
                for entity_id in core_entities_below_five
            ),
            claims_with_missing_evidence=claims_with_missing_evidence,
            relations_with_missing_evidence=relations_with_missing_evidence,
            timeline_entries_with_missing_evidence=timeline_entries_with_missing_evidence,
            live_ready=not issues,
            issues=issues,
        )
