"""Limit re-extraction of an updated document to the text that changed.

Changelogs and release notes grow by a few entries at a time. Re-sending the
whole page on every update repeats paid work whose facts are already in the
review queue or the catalog. When the previous snapshot of the same source was
fully extracted, only new lines (with nearby context such as a date heading)
are sent; otherwise the whole document is extracted as before.
"""

from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher

CONTEXT_LINES = 3
# Above this share of new text a delta saves little and loses document structure.
MAX_DELTA_RATIO = 0.6


@dataclass(frozen=True, slots=True)
class DocumentDelta:
    text: str
    mode: str  # "delta" | "unchanged" | "full"
    changed_lines: int
    total_lines: int


def changed_text(previous: str, current: str) -> DocumentDelta:
    old_lines = previous.splitlines()
    new_lines = current.splitlines()
    keep: set[int] = set()
    matcher = SequenceMatcher(a=old_lines, b=new_lines, autojunk=False)
    for tag, _, _, start, end in matcher.get_opcodes():
        if tag in {"replace", "insert"}:
            keep.update(range(start, end))
    changed = {index for index in keep if new_lines[index].strip()}
    if not changed:
        return DocumentDelta("", "unchanged", 0, len(new_lines))
    changed_chars = sum(len(new_lines[index]) for index in changed)
    if changed_chars > MAX_DELTA_RATIO * max(1, len(current)):
        return DocumentDelta(current, "full", len(changed), len(new_lines))
    selected: set[int] = set()
    for index in changed:
        selected.update(
            range(max(0, index - CONTEXT_LINES), min(len(new_lines), index + CONTEXT_LINES + 1))
        )
    blocks: list[str] = []
    block: list[str] = []
    previous_index = None
    for index in sorted(selected):
        if previous_index is not None and index != previous_index + 1:
            blocks.append("\n".join(block))
            block = []
        block.append(new_lines[index])
        previous_index = index
    blocks.append("\n".join(block))
    return DocumentDelta("\n\n".join(blocks), "delta", len(changed), len(new_lines))
