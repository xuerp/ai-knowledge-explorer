import json
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.golden_questions import GoldenQuestionEvaluator
from app.rag import LexicalRagRetriever
from app.repository import KnowledgeRepository


def test_golden_research_set_has_twenty_unique_grounded_questions():
    path = Path(__file__).resolve().parents[1] / "data" / "golden_questions.json"
    questions = json.loads(path.read_text(encoding="utf-8"))

    assert len(questions) == 20
    assert len({item["id"] for item in questions}) == 20
    assert all(len(item["question"]) >= 8 for item in questions)
    assert all(isinstance(item["expectedEntityIds"], list) for item in questions)
    assert all(isinstance(item["requiresTemporalEvidence"], bool) for item in questions)


def test_golden_questions_execute_against_grounded_catalog():
    data = Path(__file__).resolve().parents[1] / "data"
    snapshot = KnowledgeRepository(data / "demo_snapshot.json").load_seed()
    snapshot.claims = [claim for claim in snapshot.claims if claim.confidence != "unverified"]
    snapshot.review_candidates = []

    report = GoldenQuestionEvaluator(data / "golden_questions.json").evaluate(snapshot)

    assert report.total == 20
    assert report.passed == 18
    assert report.pass_ratio == 0.9
    assert report.required_ratio == 0.85
    assert report.ready is True
    failed = {result.id: result for result in report.results if not result.passed}
    assert set(failed) == {"gq-15", "gq-16"}
    assert "冲突或证据不足" in failed["gq-15"].reason
    assert failed["gq-16"].missing_entity_ids == ["e-claude", "e-gemini", "e-gpt"]


def test_concrete_version_retrieval_satisfies_family_expectation():
    data = Path(__file__).resolve().parents[1] / "data"
    snapshot = KnowledgeRepository(data / "demo_snapshot.json").load_seed()
    expanded = GoldenQuestionEvaluator._expand_entity_families(snapshot, {"e-gpt-5"})

    assert {"e-gpt-5", "e-gpt"}.issubset(expanded)


def test_citation_text_can_satisfy_a_related_entity_expectation():
    data = Path(__file__).resolve().parents[1] / "data"
    repository = KnowledgeRepository(data / "demo_snapshot.json")
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        repository.seed_catalog(session)
        snapshot = repository.public_snapshot(session)
        result = LexicalRagRetriever().search(
            session,
            snapshot,
            "SWE-bench Verified 衡量什么？",
        )

    entities = GoldenQuestionEvaluator._citation_entity_ids(snapshot, result.citations)
    assert "e-swebench" in entities


def test_retrieval_evaluation_prepares_the_index_only_once(monkeypatch):
    data = Path(__file__).resolve().parents[1] / "data"
    repository = KnowledgeRepository(data / "demo_snapshot.json")
    retriever = LexicalRagRetriever()
    original_prepare = retriever.prepare
    prepare_calls = 0

    def counted_prepare(session, snapshot):
        nonlocal prepare_calls
        prepare_calls += 1
        original_prepare(session, snapshot)

    monkeypatch.setattr(retriever, "prepare", counted_prepare)
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        repository.seed_catalog(session)
        snapshot = repository.public_snapshot(session)
        report = GoldenQuestionEvaluator(data / "golden_questions.json").evaluate(
            snapshot,
            session=session,
            retriever=retriever,
        )

    assert report.rag_metrics is not None
    assert prepare_calls == 1
