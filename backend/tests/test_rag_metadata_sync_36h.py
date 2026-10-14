"""Publication metadata must refresh citations even when search prose is unchanged."""

from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base, RagClaimDocumentRecord
from app.engagement import revalidate_research
from app.rag import LexicalRagRetriever, grounded_retrieval_citations
from app.repository import KnowledgeRepository
from app.schemas import ResearchView

SEED = Path(__file__).resolve().parents[1] / "data/demo_snapshot.json"


@pytest.mark.parametrize("change", ["source-binding", "source-date-verification", "fact-validity"])
def test_unchanged_search_prose_refreshes_current_publication_metadata(change):
    snapshot = KnowledgeRepository(SEED).load_seed()
    original = grounded_retrieval_citations(snapshot, include_derived_knowledge=False)[0]
    updated = snapshot.model_copy(deep=True)
    claim = next(item for item in updated.claims if item.id == original.claim.id)
    evidence = next(item for item in updated.evidence if item.id == claim.source_ids[0])
    if change == "source-binding":
        replacement = evidence.model_copy(update={"id": "fixture-replacement-evidence"}, deep=True)
        updated.evidence.append(replacement)
        claim.source_ids = [replacement.id, *claim.source_ids[1:]]
    elif change == "source-date-verification":
        evidence.published_at = "2026-01-02"
        evidence.verified_at = "2026-01-03T08:00:00+00:00"
    else:
        claim.valid_from = "2020-01-01"
        claim.valid_to = "2099-01-01"
    current = next(
        item
        for item in grounded_retrieval_citations(updated, include_derived_knowledge=False)
        if item.claim.id == claim.id
    )
    assert current != original

    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    retriever = LexicalRagRetriever(include_derived_knowledge=False)
    with Session(engine) as session:
        retriever.sync_snapshot(session, snapshot)
        before_hash = session.get(RagClaimDocumentRecord, claim.id).content_hash
        retriever.sync_snapshot(session, updated)
        row = session.get(RagClaimDocumentRecord, claim.id)
        assert row.content_hash == before_hash
        citations = retriever.citations_for_claim_ids(session, [claim.id])
        assert citations == [current]
        assert row.valid_from == current.claim.valid_from
        assert row.valid_to == current.claim.valid_to
        assert row.source_published_at == min(
            (item.published_at for item in current.evidence if item.published_at), default=None
        )
        record = ResearchView(
            id="fixture-current-metadata",
            question="Fixture metadata revision",
            summary="Fixture",
            claim_ids=[claim.id],
            citations=citations,
            steps=[],
            status="ready",
            created_at=datetime.now(UTC),
        )
        reopened = revalidate_research(record, updated)
        assert reopened.citation_states == {claim.id: "current"}
        assert reopened.status == "ready"
