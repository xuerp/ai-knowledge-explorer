"""Source-preserving clause roles shared by routing and constraint extraction.

This is a conservative grammar layer, not unrestricted semantic understanding.
Negative statements remain available as constraints but never supply positive
actions or available materials to downstream lexical matching.
"""

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class TaskClause:
    text: str
    prohibited: bool


def clauses(text: str, interpretation: dict) -> tuple[TaskClause, ...]:
    segments = []
    for part in re.split(
        interpretation["clauseSeparator"] + "|" + interpretation["contrastSeparator"],
        text,
        flags=re.IGNORECASE,
    ):
        if re.search(interpretation["negativeClause"], part.strip(), re.IGNORECASE):
            segments.append(part)
        else:
            segments.extend(re.split(interpretation["scopeBoundary"], part, flags=re.IGNORECASE))
    return tuple(
        TaskClause(
            text=part.strip(),
            prohibited=bool(
                re.search(interpretation["negativeClause"], part.strip(), re.IGNORECASE)
            ),
        )
        for part in segments
        if part.strip()
    )
