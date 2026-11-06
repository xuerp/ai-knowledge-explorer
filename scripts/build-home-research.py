"""Replay one public case through the existing rules; no model, account, or DB calls."""

import argparse
import hashlib
import json
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.decision_candidates import discover_candidates
from app.decision_constraints import current_claims
from app.decision_guidance import build_guidance
from app.engagement import EngagementService
from app.rag import grounded_retrieval_citations
from app.repository import KnowledgeRepository
from app.schemas import DecisionContext

CASE = ROOT / "product/home-research-case.v1.json"
SNAPSHOT = ROOT / "backend/data/demo_snapshot.json"
OUTPUT = ROOT / "src/data/generated/home-research.json"


def fingerprint(path):
    return hashlib.sha256(path.read_text(encoding="utf-8").encode()).hexdigest()


def build(generated_at):
    case = json.loads(CASE.read_text(encoding="utf-8"))
    snapshot = KnowledgeRepository(SNAPSHOT).load_seed()
    facts = current_claims([row.claim for row in grounded_retrieval_citations(snapshot)], snapshot)
    by_entity = defaultdict(list)
    for fact in facts:
        by_entity[fact.entity_id].append(fact)
    claims = {fact.id: fact for fact in facts}
    evidence = {source.id: source for source in snapshot.evidence}
    languages = {}
    for language in ("zh", "en"):
        context = DecisionContext(**case["context"], task=case["task"][language])
        ids, _ = discover_candidates(context, snapshot, by_entity, language)
        result = EngagementService._build_decision(
            context,
            [fact for fact in facts if fact.entity_id in ids],
            ids,
            snapshot,
            language,
        )
        guidance = build_guidance(result, context, snapshot, language)
        advice = guidance.recommendation
        if not advice.primary_entity_id or not advice.reasons:
            raise ValueError("The featured case no longer has a sourced conditional suggestion.")
        reason_claim_ids = list(
            dict.fromkeys(key for row in advice.reasons for key in row.claim_ids)
        )
        source_ids = list(
            dict.fromkeys(sid for key in reason_claim_ids for sid in claims[key].source_ids)
        )
        sources = [
            {
                "id": sid,
                "title": evidence[sid].title.model_dump(),
                "url": evidence[sid].url,
            }
            for sid in source_ids
            if sid in evidence and evidence[sid].url
        ]
        if not sources:
            raise ValueError("The featured case must retain its public source links.")
        languages[language] = {
            "question": case["task"][language],
            "headline": advice.headline,
            "summary": advice.summary,
            "reasons": [row.model_dump(by_alias=True) for row in advice.reasons],
            "tradeoff": advice.tradeoff,
            "unknowns": [row.detail for row in guidance.unknowns],
            "nextAction": guidance.next_action.model_dump(by_alias=True),
            "sources": sources,
        }
    return {
        "schemaVersion": 1,
        "generatedAt": generated_at,
        "snapshotSha256": fingerprint(SNAPSHOT),
        "caseSha256": fingerprint(CASE),
        "title": case["title"],
        "languages": languages,
        "executed": False,
        "generation": "existing-decision-rules; no external model calls",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    previous = json.loads(OUTPUT.read_text(encoding="utf-8")) if args.check else None
    generated_at = previous["generatedAt"] if previous else datetime.now(UTC).isoformat()
    result = build(generated_at)
    if args.check:
        if result != previous:
            raise SystemExit(
                "Homepage case has drifted; regenerate it from the current public data."
            )
        print("Homepage research replay matches the current public data and rules.")
    else:
        OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("Generated public homepage research example; no external calls or saved research.")


if __name__ == "__main__":
    main()
