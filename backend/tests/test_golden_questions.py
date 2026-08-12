import json
from pathlib import Path

from app.golden_questions import GoldenQuestionEvaluator
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
    assert report.passed == 16
    assert report.pass_ratio == 0.8
    assert report.required_ratio == 0.85
    assert report.ready is False
    failed = {result.id: result for result in report.results if not result.passed}
    assert set(failed) == {"gq-12", "gq-14", "gq-15", "gq-16"}
    assert "e-mmlu" in failed["gq-12"].reason
    assert "e-mcp" in failed["gq-14"].reason
    assert "冲突或证据不足" in failed["gq-15"].reason
    assert failed["gq-16"].missing_entity_ids == ["e-claude", "e-gemini", "e-gpt"]
