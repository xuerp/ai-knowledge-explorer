from __future__ import annotations

from dataclasses import dataclass

from .schemas import (
    CandidateAssessment,
    CandidateCreate,
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

    def report(self, snapshot: KnowledgeSnapshot) -> DataQualityReport:
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
            and degrees[entity.id] < 5
        ]
        issues: list[str] = []
        if len(snapshot.entities) < 40:
            issues.append("Formal acceptance requires at least 40 reviewed entities.")
        if len(snapshot.claims) < 150:
            issues.append("Formal acceptance requires at least 150 reviewed claims.")
        if core_entities_below_five:
            issues.append("Every core entity requires at least five explainable relations.")
        if claims_with_missing_evidence:
            issues.append("Every published claim must resolve all evidence references.")
        if relations_with_missing_evidence:
            issues.append("Every verified relation must resolve all evidence references.")
        if timeline_entries_with_missing_evidence:
            issues.append("Every verified timeline entry must resolve all evidence references.")
        return DataQualityReport(
            entity_count=len(snapshot.entities),
            claim_count=len(snapshot.claims),
            evidence_count=len(snapshot.evidence),
            relation_count=len(snapshot.graph.edges),
            core_entities_below_five_relations=core_entities_below_five,
            claims_with_missing_evidence=claims_with_missing_evidence,
            relations_with_missing_evidence=relations_with_missing_evidence,
            timeline_entries_with_missing_evidence=timeline_entries_with_missing_evidence,
            live_ready=not issues,
            issues=issues,
        )
