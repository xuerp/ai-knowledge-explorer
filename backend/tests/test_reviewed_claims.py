import json
from pathlib import Path

from app.repository import KnowledgeRepository
from app.reviewed_claims import apply_reviewed_claims
from app.schemas import Claim, Evidence

DATA = Path(__file__).resolve().parents[1] / "data"
CORRECTIONS = DATA / "reviewed_claim_corrections.v1.json"


def reviewed_snapshot():
    snapshot = KnowledgeRepository(DATA / "demo_snapshot.json").load_seed().model_copy(deep=True)
    rows = json.loads(CORRECTIONS.read_text(encoding="utf-8"))["corrections"]
    snapshot.claims.extend(Claim.model_validate(row["expectedClaim"]) for row in rows)
    sources = {source.id: source for source in snapshot.evidence}
    for row in rows:
        for value in row["expectedEvidence"]:
            source = Evidence.model_validate(value)
            sources[source.id] = source
    snapshot.evidence = list(sources.values())
    return snapshot


def test_reviewed_channel_corrections_preserve_records_and_fix_model_associations():
    snapshot = reviewed_snapshot()
    before_ids = [claim.id for claim in snapshot.claims]
    apply_reviewed_claims(snapshot, CORRECTIONS)
    claims = {claim.id: claim for claim in snapshot.claims}
    assert [claim.id for claim in snapshot.claims] == before_ids
    mini = claims["claim-cb7004d663b2a78f4000"]
    assert mini.entity_id == "e-gpt-5-mini" and mini.subject == "GPT-5 mini"
    assert "2026-10-25" in mini.text.en and "Cursor-channel" in mini.text.en
    assert mini.predicate.startswith("historical-channel-")
    assert claims["claim-4ba85312ac331f361fcc"].entity_id == "e-gpt-54-mini"
    assert claims["claim-3fb24f7932813cc521ea"].entity_id == "e-gpt-54"


def test_future_admin_claim_or_evidence_edits_are_never_overwritten():
    snapshot = reviewed_snapshot()
    claim = next(c for c in snapshot.claims if c.id == "claim-cb7004d663b2a78f4000")
    claim.text.en = "An administrator has independently corrected this record."
    other = next(c for c in snapshot.claims if c.id == "claim-84517a69ce97fbd4c9a5")
    source = next(e for e in snapshot.evidence if e.id in other.source_ids)
    source.source_excerpt = "New independently reviewed evidence."
    apply_reviewed_claims(snapshot, CORRECTIONS)
    assert claim in snapshot.claims
    assert next(c for c in snapshot.claims if c.id == other.id) == other
