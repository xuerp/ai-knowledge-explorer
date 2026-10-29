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
        if after.source_ids != before.source_ids:
            raise ValueError("A correction cannot silently replace the reviewed evidence.")
        claims[before.id] = after
    snapshot.claims = [claims[item.id] for item in snapshot.claims]
