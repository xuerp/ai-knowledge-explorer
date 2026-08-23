from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base, RagClaimDocumentRecord
from app.rag import LexicalRagRetriever
from app.repository import KnowledgeRepository

SEED_PATH = Path(__file__).resolve().parents[1] / "data" / "demo_snapshot.json"


def test_lexical_rag_builds_grounded_projection_and_returns_citations():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    repository = KnowledgeRepository(SEED_PATH)
    retriever = LexicalRagRetriever()
    with Session(engine) as session:
        repository.seed_catalog(session)
        snapshot = repository.public_snapshot(session)
        result = retriever.search(session, snapshot, "GPT-5 的 SWE-bench 表现如何？")
        rows = session.scalars(select(RagClaimDocumentRecord)).all()

    assert rows
    assert all(row.entity_id and row.lifecycle_status == "current" for row in rows)
    assert result.diagnostics.returned_count > 0
    assert result.diagnostics.matched_entity_ids == ["e-gpt-5", "e-swebench"]
    assert all(item.claim.confidence == "verified" for item in result.citations)
    assert all(item.evidence for item in result.citations)


def test_lexical_rag_refuses_to_index_unverified_or_unmapped_claims():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    repository = KnowledgeRepository(SEED_PATH)
    retriever = LexicalRagRetriever()
    with Session(engine) as session:
        repository.seed_catalog(session)
        snapshot = repository.public_snapshot(session)
        unresolved = next(claim for claim in snapshot.claims if claim.entity_id is None)
        unresolved.confidence = "unverified"
        retriever.sync_snapshot(session, snapshot)
        assert session.get(RagClaimDocumentRecord, unresolved.id) is None
