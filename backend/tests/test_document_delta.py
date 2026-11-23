from app.document_delta import changed_text

CHANGELOG_V1 = "\n".join(
    [
        "# API changelog",
        "",
        "## 2026-11-10",
        "- Released model Alpha with a 1M context window.",
        "",
        "## 2026-11-01",
        "- Deprecated legacy endpoint Beta.",
    ]
    + [f"- Older entry {index}." for index in range(40)]
)


def test_new_entry_is_sent_with_its_date_heading_and_not_the_whole_page():
    current = CHANGELOG_V1.replace(
        "# API changelog\n",
        "# API changelog\n\n## 2026-11-20\n- Released model Gamma with tool use.\n",
    )
    delta = changed_text(CHANGELOG_V1, current)

    assert delta.mode == "delta"
    assert "Released model Gamma with tool use." in delta.text
    assert "## 2026-11-20" in delta.text
    assert "Older entry 30." not in delta.text
    assert len(delta.text) < len(current) / 3


def test_edited_line_is_treated_as_changed():
    current = CHANGELOG_V1.replace("1M context window", "2M context window")
    delta = changed_text(CHANGELOG_V1, current)

    assert delta.mode == "delta"
    assert "Released model Alpha with a 2M context window." in delta.text
    assert "## 2026-11-10" in delta.text


def test_removed_lines_or_whitespace_only_changes_send_nothing():
    removed = CHANGELOG_V1.replace("- Deprecated legacy endpoint Beta.\n", "")
    assert changed_text(CHANGELOG_V1, removed).mode == "unchanged"
    assert changed_text(CHANGELOG_V1, CHANGELOG_V1 + "\n\n").mode == "unchanged"


def test_mostly_rewritten_document_falls_back_to_full_extraction():
    rewritten = "\n".join(f"- Completely new entry {index}." for index in range(60))
    delta = changed_text(CHANGELOG_V1, rewritten)

    assert delta.mode == "full"
    assert delta.text == rewritten
