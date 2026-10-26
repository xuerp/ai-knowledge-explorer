"""Build a source review queue without promoting facts or changing the catalog."""

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


def canonical_url(url):
    return urlunsplit(urlsplit(url)._replace(fragment=""))


def build_queue(snapshot, audit):
    checks = {row["sourceId"]: row for row in audit["sources"]}
    claims = defaultdict(list)
    references = defaultdict(set)

    def visit(value, path):
        if isinstance(value, dict):
            for source_id in value.get("sourceIds") or []:
                references[source_id].add(path)
            for key, child in value.items():
                visit(child, f"{path}/{key}")
        elif isinstance(value, list):
            for index, child in enumerate(value):
                label = child.get("id", str(index)) if isinstance(child, dict) else str(index)
                visit(child, f"{path}/{label}")

    visit(snapshot, "")
    for claim in snapshot["claims"]:
        for source_id in claim["sourceIds"]:
            claims[source_id].append(claim)
    groups = defaultdict(list)
    for source in snapshot["evidence"]:
        check = checks.get(source["id"], {})
        groups[canonical_url(source["url"])].append(
            {
                "sourceId": source["id"],
                "title": source["title"],
                "excerpt": source.get("sourceExcerpt", ""),
                "retrievalStatus": check.get("retrievalStatus", "not-checked"),
                "excerptStatus": check.get("excerptStatus", "not-checked"),
                "claims": claims[source["id"]],
                "referencePaths": sorted(references[source["id"]]),
                "semanticReviewStatus": "pending",
            }
        )
    queue = []
    for url, sources in groups.items():
        linked = {claim["id"] for source in sources for claim in source["claims"]}
        unresolved = any(s["excerptStatus"] != "exact-normalized-match" for s in sources)
        queue.append(
            {
                "url": url,
                "sourceRecords": len(sources),
                "linkedClaimCount": len(linked),
                "needsRetrievalOrExcerptReview": unresolved,
                "semanticReviewStatus": "pending",
                "sources": sources,
            }
        )
    queue.sort(
        key=lambda row: (
            not row["needsRetrievalOrExcerptReview"],
            -row["linkedClaimCount"],
            row["url"],
        )
    )
    return {
        "scope": "Review planning only. Exact excerpts do not prove claim semantics.",
        "sourceRecords": len(snapshot["evidence"]),
        "uniqueUrls": len(queue),
        "claims": len(snapshot["claims"]),
        "unresolvedExcerptUrls": sum(row["needsRetrievalOrExcerptReview"] for row in queue),
        "recordExcerptStatuses": dict(
            Counter(s["excerptStatus"] for row in queue for s in row["sources"])
        ),
        "queue": queue,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = build_queue(
        json.loads(args.snapshot.read_text(encoding="utf-8")),
        json.loads(args.audit.read_text(encoding="utf-8")),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "queue"}))


if __name__ == "__main__":
    main()
