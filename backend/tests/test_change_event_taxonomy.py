"""A cited shutdown is not an access opening; classification is evidence-scoped."""

from pathlib import Path

import pytest

from app.catalog_changes import catalog_changes
from app.repository import KnowledgeRepository

DATA = Path(__file__).resolve().parents[1] / "data"


def test_all_reviewed_events_agree_with_their_supporting_fact_types():
    snapshot = KnowledgeRepository(DATA / "demo_snapshot.json").load_seed()
    claims = {c.id: c for c in snapshot.claims}
    sources = {s.id: s for s in snapshot.evidence}
    shutdowns = []
    for event in catalog_changes(snapshot):
        if event.kind == "new":
            continue
        supporting = [
            claims[key]
            for source_id in event.source_ids
            for key in sources[source_id].supports_claim_ids
            if key in claims
            and claims[key].entity_id == event.entity_id
            and claims[key].valid_from == event.date
        ]
        if any(
            c.predicate in {"api-shutdown-record", "named-snapshot-api-shutdown"}
            for c in supporting
        ):
            shutdowns.append(event)
            assert event.kind == "deprecated", event.id
    assert len(shutdowns) == 6


@pytest.mark.parametrize("mutant", ["event-kind", "claim-kind"])
def test_inconsistent_declared_event_or_claim_kind_cannot_enter_the_feed(mutant):
    snapshot = KnowledgeRepository(DATA / "demo_snapshot.json").load_seed()
    original = next(e for e in snapshot.timeline["e-claude"] if e.change_kind == "deprecated")
    event = original.model_copy(deep=True)
    snapshot.timeline = {"e-claude": [event]}
    assert len(catalog_changes(snapshot)) == 1
    if mutant == "event-kind":
        event.change_kind = "availability"
    else:
        # Both declared fields say access, but the actual dated fact says retirement.
        event.kind = "update"
        event.change_kind = "availability"
    assert catalog_changes(snapshot) == []
