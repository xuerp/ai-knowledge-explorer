import hashlib
import json
from pathlib import Path

import pytest

from app.decision_candidates import described_features
from app.decision_comparison import build_comparisons
from app.decision_facts import normalized_facts
from app.decision_intake import prepare_decision_intake
from app.repository import KnowledgeRepository
from app.schemas import DecisionContext, DecisionScenario

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def intake(tmp_path):
    snapshot = KnowledgeRepository(ROOT / "backend/data/demo_snapshot.json").load_seed()
    body = "July 15, 2026\nTools modify repository content under explicit user permissions."
    path = tmp_path / "artifacts/decision-source-refresh/source.txt"
    path.parent.mkdir(parents=True)
    path.write_text(body, encoding="utf-8")
    captures = [
        {
            "key": "source",
            "url": "https://openai.com/example",
            "status": "succeeded",
            "contentPath": str(path.relative_to(tmp_path)),
            "contentSha256": hashlib.sha256(body.encode()).hexdigest(),
            "observedAt": "2026-10-10T15:00:00Z",
            "publicationDate": None,
        }
    ]
    drafts = [
        {
            "sourceKey": "source",
            "entityId": "e-codex",
            "predicate": "workflow-feature",
            "value": "file-editing",
            "zh": "明确描述编辑文件功能。",
            "en": "Modifies repository content.",
            "sourceExcerpt": "Tools modify repository content under explicit user permissions.",
            "sourceTitle": "Official documentation",
            "publisher": "OpenAI",
        }
    ]
    return tmp_path, snapshot, captures, drafts


def test_capture_dates_and_source_integrity_are_independent_of_observation(intake):
    root, _snapshot, captures, _drafts = intake
    candidate = prepare_decision_intake(*intake)[0]
    assert candidate.claim.confidence == "unverified"
    assert candidate.claim.valid_from is None
    assert candidate.evidence[0].published_at == ""
    captures[0].update(publicationDate="2026-07-15", publicationDateExcerpt="July 15, 2026")
    assert prepare_decision_intake(*intake)[0].claim.valid_from == "2026-07-15"
    captures[0]["publicationDate"] = "2026-10-10"
    with pytest.raises(ValueError, match="unsupported"):
        prepare_decision_intake(*intake)
    captures[0]["publicationDate"] = None
    (root / captures[0]["contentPath"]).write_text("Changed source content", encoding="utf-8")
    with pytest.raises(ValueError, match="hash"):
        prepare_decision_intake(*intake)


def test_new_concrete_model_page_requires_exact_alias_in_path_and_body(intake):
    root, snapshot, captures, drafts = intake
    source = captures[0]
    model = next(e for e in snapshot.entities if e.id == "e-gemini-3-8-flash")
    body = "gemini-3.8-flash\nStructured outputs\nSupported"
    path = root / source["contentPath"]
    path.write_text(body, encoding="utf-8")
    source.update(
        url="https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash",
        contentSha256=hashlib.sha256(body.encode()).hexdigest(),
    )
    drafts[0].update(
        entityId=model.id,
        predicate="workflow-feature",
        value="structured-output",
        sourceExcerpt="Structured outputs\nSupported",
    )
    candidate = prepare_decision_intake(*intake)[0]
    assert candidate.claim.confidence == "unverified" and candidate.claim.valid_from is None
    source["url"] = "https://ai.google.dev/gemini-api/docs/structured-output"
    with pytest.raises(ValueError, match="specific product"):
        prepare_decision_intake(*intake)
    source["url"] = "https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview"
    with pytest.raises(ValueError, match="specific product"):
        prepare_decision_intake(*intake)


@pytest.mark.parametrize(
    "change,error",
    [
        ({"sourceExcerpt": "Invented quoted evidence"}, "verbatim"),
        ({"predicate": "context_tokens", "value": "2000000"}, "model specs"),
        ({"predicate": "product-entry", "value": '["cloud-api"]'}, "entry points"),
        ({"entityId": "e-gpt"}, "coding product"),
    ],
)
def test_workflow_intake_does_not_assert_model_capacity_or_api_access(intake, change, error):
    intake[3][0].update(change)
    with pytest.raises(ValueError, match=error):
        prepare_decision_intake(*intake)


