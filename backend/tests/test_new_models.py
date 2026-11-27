import json
from pathlib import Path

import pytest

from app.extraction import heading_date, locate_dated_entry
from app.new_models import model_id_from, place_new_model
from app.schemas import KnowledgeSnapshot

SEED = Path(__file__).resolve().parents[2] / "src" / "data" / "generated" / "snapshot.json"


@pytest.fixture(scope="module")
def entities():
    return KnowledgeSnapshot.model_validate(json.loads(SEED.read_text(encoding="utf-8"))).entities


def test_changelog_date_headings_are_recognised_but_sentences_are_not():
    assert heading_date("**2026-8-19**") == "2026-08-19"
    assert heading_date("### November 9, 2026") == "2026-11-09"
    assert heading_date("## 2026年6月16日") == "2026-06-16"
    assert heading_date("GLM-5.3 was released on 2026-08-19 as a new flagship model") is None
    assert heading_date("**2026-02-30**") is None


def test_a_date_heading_and_the_entry_below_it_form_the_quote():
    page = "**2026-06-16**\n\nGLM-5.2 新一代旗舰模型上线\n\n**2026-08-26**\n\nGLM-5.3-Flash 上线"
    assert (
        locate_dated_entry(page, "GLM-5.2", "2026-06-16")
        == "**2026-06-16**\nGLM-5.2 新一代旗舰模型上线"
    )
    # The date must head the entry that names the subject; another day's entry does not count.
    assert locate_dated_entry(page, "GLM-5.2", "2026-08-26") is None
    # A longer name in the entry is a different model.
    assert locate_dated_entry(page, "GLM-5.3", "2026-08-26") is None


def test_a_long_entry_is_cut_to_the_sentence_that_names_the_subject():
    entry = "* We launched **Claude Fable 5.2** for agents. " + "Other detail. " * 80
    quote = locate_dated_entry("### November 9, 2026\n" + entry, "Claude Fable 5.2", "2026-11-09")
    assert quote == "### November 9, 2026\n* We launched **Claude Fable 5.2** for agents."


def test_a_new_model_is_placed_next_to_its_closest_sibling(entities):
    fable = place_new_model("Claude Fable 5.2", "Anthropic", entities)
    assert (fable.family_id, fable.sibling_id) == ("e-claude", "e-claude-fable-5-1")
    sol = place_new_model("GPT-6.3 Sol", "OpenAI", entities)
    assert (sol.family_id, sol.sibling_id) == ("e-gpt", "e-gpt-62-sol")
    # Only the brand word matches: the family is known but the product line is not.
    assert place_new_model("Claude Mythos 5.2", "Anthropic", entities).sibling_id is None


def test_no_placement_without_a_matching_vendor_or_for_a_known_model(entities):
    assert place_new_model("Claude Fable 5.2", "OpenAI", entities) is None
    assert place_new_model("Claude Sonnet 4.5", "Anthropic", entities) is None
    assert place_new_model("LangSmith", "LangChain", entities) is None


def test_the_api_id_is_read_from_the_quoted_source():
    excerpt = "* We launched **Claude Fable 5.2** (`claude-fable-5-2`), built for agents."
    assert model_id_from(excerpt, "Claude Fable 5.2") == "claude-fable-5-2"
    assert model_id_from("GLM-5.4 上线", "GLM-5.4") is None
