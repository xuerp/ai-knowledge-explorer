"""Read-only source audit of the complete local API; never promotes facts."""

import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.fetching import SafeHttpFetcher, classify_fetch_failure
from app.safe_dns import GoogleHttpsResolver

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "artifacts/full-catalog-verification-20261025"


def normalized(value):
    return re.sub(r"\s+", " ", value or "").strip().casefold()


def excerpt_checks(sources, body):
    normalized_body = normalized(body)
    return [
        {
            "sourceId": source["id"],
            "status": "missing"
            if not normalized(source.get("sourceExcerpt"))
            else "exact-normalized-match"
            if normalized(source["sourceExcerpt"]) in normalized_body
            else "not-found-in-current-text",
        }
        for source in sources
    ]


def reuse_receipt(receipt, body_path, sources):
    """Reuse fetched bytes, never stale source IDs or excerpt conclusions."""
    row = dict(receipt)
    row["sourceIds"] = [source["id"] for source in sources]
    row["factsVerified"] = False
    if row["status"] == "retrieved":
        if not body_path.exists():
            return None
        body = body_path.read_text(encoding="utf-8")
        if hashlib.sha256(body.encode()).hexdigest() != row["extractedTextSha256"]:
            return None
        row["excerpts"] = excerpt_checks(sources, body)
    else:
        row.pop("excerpts", None)
    return row


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "documents").mkdir(exist_ok=True)
    with httpx.Client(trust_env=False, timeout=30) as client:
        response = client.get("http://127.0.0.1:8002/api/v2/snapshot")
        response.raise_for_status()
    snapshot = response.json()
    (OUT / "snapshot.json").write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    grouped = defaultdict(list)
    for source in snapshot["evidence"]:
        parsed = urlsplit(source["url"])
        url = urlunsplit(parsed._replace(fragment=""))
        grouped[url].append(source)
    hosts = tuple(sorted({urlsplit(url).hostname for url in grouped if urlsplit(url).hostname}))
    fetcher = SafeHttpFetcher(hosts, 3_000_000, resolver=GoogleHttpsResolver())

    def audit(url, sources):
        key = hashlib.sha256(url.encode()).hexdigest()
        receipt = OUT / "documents" / f"{key}.json"
        if receipt.exists():
            cached = reuse_receipt(
                json.loads(receipt.read_text(encoding="utf-8")),
                receipt.with_suffix(".txt"),
                sources,
            )
            if cached is not None:
                return cached
        row = {
            "url": url,
            "sourceIds": [s["id"] for s in sources],
            "checkedAt": datetime.now(UTC).isoformat(),
            "factsVerified": False,
        }
        try:
            document = fetcher.fetch(url)
            body = document.content
            (OUT / "documents" / f"{key}.txt").write_text(body, encoding="utf-8")
            row.update(
                status="retrieved",
                finalUrl=document.final_url,
                extractedTextSha256=hashlib.sha256(body.encode()).hexdigest(),
                characters=len(body),
                excerpts=[],
            )
            row["excerpts"] = excerpt_checks(sources, body)
        except (httpx.HTTPError, OSError, ValueError) as error:
            row.update(
                status="fetch-failed",
                failureKind=classify_fetch_failure(error),
                error=str(error)[:500],
            )
        receipt.write_text(json.dumps(row, ensure_ascii=False, indent=2), encoding="utf-8")
        return row

    rows = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(audit, url, sources) for url, sources in grouped.items()]
        for future in as_completed(futures):
            rows.append(future.result())
            if len(rows) % 20 == 0:
                print(
                    json.dumps(
                        {
                            "checked": len(rows),
                            "total": len(grouped),
                            "status": dict(Counter(r["status"] for r in rows)),
                        }
                    ),
                    flush=True,
                )
    evidence = {s["id"]: s for s in snapshot["evidence"]}
    issues = []
    for source in evidence.values():
        title = " ".join(str(v) for v in source["title"].values() if v)
        if re.search(r"演示|\bdemo\b|example", title, re.IGNORECASE):
            issues.append({"kind": "sample-source-title", "sourceId": source["id"]})
        if urlsplit(source["url"]).path in {"", "/"}:
            issues.append({"kind": "homepage-not-specific-evidence", "sourceId": source["id"]})
    for claim in snapshot["claims"]:
        for source_id in claim["sourceIds"]:
            if source_id not in evidence:
                issues.append(
                    {"kind": "missing-source", "claimId": claim["id"], "sourceId": source_id}
                )
    report = {
        "checkedAt": datetime.now(UTC).isoformat(),
        "databaseWrites": False,
        "paidCalls": 0,
        "factsAutomaticallyVerified": 0,
        "counts": {k: len(snapshot[k]) for k in ["entities", "claims", "evidence", "changes"]},
        "uniqueUrls": len(grouped),
        "statuses": dict(Counter(r["status"] for r in rows)),
        "issues": issues,
        "sources": sorted(rows, key=lambda r: r["url"]),
    }
    (OUT / "source-audit.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({k: report[k] for k in ["counts", "uniqueUrls", "statuses"]}), flush=True)


if __name__ == "__main__":
    main()