def test_intake_rejects_failed_capture_path_escape_and_duplicate_facts(intake):
    captures, drafts = intake[2:]
    captures[0]["status"] = "failed"
    with pytest.raises(ValueError, match="failed"):
        prepare_decision_intake(*intake)
    captures[0]["status"] = "succeeded"
    captures[0]["contentPath"] = "../source.txt"
    with pytest.raises(ValueError, match="outside"):
        prepare_decision_intake(*intake)
    captures[0]["contentPath"] = "artifacts/decision-source-refresh/source.txt"
    drafts.append(dict(drafts[0]))
    with pytest.raises(ValueError, match="Duplicate fact"):
        prepare_decision_intake(*intake)


def test_reviewed_entry_points_compare_without_proving_cloud_api(intake):
    drafts = intake[3]
    drafts[0].update(predicate="product-entry", value=json.dumps(["terminal", "cloud-task"]))
    claim = prepare_decision_intake(*intake)[0].claim.model_copy(update={"confidence": "verified"})
    assert {fact.dimension for fact in normalized_facts(claim)} == {"product-entry"}
    context = DecisionContext(
        workflow_version=2,
        task="Choose a coding product",
        priority="quality",
        deployment="undecided",
    )
    rows, ids = build_comparisons(context, ["e-codex"], {"e-codex": [claim]}, "en")
    entry = next(row for row in rows if row.id == "product-entry")
    assert entry.cells[0].facts[0].claim_ids == [claim.id]
    assert claim.id in ids


def test_explicit_feature_keeps_source_id_and_rejects_contradictory_prose(intake):
    claim = prepare_decision_intake(*intake)[0].claim.model_copy(update={"confidence": "verified"})
    scene = DecisionScenario(
        id="coding-workspace", name="Coding", required_features=["file-editing"]
    )
    facts = described_features([claim], scene, "en")
    assert facts[0].claim_ids == [claim.id]
    contradicted = claim.model_copy(
        update={
            "text": claim.text.model_copy(
                update={"zh": "不支持编辑文件", "en": "Cannot modify repository content"}
            )
        }
    )
    assert described_features([contradicted], scene, "en") == []


def test_typed_workflow_fact_cannot_infer_other_features_from_its_boundary_note(intake):
    claim = prepare_decision_intake(*intake)[0].claim
    claim.text.en = "File editing; this is not an executed test or quality benchmark."
    scene = DecisionScenario(
        name="Coding", required_features=["file-editing", "test-execution", "tool-use"]
    )
    assert [f.dimension for f in described_features([claim], scene, "en")] == ["file-editing"]


def test_mentions_of_documentation_and_function_calling_do_not_establish_extraction(intake):
    claim = prepare_decision_intake(*intake)[0].claim
    claim.predicate = "catalog-review"
    claim.text.zh = ""
    claim.text.en = "README file documents the release date. Supports function calling."
    scene = DecisionScenario(
        name="Extract", required_features=["document-input", "structured-output"]
    )
    assert described_features([claim], scene, "en") == []


@pytest.mark.parametrize(
    "entity,host,predicate,value",
    [
        ("e-gemini-3-1-pro", "ai.google.dev", "workflow-feature", "structured-output"),
        ("e-gemini-3-1-pro", "ai.google.dev", "input_modality", "image"),
        ("e-langgraph", "docs.langchain.com", "workflow-feature", "human-approval"),
    ],
)
def test_specific_model_and_framework_sources_prepare_unverified_facts(
    intake, entity, host, predicate, value
):
    intake[2][0]["url"] = "https://" + host + "/official"
    intake[3][0].update(entityId=entity, predicate=predicate, value=value)
    candidate = prepare_decision_intake(*intake)[0]
    assert candidate.entity_id == entity and candidate.claim.confidence == "unverified"
    assert candidate.claim.valid_from is None and candidate.evidence[0].published_at == ""
    intake[3][0]["entityId"] = "e-codex"
    with pytest.raises(ValueError, match="specific product"):
        prepare_decision_intake(*intake)


def test_living_input_support_requires_current_review_and_never_dates_specs(intake):
    from datetime import UTC, datetime, timedelta

    from app.decision_constraints import current_claims

    _root, snapshot, captures, drafts = intake
    captures[0]["url"] = "https://ai.google.dev/official"
    drafts[0].update(entityId="e-gemini-3-1-pro", predicate="input_modality", value="image")
    candidate = prepare_decision_intake(*intake)[0]
    snapshot.claims, snapshot.evidence = [candidate.claim], candidate.evidence
    source = snapshot.evidence[0]
    now = datetime.now(UTC)
    source.verified_at = now.isoformat()
    assert current_claims(snapshot.claims, snapshot) == []
    candidate.claim.confidence = "verified"
    assert current_claims(snapshot.claims, snapshot) == [candidate.claim]
    source.verified_at = (now - timedelta(days=91)).isoformat()
    assert current_claims(snapshot.claims, snapshot) == []
    source.verified_at = now.isoformat()
    for predicate in (
        "context_tokens",
        "api_price",
        "official-model-specification",
        "commercial_use",
    ):
        candidate.claim.predicate = predicate
        assert current_claims(snapshot.claims, snapshot) == []


