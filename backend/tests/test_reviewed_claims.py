import json
from pathlib import Path

import pytest

from app.repository import KnowledgeRepository
from app.reviewed_claims import apply_reviewed_claims
from app.schemas import Claim, Evidence

DATA = Path(__file__).resolve().parents[1] / "data"
CORRECTIONS = DATA / "reviewed_claim_corrections.v1.json"


def reviewed_snapshot():
    snapshot = KnowledgeRepository(DATA / "demo_snapshot.json").load_seed().model_copy(deep=True)
    rows = json.loads(CORRECTIONS.read_text(encoding="utf-8"))["corrections"]
    reviewed_ids = {row["expectedClaim"]["id"] for row in rows}
    snapshot.claims = [claim for claim in snapshot.claims if claim.id not in reviewed_ids]
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


def test_historical_scope_and_named_models_replace_false_current_family_facts():
    snapshot = reviewed_snapshot()
    apply_reviewed_claims(snapshot, CORRECTIONS)
    claims = {claim.id: claim for claim in snapshot.claims}
    sonnet = claims["claim-54173b7c1f419463ec41"]
    assert sonnet.entity_id == "e-claude-sonnet-37"
    assert sonnet.predicate == "historical-output-price"
    assert sonnet.valid_from == "2025-02-24"
    assert "historical" in sonnet.text.en
    assert claims["claim-40ad28900a9d0211f2bc"].entity_id == "e-gpt-55"
    assert claims["claim-28fcfd19ccddc7866cb1"].entity_id == "e-gpt-53-codex"
    assert "provider" in claims["claim-9ff929450ae6107ea8c3"].text.en
    assert "Transformers integration" in claims["claim-34e6cc0b74ae79994342"].text.en
    assert "24 prompt styles" in claims["claim-122fcba89c1ea7b5ed5f"].text.en
    negative = claims["c-gemini-4-not-released"]
    assert negative.confidence == "unverified" and negative.valid_to == "2026-10-12"
    source = next(e for e in snapshot.evidence if e.id == negative.source_ids[0])
    assert not source.published_at and not source.verified_at
    assert "unverified historical" in source.title.en


def test_added_citation_is_guarded_and_future_source_edits_win():
    snapshot = reviewed_snapshot()
    cid = "claim-decision-critical-ddc2ad5233ddc684adce"
    original = next(claim for claim in snapshot.claims if claim.id == cid).model_copy(deep=True)
    added = next(source for source in snapshot.evidence if source.id == "s-gpt-6-1-sol-20261001")
    added.source_excerpt = "A later administrator review changed this evidence."
    apply_reviewed_claims(snapshot, CORRECTIONS)
    assert next(claim for claim in snapshot.claims if claim.id == cid) == original


def test_installation_examples_and_catalog_overviews_keep_their_documented_scope():
    snapshot = reviewed_snapshot()
    apply_reviewed_claims(snapshot, CORRECTIONS)
    claims = {claim.id: claim for claim in snapshot.claims}
    python = claims["claim-9126d607ce60c9861365"]
    assert "optional Conda example" in python.text.en
    assert "minimum is Python 3.10" in python.text.en
    assert "not mandatory" in python.text.en
    environment = claims["claim-8f4fb8e8feb9ae16bfcb"]
    assert "example name, not a fixed requirement" in environment.text.en
    for cid in (
        "claim-9b3c19e22e97060d95c0",
        "claim-b0b807cfd36c1bf471b0",
        "claim-8a35df216c87709ce1ff",
        "claim-5b94391fd4f16f0c008d",
    ):
        assert claims[cid].subject == "Latest OpenAI models"
        assert "does not cover every historical or specialized model" in claims[cid].text.en
    codex = claims["claim-f0903927231c6e160a2f"]
    assert "shut down" in codex.text.en
    assert "s-codex-mini-model-reviewed-20261031" in codex.source_ids
    assert "s-kimi-k2-6-20261001" in claims["claim-549fe7c102ba1b5978ba"].source_ids
    sources = {source.id: source for source in snapshot.evidence}
    for cid in (
        "claim-9b3c19e22e97060d95c0",
        "claim-9126d607ce60c9861365",
        "claim-f0903927231c6e160a2f",
    ):
        source = sources[claims[cid].source_ids[0]]
        assert not source.published_at and source.collected_at


def test_missing_archive_correction_preserves_a_later_administrator_capture():
    snapshot = reviewed_snapshot()
    cid = "c-gemini-4-not-released"
    original = next(claim for claim in snapshot.claims if claim.id == cid).model_copy(deep=True)
    source = next(e for e in snapshot.evidence if e.id == original.source_ids[0])
    source.source_excerpt = "An administrator has attached the original archived body."
    reviewed = source.model_copy(deep=True)
    apply_reviewed_claims(snapshot, CORRECTIONS)
    assert next(claim for claim in snapshot.claims if claim.id == cid) == original
    assert next(e for e in snapshot.evidence if e.id == source.id) == reviewed


def test_metadata_correction_cannot_substitute_a_source_url(tmp_path):
    rows = json.loads(CORRECTIONS.read_text(encoding="utf-8"))["corrections"]
    row = next(r for r in rows if r["expectedClaim"]["id"] == "c-gemini-4-not-released")
    row["correctedEvidence"][0]["url"] = "https://example.com/unreviewed-replacement"
    path = tmp_path / "invalid-url.json"
    path.write_text(json.dumps({"corrections": [row]}), encoding="utf-8")
    with pytest.raises(ValueError, match="guarded ID and URL"):
        apply_reviewed_claims(reviewed_snapshot(), path)


@pytest.mark.parametrize("invalid_change", ["remove-original", "unguarded-addition"])
def test_corrections_reject_evidence_removal_or_unguarded_additions(tmp_path, invalid_change):
    row = json.loads(CORRECTIONS.read_text(encoding="utf-8"))["corrections"][0]
    row["correctedClaim"]["sourceIds"] = (
        []
        if invalid_change == "remove-original"
        else [*row["expectedClaim"]["sourceIds"], "unreviewed-source"]
    )
    path = tmp_path / "invalid.json"
    path.write_text(json.dumps({"corrections": [row]}), encoding="utf-8")
    with pytest.raises(ValueError, match="remove|exact evidence guard"):
        apply_reviewed_claims(reviewed_snapshot(), path)
