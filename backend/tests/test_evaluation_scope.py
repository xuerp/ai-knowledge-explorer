import json
from dataclasses import replace
from pathlib import Path

import pytest

from app.config import Settings
from app.evaluation_scope import (
    assess_evaluation,
    corpus_fingerprint,
    retrieval_configuration,
    retrieval_implementation_fingerprint,
)
from app.schemas import EvaluationQualityMetrics, KnowledgeSnapshot

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def baseline():
    payload = json.loads(
        (ROOT / "backend/data/quality_evaluation_history/v1.json").read_text("utf-8")
    )
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
    ) == json.loads((ROOT / "backend/data/quality_evaluation_history/v1.json").read_text("utf-8"))


@pytest.fixture
def current_scope(baseline):
    evaluation, _, _, settings = baseline
    snapshot = KnowledgeSnapshot.model_validate_json(
        (ROOT / "docs/eval/snapshots/public_snapshot_2026-11-07.json").read_bytes()
    )
    annotations = [[snapshot.claims[0].id]] * evaluation.sample_count
    reference = {
        "fingerprintVersion": 2,
        "corpusSha256": corpus_fingerprint(snapshot, version=2),
        "expectedClaimIdsBySample": annotations,
        "retrievalImplementationSha256": retrieval_implementation_fingerprint(),
        "retrievalConfiguration": retrieval_configuration(settings),
    }
    return evaluation, reference, snapshot, settings


def test_current_scope_ignores_transport_timestamps_and_report_only_commit(current_scope):
    evaluation, reference, snapshot, settings = current_scope
    payload = snapshot.model_dump(mode="json", by_alias=True)
    payload["meta"]["retrievedAt"] = "2026-11-08T11:00:00Z"
    payload["graph"]["capturedAt"] = "2026-11-08T11:00:00Z"
    payload["claims"].reverse()
    changed = KnowledgeSnapshot.model_validate(payload)
    result = assess_evaluation(
        evaluation, reference, changed, replace(settings, build_commit="report-only")
    )
    assert result.status == "scope-matched"
    assert result.corpus_matches is True
    assert result.implementation_matches is True
    assert result.build_matches is False


@pytest.mark.parametrize("section,field", [("claims", "text"), ("evidence", "title")])
def test_current_scope_detects_same_id_content_changes(current_scope, section, field):
    evaluation, reference, snapshot, settings = current_scope
    payload = snapshot.model_dump(mode="json", by_alias=True)
    payload[section][0][field]["zh"] += " changed"
    result = assess_evaluation(
        evaluation, reference, KnowledgeSnapshot.model_validate(payload), settings
    )
    assert result.status == "historical"
    assert result.corpus_matches is False
    assert result.missing_expected_claim_sample_count == 0


@pytest.mark.parametrize(
    "changes",
    [
        {"embedding_version": "changed"},
        {"embedding_dimension": 512},
        {"embedding_provider": "none"},
        {"database_url": "postgresql://localhost/test"},
    ],
)
def test_current_scope_detects_retrieval_configuration_changes(current_scope, changes):
    evaluation, reference, snapshot, settings = current_scope
    result = assess_evaluation(evaluation, reference, snapshot, replace(settings, **changes))
    assert result.status == "historical"
    assert result.retrieval_config_matches is False


def test_current_scope_detects_changed_implementation(current_scope):
    evaluation, reference, snapshot, settings = current_scope
    result = assess_evaluation(
        evaluation, {**reference, "retrievalImplementationSha256": "0" * 64}, snapshot, settings
    )
    assert result.implementation_matches is False
    assert "retrieval-implementation-changed" in result.reasons


@pytest.mark.parametrize("version", ["2", 3, None, True])
def test_unknown_fingerprint_versions_cannot_assert_current_applicability(current_scope, version):
    evaluation, reference, snapshot, settings = current_scope
    result = assess_evaluation(
        evaluation, {**reference, "fingerprintVersion": version}, snapshot, settings
    )
    assert result.status == "historical"
    assert result.corpus_matches is None