def test_specific_document_input_fact_preserves_cited_input_modes(intake):
    claim = prepare_decision_intake(*intake)[0].claim
    claim.object_or_value = "document-input"
    claim.text.zh = "指定型号页列出 PDF、图像和文本输入；准确性尚未实测。"
    claim.text.en = "The specific model lists PDF, image and text inputs; accuracy is unmeasured."
    facts = normalized_facts(claim)
    assert {(f.dimension, f.value) for f in facts} == {
        ("input-modalities", "image"),
        ("input-modalities", "text"),
    }
    assert all(f.claim_id == claim.id for f in facts)
    claim.text.zh = "不支持图像输入。"
    claim.text.en = "Image inputs are unsupported."
    assert normalized_facts(claim) == []


def test_each_fact_keeps_its_own_quote_and_account_qualification(intake):
    drafts = intake[3]
    drafts.append(
        dict(
            drafts[0],
            predicate="workflow-qualification",
            value="account-tier",
            sourceExcerpt="explicit user permissions.",
        )
    )
    candidates = prepare_decision_intake(*intake)
    assert candidates[0].evidence[0].id != candidates[1].evidence[0].id
    qualification = candidates[1].claim
    assert normalized_facts(qualification)[0].dimension == "workflow-qualification"
    context = DecisionContext(
        workflow_version=2,
        task="Choose a coding product",
        priority="quality",
        deployment="undecided",
    )
    rows, _ = build_comparisons(context, ["e-codex"], {"e-codex": [qualification]}, "en")
    assert next(row for row in rows if row.id == "workflow-qualification").cells[0].facts[
        0
    ].claim_ids == [qualification.id]


@pytest.mark.parametrize("dated", [True, False])
def test_pending_review_approval_and_withdrawal_change_decisions_only_after_publication(
    intake, tmp_path, dated
):
    """Synthetic API proof; this does not approve the real captured source pack."""
    from fastapi.testclient import TestClient

    from app.config import Settings
    from app.main import create_app

    _root, snapshot, captures, drafts = intake
    if dated:
        captures[0].update(publicationDate="2026-07-15", publicationDateExcerpt="July 15, 2026")
    drafts[0].update(predicate="product-entry", value=json.dumps(["terminal"]))
    candidate = prepare_decision_intake(*intake)[0]
    snapshot.claims = [claim for claim in snapshot.claims if claim.entity_id != "e-codex"]
    seed = tmp_path / "isolated-seed.json"
    seed.write_text(snapshot.model_dump_json(by_alias=True), encoding="utf-8")
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'intake.db').as_posix()}",
        seed_snapshot_path=seed,
        cors_origins=("http://localhost:3000",),
        environment="test",
        jwt_secret="intake-isolated-test-secret-over-32-chars",
        admin_token="intake-test-only-admin",
        embedding_provider="none",
        rag_generation_enabled=False,
        auto_extraction_max_snapshots_per_cycle=0,
        auto_approve_grounded_relations=False,
    )
    with TestClient(create_app(settings)) as client:
        admin = {"X-Admin-Token": "intake-test-only-admin"}
        auth = client.post(
            "/api/v2/auth/register",
            json={"email": "intake@example.com", "password": "isolated intake workflow password"},
        )
        assert auth.status_code == 201
        owner = {"Authorization": "Bearer " + auth.json()["accessToken"]}
        before = client.get("/api/v2/snapshot").json()
        queued = client.post(
            "/api/v2/admin/review-candidates",
            headers=admin,
            json=candidate.model_dump(mode="json", by_alias=True),
        )
        assert queued.status_code == 201, queued.text
        item = queued.json()
        pending = client.get("/api/v2/snapshot").json()
        assert pending["claims"] == before["claims"]
        assert pending["evidence"] == before["evidence"]
        approved = client.post(
            f"/api/v2/admin/review-queue/{item['id']}/approve",
            headers=admin,
            json={
                "expectedVersion": item["version"],
                "reason": "Synthetic reviewer checks the fixture quotation.",
            },
        )
        assert approved.status_code == 200, approved.text
        result = client.post(
            "/api/v2/research",
            headers=owner,
            json={
                "question": "Select Codex to edit files and run tests",
                "language": "en",
                "decisionContext": {
                    "workflowVersion": 2,
                    "task": "Select Codex to edit files and run tests",
                    "taskType": "coding-product",
                    "priority": "quality",
                    "deployment": "undecided",
                    "candidateEntityIds": ["e-codex"],
                },
            },
        )
        assert result.status_code == 200, result.text
        data = result.json()
        rows = data["decision"]["comparisons"]
        facts = next(row for row in rows if row["id"] == "product-entry")["cells"][0]["facts"]
        assert any(candidate.claim.id in fact["claimIds"] for fact in facts)
        assert data["decision"]["recommendation"]["primaryEntityId"] is None
        withdrawn = client.post(
            f"/api/v2/admin/review-queue/{item['id']}/publication-state",
            headers=admin,
            json={
                "expectedVersion": approved.json()["version"],
                "action": "retract",
                "reason": "Synthetic fixture source withdrawn.",
            },
        )
        assert withdrawn.status_code == 200, withdrawn.text
        reopened = client.get(f"/api/v2/research/{data['id']}", headers=owner)
        assert reopened.status_code == 200, reopened.text
        remaining = [
            claim_id
            for row in reopened.json()["decision"]["comparisons"]
            for cell in row["cells"]
            for fact in cell["facts"]
            for claim_id in fact["claimIds"]
        ]
        assert candidate.claim.id not in remaining


