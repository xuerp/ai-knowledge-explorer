"""Verify pinned official excerpts and snapshot references; no model calls."""

import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs/portfolio/real-data"


def verify(fetch=False):
    sources = json.loads((DATA / "sources.json").read_text(encoding="utf-8"))
    snapshot = json.loads((DATA / "snapshot.json").read_text(encoding="utf-8"))
    source_ids = {row["id"] for row in snapshot["evidence"]}
    entity_ids = {row["id"] for row in snapshot["entities"]}
    assert len(source_ids) == len(snapshot["evidence"])
    documents = {row["url"]: row for row in sources}
    for evidence in snapshot["evidence"]:
        document = documents[evidence["url"]]
        assert evidence["sourceExcerpt"] in document["excerpts"]
    for claim in snapshot["claims"]:
        assert claim["entityId"] in entity_ids
        assert set(claim["sourceIds"]) <= source_ids
        assert claim["sourceIds"]
    for entity in snapshot["entities"]:
        claims = [c for c in snapshot["claims"] if c["entityId"] == entity["id"]]
        points = entity["knowledge"]["keyPoints"]
        assert [p["description"] for p in points] == [c["text"] for c in claims]
        assert [p["sourceIds"] for p in points] == [c["sourceIds"] for c in claims]
    for source in sources:
        if fetch:
            with urlopen(source["rawUrl"], timeout=30) as response:
                body = response.read()
            assert hashlib.sha256(body).hexdigest() == source["sha256"], source["id"]
            assert all(q in body.decode("utf-8") for q in source["excerpts"]), source[
                "id"
            ]
    for key in (
        "following",
        "notifications",
        "syncRuns",
        "researchAnswers",
        "reviewCandidates",
        "changes",
        "researchQuestions",
        "interestProfile",
        "timeline",
    ):
        assert not snapshot[key], f"No invented user activity: {key}"
    assert not snapshot["graph"]["edges"]
    print(
        json.dumps(
            {
                "entities": len(entity_ids),
                "claims": len(snapshot["claims"]),
                "officialDocuments": len(sources),
                "remoteVerified": fetch,
            }
        )
    )


if __name__ == "__main__":
    import sys

    verify("--fetch" in sys.argv)
