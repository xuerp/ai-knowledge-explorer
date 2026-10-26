import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from audit_full_catalog_sources import reuse_receipt
from build_source_review_queue import build_queue


def test_cached_text_is_rechecked_against_current_excerpt_and_membership(tmp_path):
    body = "Official release text"
    path = tmp_path / "body.txt"
    path.write_text(body, encoding="utf-8")
    receipt = {
        "status": "retrieved",
        "sourceIds": ["old"],
        "extractedTextSha256": hashlib.sha256(body.encode()).hexdigest(),
        "excerpts": [{"sourceId": "old", "status": "exact-normalized-match"}],
    }
    updated = reuse_receipt(
        receipt,
        path,
        [
            {"id": "new", "sourceExcerpt": "unsupported summary"},
            {"id": "literal", "sourceExcerpt": "Official release"},
            {"id": "blank", "sourceExcerpt": "   "},
        ],
    )
    assert updated["sourceIds"] == ["new", "literal", "blank"]
    assert [r["status"] for r in updated["excerpts"]] == [
        "not-found-in-current-text",
        "exact-normalized-match",
        "missing",
    ]
    assert updated["factsVerified"] is False
    assert receipt["sourceIds"] == ["old"]
    path.write_text("tampered", encoding="utf-8")
    assert reuse_receipt(receipt, path, []) is None
    assert reuse_receipt(receipt, tmp_path / "absent.txt", []) is None


def test_queue_deduplicates_urls_without_losing_nonclaim_references():
    snapshot = {
        "evidence": [
            {"id": "a", "url": "https://example.com/doc#one", "title": {}},
            {"id": "b", "url": "https://example.com/doc#two", "title": {}},
        ],
        "claims": [{"id": "claim", "sourceIds": ["a", "b"]}],
        "entities": [{"id": "entity", "sourceIds": None, "knowledge": [{"sourceIds": ["a"]}]}],
    }
    report = build_queue(snapshot, {"sources": []})
    assert report["uniqueUrls"] == 1 and report["sourceRecords"] == 2
    row = report["queue"][0]
    assert row["linkedClaimCount"] == 1
    assert row["semanticReviewStatus"] == "pending"
    assert "/entities/entity/knowledge/0" in row["sources"][0]["referencePaths"]