def test_partial_workflow_support_does_not_choose_a_primary(intake):
    from app.engagement import EngagementService

    _root, snapshot, captures, _drafts = intake
    captures[0].update(publicationDate="2026-07-15", publicationDateExcerpt="July 15, 2026")
    candidate = prepare_decision_intake(*intake)[0]
    claim = candidate.claim.model_copy(update={"confidence": "verified"})
    snapshot.claims = [claim]
    snapshot.evidence = candidate.evidence
    context = DecisionContext(
        workflow_version=2,
        task="Edit files in the repository and run tests",
        task_type="coding-product",
        priority="quality",
        deployment="undecided",
        candidate_entity_ids=["e-codex"],
    )
    result = EngagementService._build_decision(context, [claim], ["e-codex"], snapshot, "en")
    assert any(finding.dimension == "file-editing" for finding in result.candidates[0].strengths)
    assert any(gap.dimension == "test-execution" for gap in result.candidates[0].gaps)
    assert result.recommendation.primary_entity_id is None
    assert result.recommendation.basis == "comparison-only"


def test_workflow_shortlist_does_not_mislabel_multiple_eligible_candidates(intake):
    from app.engagement import EngagementService

    _root, snapshot, captures, _drafts = intake
    captures[0].update(publicationDate="2026-07-15", publicationDateExcerpt="July 15, 2026")
    candidate = prepare_decision_intake(*intake)[0]
    partial = candidate.claim.model_copy(update={"confidence": "verified"})
    complete = partial.model_copy(
        update={
            "id": "synthetic-complete-workflow",
            "entity_id": "e-claude-code",
            "predicate": "capability",
            "text": partial.text.model_copy(
                update={
                    "zh": "合成测试资料：支持代码编辑、工具调用、编辑文件、运行测试。",
                    "en": "Synthetic fixture: code editing, tool use, edit files and run tests.",
                }
            ),
        }
    )
    snapshot.claims = [partial, complete]
    snapshot.evidence = candidate.evidence
    context = DecisionContext(
        workflow_version=2,
        task="Edit files in the repository and run tests",
        task_type="coding-product",
        priority="quality",
        deployment="undecided",
        candidate_entity_ids=["e-codex", "e-claude-code"],
    )
    result = EngagementService._build_decision(
        context, [partial, complete], context.candidate_entity_ids, snapshot, "en"
    )
    assert all(row.eligibility == "eligible" for row in result.candidates)
    assert result.recommendation.primary_entity_id == "e-claude-code"
    assert result.recommendation.basis == "validation-sequence"
    assert "Validate" in result.recommendation.summary


