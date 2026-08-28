from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base, RagClaimDocumentRecord
from app.golden_questions import GoldenQuestionEvaluator
from app.rag import HybridRagRetriever, LexicalRagRetriever, VectorSearchHit
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
        unresolved = snapshot.claims[0].model_copy(
            update={"id": "c-test-unmapped", "entity_id": None, "confidence": "unverified"}
        )
        snapshot.claims.append(unresolved)
        retriever.sync_snapshot(session, snapshot)
        assert session.get(RagClaimDocumentRecord, unresolved.id) is None


def test_lexical_rag_expands_family_mentions_to_concrete_versions():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    repository = KnowledgeRepository(SEED_PATH)
    retriever = LexicalRagRetriever()
    with Session(engine) as session:
        repository.seed_catalog(session)
        snapshot = repository.public_snapshot(session)
        result = retriever.search(session, snapshot, "GPT 最近有哪些已核验变化？")

    assert result.diagnostics.matched_entity_ids == ["e-gpt"]
    assert any(item.claim.entity_id == "e-gpt-5" for item in result.citations)


def test_lexical_rag_keeps_each_family_in_multi_entity_questions():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    repository = KnowledgeRepository(SEED_PATH)
    retriever = LexicalRagRetriever()
    with Session(engine) as session:
        repository.seed_catalog(session)
        snapshot = repository.public_snapshot(session)
        result = retriever.search(session, snapshot, "GPT 与 Claude 最近有什么变化？")

    retrieved = GoldenQuestionEvaluator._expand_entity_families(
        snapshot,
        {item.claim.entity_id for item in result.citations if item.claim.entity_id},
    )
    assert {"e-gpt", "e-claude"}.issubset(retrieved)


def test_lexical_rag_prioritizes_model_facts_for_broad_model_questions():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    repository = KnowledgeRepository(SEED_PATH)
    retriever = LexicalRagRetriever()
    with Session(engine) as session:
        repository.seed_catalog(session)
        snapshot = repository.public_snapshot(session)
        result = retriever.search(session, snapshot, "过去一年有哪些模型能力发生了变化？")

    retrieved = GoldenQuestionEvaluator._expand_entity_families(
        snapshot,
        {item.claim.entity_id for item in result.citations if item.claim.entity_id},
    )
    assert {"e-gpt", "e-claude", "e-gemini"}.issubset(retrieved)


def test_lexical_rag_can_find_related_claim_when_entity_has_no_direct_claim():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    repository = KnowledgeRepository(SEED_PATH)
    retriever = LexicalRagRetriever()
    with Session(engine) as session:
        repository.seed_catalog(session)
        snapshot = repository.public_snapshot(session)
        result = retriever.search(session, snapshot, "SWE-bench Verified 衡量什么？")

    assert any("SWE-bench" in item.claim.text.en for item in result.citations)


class FakeEmbeddingProvider:
    model_name = "test-embedding"

    def __init__(self, *, fail: bool = False):
        self.fail = fail
        self.query_calls = 0

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [[float(index)] for index, _ in enumerate(texts)]

    def embed_query(self, text: str) -> list[float]:
        self.query_calls += 1
        if self.fail:
            raise RuntimeError("provider unavailable")
        return [float(len(text))]


class FakeVectorIndex:
    def __init__(self, claim_ids: list[str]):
        self.claim_ids = claim_ids
        self.search_calls = 0

    def upsert(self, documents):
        return None

    def search(self, vector: list[float], *, limit: int) -> list[VectorSearchHit]:
        self.search_calls += 1
        return [
            VectorSearchHit(claim_id=claim_id, score=1 / rank)
            for rank, claim_id in enumerate(self.claim_ids[:limit], start=1)
        ]


class PreferredReranker:
    def __init__(self, claim_id: str):
        self.claim_id = claim_id

    def rerank(self, question, citations):
        return [self.claim_id]


def test_hybrid_rag_disabled_never_calls_external_provider():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    repository = KnowledgeRepository(SEED_PATH)
    embedding = FakeEmbeddingProvider()
    vector_index = FakeVectorIndex([])
    retriever = HybridRagRetriever(
        embedding_provider=embedding,
        vector_index=vector_index,
        enabled=False,
    )
    with Session(engine) as session:
        repository.seed_catalog(session)
        result = retriever.search(
            session, repository.public_snapshot(session), "GPT-5 的能力如何？"
        )

    assert result.retrieval_mode == "lexical"
    assert result.diagnostics.fallback_reason == "hybrid-disabled"
    assert embedding.query_calls == 0
    assert vector_index.search_calls == 0


def test_hybrid_rag_fuses_results_and_applies_reranker():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    repository = KnowledgeRepository(SEED_PATH)
    lexical = LexicalRagRetriever()
    with Session(engine) as session:
        repository.seed_catalog(session)
        snapshot = repository.public_snapshot(session)
        baseline = lexical.search(session, snapshot, "模型有哪些能力和性能？", limit=8)
        claim_ids = [item.claim.id for item in baseline.citations]
        assert len(claim_ids) >= 2
        embedding = FakeEmbeddingProvider()
        vector_index = FakeVectorIndex(list(reversed(claim_ids)))
        retriever = HybridRagRetriever(
            lexical,
            embedding_provider=embedding,
            vector_index=vector_index,
            reranker=PreferredReranker(claim_ids[-1]),
            enabled=True,
        )
        result = retriever.search(session, snapshot, "模型有哪些能力和性能？", limit=8)

    assert result.retrieval_mode == "hybrid"
    assert result.diagnostics.fallback_reason is None
    assert embedding.query_calls == 1
    assert vector_index.search_calls == 1
    assert result.citations[0].claim.id == claim_ids[-1]


def test_hybrid_rag_provider_error_falls_back_to_lexical():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    repository = KnowledgeRepository(SEED_PATH)
    embedding = FakeEmbeddingProvider(fail=True)
    vector_index = FakeVectorIndex([])
    retriever = HybridRagRetriever(
        embedding_provider=embedding,
        vector_index=vector_index,
        enabled=True,
    )
    with Session(engine) as session:
        repository.seed_catalog(session)
        result = retriever.search(
            session, repository.public_snapshot(session), "GPT-5 的能力如何？"
        )

    assert result.retrieval_mode == "lexical"
    assert result.diagnostics.fallback_reason == "hybrid-provider-error"
    assert result.citations