def test_current_golden_set_remains_frozen_and_grounded(monkeypatch):
    import hashlib
    from collections import Counter

    monkeypatch.syspath_prepend(str(ROOT / "scripts"))
    from eval_retrieval import load_golden_set

    path = ROOT / "docs/eval/retrieval_golden_set.v2.jsonl"
    manifest = json.loads((ROOT / "docs/eval/golden-v2-manifest.json").read_text("utf-8"))
    version, rows = load_golden_set(path)
    assert version == "2.0.0" and len(rows) == 100
    assert Counter(row["category"] for row in rows) == manifest["categories"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == manifest["goldenSetSha256"]
    snapshot_bytes = (ROOT / "docs/eval/snapshots/public_snapshot_2026-11-07.json").read_bytes()
    assert hashlib.sha256(snapshot_bytes).hexdigest() == manifest["snapshotSha256"]
    snapshot = KnowledgeSnapshot.model_validate_json(snapshot_bytes)
    claims = {claim.id: claim for claim in snapshot.claims}
    sources = {source.id for source in snapshot.evidence}
    for row in rows:
        expected = [claims[id] for id in row["expected_claim_ids"]]
        assert all(claim.confidence == "verified" for claim in expected)
        assert set(row["expected_entity_ids"]) == {claim.entity_id for claim in expected}
        assert set(row["expected_source_ids"]).issubset(sources)
        assert set(row["expected_source_ids"]) == {
            source for claim in expected for source in claim.source_ids
        }


def test_evaluator_refuses_nonlocal_or_non_test_database_before_connecting(monkeypatch):
    monkeypatch.syspath_prepend(str(ROOT / "scripts"))
    from eval_retrieval import evaluate

    snapshot = KnowledgeSnapshot.model_validate_json(
        (ROOT / "docs/eval/snapshots/public_snapshot_2026-11-07.json").read_bytes()
    )
    for url in ["postgresql://host.example/ai_radar_test", "postgresql://localhost/production"]:
        with pytest.raises(ValueError, match="isolated local"):
            evaluate(snapshot, [], top_k=8, database_url=url)


def test_hybrid_budget_preflight_matches_every_actual_index_document(monkeypatch):
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session

    from app.database import Base, RagClaimDocumentRecord
    from app.rag import LexicalRagRetriever

    monkeypatch.syspath_prepend(str(ROOT / "scripts"))
    from eval_hybrid_retrieval import build_document_texts

    snapshot = KnowledgeSnapshot.model_validate_json(
        (ROOT / "docs/eval/snapshots/public_snapshot_2026-11-07.json").read_bytes()
    )
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        LexicalRagRetriever().prepare(session, snapshot)
        indexed = list(session.scalars(select(RagClaimDocumentRecord.search_text)).all())
    preflight = build_document_texts(snapshot)
    assert sorted(preflight) == sorted(indexed)
    assert len(preflight) > 1000
    engine.dispose()


def test_hybrid_evaluation_stops_on_first_lexical_degradation(monkeypatch):
    from app.rag import LexicalRagRetriever

    monkeypatch.syspath_prepend(str(ROOT / "scripts"))
    from eval_retrieval import evaluate, load_golden_set

    class DegradedRetriever(LexicalRagRetriever):
        calls = 0

        def search(self, *args, **kwargs):
            self.calls += 1
            result = super().search(*args, **kwargs)
            result.diagnostics.fallback_reason = "hybrid-error:test"
            return result

    snapshot = KnowledgeSnapshot.model_validate_json(
        (ROOT / "docs/eval/snapshots/public_snapshot_2026-11-07.json").read_bytes()
    )
    _, samples = load_golden_set(ROOT / "docs/eval/retrieval_golden_set.v2.jsonl")
    retriever = DegradedRetriever()
    completed = []
    with pytest.raises(ValueError, match="degraded"):
        evaluate(
            snapshot,
            samples[:2],
            top_k=8,
            database_url="sqlite://",
            retriever=retriever,
            result_sink=completed,
            require_hybrid=True,
        )
    assert retriever.calls == 1
    assert len(completed) == 1