def test_specific_workflow_requires_both_features_without_generic_evidence_count_bias(intake):
    from app.decision_candidates import interpret_scenario
    from app.engagement import EngagementService

    _root, snapshot, captures, _drafts = intake
    captures[0].update(publicationDate="2026-07-15", publicationDateExcerpt="July 15, 2026")
    original = prepare_decision_intake(*intake)[0]
    claims = [
        original.claim.model_copy(
            update={
                "id": "synthetic-workflow-" + entity,
                "entity_id": entity,
                "confidence": "verified",
                "text": original.claim.text.model_copy(
                    update={
                        "zh": "合成测试资料：编辑文件、运行测试；仍须用户审批。",
                        "en": "Synthetic fixture: edit files and run tests; user approvals still apply.",
                    }
                ),
            }
        )
        for entity in ["e-codex", "e-claude-code"]
    ]
    snapshot.claims, snapshot.evidence = claims, original.evidence
    context = DecisionContext(
        workflow_version=2,
        task="编辑文件、运行测试",
        task_type="coding-product",
        priority="quality",
        deployment="undecided",
        candidate_entity_ids=["e-codex", "e-claude-code"],
    )
    assert interpret_scenario(context, "zh").required_features == ["file-editing", "test-execution"]
    result = EngagementService._build_decision(
        context, claims, context.candidate_entity_ids, snapshot, "zh"
    )
    assert all(row.eligibility == "eligible" for row in result.candidates)
    assert result.recommendation.primary_entity_id is None
    assert result.recommendation.basis == "comparison-only"


def test_recent_review_can_date_workflow_documentation_without_inventing_publication(intake):
    from datetime import UTC, datetime, timedelta

    from app.decision_constraints import current_claims

    _root, snapshot, _captures, _drafts = intake
    candidate = prepare_decision_intake(*intake)[0]
    claim = candidate.claim.model_copy(update={"confidence": "verified"})
    snapshot.claims = [claim]
    snapshot.evidence = candidate.evidence
    evidence = snapshot.evidence[0]
    now = datetime.now(UTC)
    # Collection alone never proves an undated fact.
    assert current_claims([claim], snapshot) == []
    evidence.verified_at = now.isoformat()
    assert current_claims([claim], snapshot) == [claim]
    assert evidence.published_at == "" and claim.valid_from is None
    for verified_at in (
        "invalid",
        (now + timedelta(days=1)).isoformat(),
        (now - timedelta(days=91)).isoformat(),
    ):
        evidence.verified_at = verified_at
        assert current_claims([claim], snapshot) == []
    evidence.verified_at = now.isoformat()
    for predicate in ("api_price", "context_tokens", "deployment"):
        claim.predicate = predicate
        assert current_claims([claim], snapshot) == []
    claim.predicate = "workflow-feature"
    evidence.source_excerpt = ""
    assert current_claims([claim], snapshot) == []


def test_undated_workflow_remains_pending_until_review_and_pending_dates_do_not_leak(intake):
    from datetime import UTC, datetime

    from app.decision_constraints import current_claims

    _root, snapshot, _captures, _drafts = intake
    candidate = prepare_decision_intake(*intake)[0]
    snapshot.claims = [candidate.claim]
    snapshot.evidence = candidate.evidence
    snapshot.evidence[0].verified_at = datetime.now(UTC).isoformat()
    assert current_claims(snapshot.claims, snapshot) == []


def test_cheap_partial_workflow_cannot_become_a_cost_primary(intake):
    from app.engagement import EngagementService

    _root, snapshot, captures, _drafts = intake
    captures[0].update(publicationDate="2026-07-15", publicationDateExcerpt="July 15, 2026")
    candidate = prepare_decision_intake(*intake)[0]
    first = candidate.claim.model_copy(update={"confidence": "verified"})
    second = first.model_copy(update={"id": "second-feature", "entity_id": "e-claude-code"})
    prices = [
        feature.model_copy(
            update={
                "id": f"price-{index}",
                "predicate": "api_price",
                "object_or_value": json.dumps(
                    {
                        "input": index + 1,
                        "output": index + 1,
                        "currency": "USD",
                        "channel": "official",
                        "unit": "per-million-tokens",
                    }
                ),
            }
        )
        for index, feature in enumerate([first, second])
    ]
    snapshot.claims = [first, second, *prices]
    snapshot.evidence = candidate.evidence
    context = DecisionContext(
        workflow_version=2,
        task="Edit files in the repository and run tests",
        task_type="coding-product",
        priority="cost",
        deployment="undecided",
        candidate_entity_ids=["e-codex", "e-claude-code"],
    )
    result = EngagementService._build_decision(
        context, snapshot.claims, context.candidate_entity_ids, snapshot, "en"
    )
    assert result.recommendation.primary_entity_id is None
    assert result.recommendation.basis == "comparison-only"
    assert "price alone" in result.recommendation.summary
