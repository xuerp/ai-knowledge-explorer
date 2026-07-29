import json
from pathlib import Path


def test_golden_research_set_has_twenty_unique_grounded_questions():
    path = Path(__file__).resolve().parents[1] / "data" / "golden_questions.json"
    questions = json.loads(path.read_text(encoding="utf-8"))

    assert len(questions) == 20
    assert len({item["id"] for item in questions}) == 20
    assert all(len(item["question"]) >= 8 for item in questions)
    assert all(isinstance(item["expectedEntityIds"], list) for item in questions)
    assert all(isinstance(item["requiresTemporalEvidence"], bool) for item in questions)
