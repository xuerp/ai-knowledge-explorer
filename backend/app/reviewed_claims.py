"""Versioned source-reviewed corrections for previously published imported claims.

The original review job stays available as history. A correction applies only
to the exact reviewed claim and evidence; later administrator edits win.
"""

import json
from pathlib import Path

from .schemas import Claim, Evidence, KnowledgeSnapshot


def apply_reviewed_claims(snapshot: KnowledgeSnapshot, path: Path) -> None:
    if not path.is_file():
        return
    corrections = json.loads(path.read_text(encoding="utf-8"))["corrections"]
    claims = {item.id: item for item in snapshot.claims}
    evidence = {item.id: item for item in snapshot.evidence}
    entities = {item.id for item in snapshot.entities}
    for row in corrections:
        before = Claim.model_validate(row["expectedClaim"])
        after = Claim.model_validate(row["correctedClaim"])
        expected_sources = [Evidence.model_validate(item) for item in row["expectedEvidence"]]
        if claims.get(before.id) != before:
            continue
        if any(evidence.get(item.id) != item for item in expected_sources):
            continue
        if before.id != after.id or after.entity_id not in entities:
            raise ValueError(
                "A reviewed correction must retain its claim ID and resolve its entity."
            )
        # A newly cited document is allowed only when its complete reviewed
        # before-state is guarded too. Existing citations remain as history.
        guarded_ids = {item.id for item in expected_sources}
        if not set(before.source_ids) <= set(after.source_ids):
            raise ValueError("A correction cannot remove the reviewed evidence.")
        if not set(after.source_ids) <= guarded_ids:
            raise ValueError("Every corrected citation must have an exact evidence guard.")
        corrected_sources = [
            Evidence.model_validate(item) for item in row.get("correctedEvidence", [])
        ]
        for item in corrected_sources:
            original = next((source for source in expected_sources if source.id == item.id), None)
            if original is None or item.url != original.url:
                raise ValueError("Evidence metadata corrections must retain a guarded ID and URL.")
        for item in corrected_sources:
            evidence[item.id] = item
        claims[before.id] = after
    snapshot.claims = [claims[item.id] for item in snapshot.claims]
    snapshot.evidence = [evidence[item.id] for item in snapshot.evidence]
