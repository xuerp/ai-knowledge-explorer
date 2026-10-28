import json
from dataclasses import replace
from pathlib import Path

import pytest

from app.config import Settings
from app.evaluation_scope import assess_evaluation, corpus_fingerprint
from app.schemas import EvaluationQualityMetrics, KnowledgeSnapshot

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def baseline():
    payload = json.loads((ROOT / "backend/data/quality_evaluation.json").read_text("utf-8"))
    reference = payload.pop("reference")
    evaluation = EvaluationQualityMetrics.model_validate(payload)
    snapshot = KnowledgeSnapshot.model_validate_json(
        (ROOT / "docs/eval/snapshots/public_snapshot_2026-08-30.json").read_bytes()
    )
    settings = Settings(
        database_url="sqlite://",
        seed_snapshot_path=ROOT / "backend/data/demo_snapshot.json",
        admin_token=None,
        cors_origins=(),
        retrieval_mode="hybrid",
        embedding_provider="cloudflare",
        embedding_model=evaluation.embedding_model,
        build_commit=evaluation.evaluation_commit,
    )
    return evaluation, reference, snapshot, settings


def test_original_report_scope_matches_without_running_retrieval(baseline):
    result = assess_evaluation(*baseline)
    assert result.status == "scope-matched"
    assert result.corpus_matches is True
    assert result.missing_expected_claim_sample_count == 0
    assert not result.reasons


def test_corpus_fingerprint_ignores_request_metadata_and_order_but_detects_edits(baseline):
    _, _, snapshot, _ = baseline
    payload = snapshot.model_dump(mode="json", by_alias=True)
    payload["meta"]["retrievedAt"] = "2026-10-04T10:00:00Z"
    payload["claims"].reverse()
    reordered = KnowledgeSnapshot.model_validate(payload)
    assert corpus_fingerprint(reordered) == corpus_fingerprint(snapshot)
    payload["claims"][0]["text"]["zh"] += " amended"
    assert corpus_fingerprint(KnowledgeSnapshot.model_validate(payload)) != corpus_fingerprint(
        snapshot
    )


def test_missing_annotations_and_changed_configuration_keep_old_scores_historical(baseline):
    evaluation, reference, snapshot, settings = baseline
    missing_id = reference["expectedClaimIdsBySample"][0][0]
    changed = snapshot.model_copy(
        update={"claims": [claim for claim in snapshot.claims if claim.id != missing_id]}
    )
    result = assess_evaluation(
        evaluation,
        reference,
        changed,
        replace(
            settings, retrieval_mode="lexical", embedding_provider="none", build_commit="local"
        ),
    )
    assert result.status == "historical"
    assert result.missing_expected_claim_sample_count > 0
    assert set(result.reasons) == {
        "corpus-changed",
        "annotations-missing",
        "retrieval-config-changed",
        "build-not-matched",
    }
    assert evaluation.pass_ratio == 1.0


def test_excerpt_classification_changes_invalidate_historical_scope(baseline):
    evaluation, reference, snapshot, settings = baseline
    payload = snapshot.model_dump(mode="json", by_alias=True)
    payload["evidence"][0]["sourceExcerptKind"] = "quote"
    classified = KnowledgeSnapshot.model_validate(payload)
    assert corpus_fingerprint(classified) != corpus_fingerprint(snapshot)
    assert assess_evaluation(evaluation, reference, classified, settings).corpus_matches is False


@pytest.mark.parametrize("reference", [None, "invalid", {}, {"expectedClaimIdsBySample": [[]]}])
def test_missing_or_malformed_reference_cannot_claim_applicability(baseline, reference):
    evaluation, _, snapshot, settings = baseline
    result = assess_evaluation(evaluation, reference, snapshot, settings)
    assert result.status == "historical"
    assert result.corpus_matches is None
    assert result.missing_expected_claim_sample_count is None
    assert "reference-unavailable" in result.reasons


def test_publisher_rejects_a_different_snapshot_and_reproduces_committed_baseline(monkeypatch):
    monkeypatch.syspath_prepend(str(ROOT / "scripts"))
    from publish_quality_metrics import build_quality_evaluation

    artifact = (
        "docs/eval/results/v1.0.0_8978fef80e19_sqlite_hybrid_cloudflare_-cf-baai-bge-m3_top8.json"
    )
    report = json.loads((ROOT / artifact).read_text("utf-8"))
    snapshot_bytes = (ROOT / "docs/eval/snapshots/public_snapshot_2026-08-30.json").read_bytes()
    with pytest.raises(ValueError, match="does not match"):
        build_quality_evaluation(
            report, artifact_path=artifact, snapshot_bytes=snapshot_bytes + b" "
        )
    with pytest.raises(ValueError, match="annotations"):
        incomplete = {**report, "results": report["results"][:-1]}
        build_quality_evaluation(incomplete, artifact_path=artifact, snapshot_bytes=snapshot_bytes)
    assert build_quality_evaluation(
        report, artifact_path=artifact, snapshot_bytes=snapshot_bytes
    ) == json.loads((ROOT / "backend/data/quality_evaluation.json").read_text("utf-8"))
