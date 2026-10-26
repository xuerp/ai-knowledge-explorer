"""Decision workflow semantics and private validation lifecycle, using isolated fixtures."""

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import Settings
from app.database import DecisionValidationRecord, ResearchRecord
from app.engagement import EngagementService, revalidate_research
from app.main import create_app
from app.schemas import Claim, DecisionContext, KnowledgeSnapshot, ResearchCitation, ResearchView

SEED = Path(__file__).resolve().parents[1] / "data/demo_snapshot.json"


def fixture():
    snapshot = KnowledgeSnapshot.model_validate_json(SEED.read_bytes())
    family = next(entity for entity in snapshot.entities if entity.id == "e-gpt")
    concrete = family.model_copy(
        update={
            "id": "wf-version",
            "slug": "wf-version",
            "family_id": family.id,
            "release": None,
            "status": "active",
        }
    )
    snapshot.entities.append(concrete)
    source = snapshot.evidence[0]
    date = datetime.now(UTC).date().isoformat()
    source.published_at = date
    claims = [
        Claim(
            id=f"wf-{index}",
            entity_id=concrete.id,
            text={
                "zh": f"合成事实 {predicate} {value}",
                "en": f"Synthetic fact {predicate} {value}",
            },
            predicate=predicate,
            object_or_value=value,
            confidence="verified",
            source_ids=[source.id],
            valid_from=date,
            updated_at=date,
        )
        for index, (predicate, value) in enumerate(
            [
                ("deployment", "private"),
                ("context_tokens", "128000"),
                ("input_modality", "image"),
                ("commercial_use", "allowed"),
            ]
        )
    ]
    snapshot.claims = claims
    context = DecisionContext(
        task="Choose a private model for image documents",
        task_type="model-api",
        priority="quality",
        deployment="private",
        workflow_version=2,
        candidate_entity_ids=[concrete.id],
        minimum_context_tokens=100000,
        input_modalities=["image"],
        commercial_use_required=True,
    )
    return snapshot, concrete, claims, context


def test_concrete_candidate_constraints_and_no_fake_quality_coverage():
    snapshot, entity, claims, context = fixture()
    result = EngagementService._build_decision(context, claims, [entity.id], snapshot, "en")
    # Passing specs alone cannot recommend a model for an unspecified task.
    assert result.recommendation.primary_entity_id is None
    assert result.plan.state == "needs-input"
    assert not result.plan.trial_candidate_ids
    row = result.candidates[0]
    assert row.eligibility == "eligible"
    assert "task-quality" not in row.covered_dimensions
    assert set(row.covered_dimensions) == {
        "deployment",
        "context",
        "input-modalities",
        "commercial-use",
    }
    assert all(
        fact.claim_ids[0] in {claim.id for claim in claims}
        for comparison in result.comparisons
        for cell in comparison.cells
        for fact in cell.facts
    )


def test_partial_input_support_does_not_hide_the_requested_missing_modality():
    snapshot, entity, claims, context = fixture()
    context.input_modalities = ["image", "audio"]
    result = EngagementService._build_decision(context, claims, [entity.id], snapshot, "en")
    row = result.candidates[0]
    assert row.eligibility == "unknown"
    assert "input-modalities" not in row.covered_dimensions
    assert any(gap.dimension == "input-modalities" for gap in row.gaps)
    assert not result.plan.trial_candidate_ids


@pytest.mark.parametrize(
    "change,state",
    [
        ("context", "excluded"),
        ("context-conflict", "conflict"),
        ("image", "unknown"),
        ("license", "unknown"),
        ("family", "unknown"),
        ("expired", "unknown"),
        ("unavailable", "unknown"),
    ],
)
def test_candidate_dispositions_explain_ineligibility(change, state):
    snapshot, _entity, claims, context = fixture()
    if change == "context":
        claims[1].object_or_value = "8000"
    if change == "context-conflict":
        snapshot.claims.append(
            claims[1].model_copy(update={"id": "second-context", "object_or_value": "32000"})
        )
    if change == "image":
        context.input_modalities = ["video"]
    if change == "license":
        claims.pop()
    if change == "family":
        context.candidate_entity_ids = ["e-gpt"]
        for claim in claims:
            claim.entity_id = "e-gpt"
    if change == "expired":
        for claim in claims:
            claim.valid_to = "2000-01-01"
    if change == "unavailable":
        context.candidate_entity_ids = ["missing-object"]
    result = EngagementService._build_decision(
        context, snapshot.claims, context.candidate_entity_ids, snapshot, "zh"
    )
    assert not result.recommendation.primary_entity_id
    assert result.candidates[0].eligibility == state
    assert result.candidates[0].reasons


def test_revalidation_clears_new_candidate_advice_without_rewriting_history():
    snapshot, entity, claims, context = fixture()
    decision = EngagementService._build_decision(context, claims, [entity.id], snapshot, "en")
    result = ResearchView(
        id="owned",
        question=context.task,
        summary=decision.recommendation.summary,
        claim_ids=[claim.id for claim in claims],
        citations=[
            ResearchCitation(claim=claim, evidence=[snapshot.evidence[0]]) for claim in claims
        ],
        status="ready",
        steps=[],
        created_at=datetime.now(UTC),
        decision=decision,
        decision_context=context,
    )
    original = result.model_dump_json()
    snapshot.claims.pop()
    visible = revalidate_research(result, snapshot)
    assert visible.decision.candidates == []
    assert visible.decision.comparisons == []
    assert visible.decision.workflow_state == "insufficient-evidence"
    assert result.model_dump_json() == original


def test_partial_comparison_retains_known_facts_without_relaxing_a_hard_constraint():
    snapshot, entity, claims, context = fixture()
    context.region = "CN"
    result = EngagementService._build_decision(context, claims, [entity.id], snapshot, "zh")
    assert result.status == "insufficient-evidence"
    assert not result.recommendation.primary_entity_id
    assert result.candidates[0].eligibility == "unknown"
    capacity = next(row for row in result.comparisons if row.id == "context")
    assert capacity.cells[0].state == "supported"
    assert capacity.cells[0].facts[0].claim_ids == [claims[1].id]
    assert any("region" in action.dimensions for action in result.plan.actions)
    assert not any("api-price" in action.dimensions for action in result.plan.actions)
    assert set(result.claim_ids) == {claim.id for claim in claims}


@pytest.mark.parametrize(
    "change,eligible",
    [
        ("explicit", True),
        ("id-only", False),
        ("wrong-id", False),
        ("expired", False),
    ],
)
def test_official_spec_normalization_requires_explicit_current_api_evidence(change, eligible):
    snapshot, entity, claims, context = fixture()
    claim = claims[0].model_copy(
        update={
            "predicate": "official-model-specification",
            "object_or_value": "fixture-api-1; stage=stable; context=1048576",
            "text": claims[0].text.model_copy(
                update={"zh": "API 型号为 fixture-api-1，支持所列上下文。", "en": ""}
            ),
        }
    )
    if change == "id-only":
        claim.text.zh = "This product mentions API capabilities."
    if change == "wrong-id":
        claim.text.zh = "API 型号为 fixture-api-10"
    if change == "expired":
        claim.valid_to = "2000-01-01"
    snapshot.claims = [claim]
    context.deployment = "cloud-api"
    context.input_modalities = []
    context.commercial_use_required = False
    result = EngagementService._build_decision(context, [claim], [entity.id], snapshot, "en")
    assert (result.candidates[0].eligibility == "eligible") is eligible
    assert result.recommendation.primary_entity_id is None
    assert result.plan.state == "needs-input"
    if eligible:
        assert {row.id for row in result.comparisons} >= {"context", "deployment"}
        assert result.claim_ids == [claim.id]
        context_fact = (
            next(row for row in result.comparisons if row.id == "context").cells[0].facts[0]
        )
        assert context_fact.finding == "Input context: 1,048,576 tokens"


def test_cost_priority_keeps_unknown_price_visible_with_an_eligible_candidate():
    snapshot, entity, claims, context = fixture()
    context.priority = "cost"
    result = EngagementService._build_decision(context, claims, [entity.id], snapshot, "zh")
    assert result.status == "ready"
    assert result.plan.state == "needs-input"
    assert not result.recommendation.primary_entity_id
    assert any("api-price" in action.dimensions for action in result.plan.actions)
    assert all(
        cell.state == "unknown"
        for row in result.comparisons
        if row.id == "api-price"
        for cell in row.cells
    )


def test_normalized_spec_conflicts_with_a_typed_capacity():
    snapshot, entity, claims, context = fixture()
    snapshot.claims.append(
        claims[0].model_copy(
            update={
                "id": "conflicting-official-spec",
                "predicate": "official-model-specification",
                "object_or_value": "fixture-api-1; context=1048576",
            }
        )
    )
    result = EngagementService._build_decision(
        context, snapshot.claims, [entity.id], snapshot, "en"
    )
    assert result.status == "conflict"
    assert result.candidates[0].eligibility == "conflict"
    assert not result.recommendation.primary_entity_id


def test_private_poc_roundtrip_owner_isolation_revision_and_no_public_leak(tmp_path):
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'workflow.db').as_posix()}",
        seed_snapshot_path=SEED,
        cors_origins=("http://localhost:3000",),
        environment="test",
        jwt_secret="decision-workflow-isolated-test-secret-32-chars",
        admin_token="test-only-workflow-admin",
        rag_generation_enabled=False,
        embedding_provider="none",
        auto_extraction_max_snapshots_per_cycle=0,
        auto_approve_grounded_relations=False,
    )
    with TestClient(create_app(settings)) as client:
        headers = []
        for name in ("owner", "other"):
            response = client.post(
                "/api/v2/auth/register",
                json={
                    "email": f"{name}@example.com",
                    "password": "isolated workflow test password",
                },
            )
            assert response.status_code == 201
            headers.append({"Authorization": "Bearer " + response.json()["accessToken"]})
        owner, other = headers
        research = client.post(
            "/api/v2/research",
            headers=owner,
            json={
                "question": "Choose GPT with current evidence",
                "language": "en",
                "decisionContext": {
                    "workflowVersion": 2,
                    "task": "Choose GPT with current evidence",
                    "taskType": "model-api",
                    "priority": "quality",
                    "deployment": "undecided",
                    "candidateEntityIds": ["e-gpt"],
                },
            },
        )
        assert research.status_code == 200, research.text
        data = research.json()
        assert data["answerMode"] == "extractive"
        assert data["decision"]["candidates"][0]["eligibility"] == "unknown"
        assert data["decision"]["recommendation"]["primaryEntityId"] is None
        assert data["decision"]["plan"]["state"] == "needs-input"
        assert data["decision"]["plan"]["trialCandidateIds"] == []
        assert data["decision"]["plan"]["actions"][0]["unlocks"]
        guidance = data["decision"]["guidance"]
        action = data["decision"]["plan"]["actions"][0]
        assert action["title"] == guidance["clarification"]["question"]
        assert action["instruction"] == guidance["nextAction"]["instruction"]
        assert action["unlocks"] == guidance["clarification"]["reason"]
        route = f"/api/v2/research/{data['id']}/validation"
        preflight = client.options(
            route,
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "PUT",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        assert preflight.status_code == 200
        assert "PUT" in preflight.headers["access-control-allow-methods"]
        assert client.get(route).status_code == 401
        assert client.get(route, headers=other).status_code == 404
        assert client.get(route, headers=owner).json()["revision"] == 0
        with client.app.state.database.session() as session:
            original = session.scalar(
                select(ResearchRecord).where(ResearchRecord.id == data["id"])
            ).decision_json
        body = {
            "expectedRevision": 0,
            "items": [
                {
                    "id": "latency",
                    "candidateId": "e-gpt",
                    "title": "Synthetic latency test",
                    "status": "passed",
                    "result": "Synthetic fixture: 10 requests, local fixture, P95 2s. Not a real model measurement.",
                }
            ],
        }
        saved = client.put(route, headers=owner, json=body)
        assert saved.status_code == 200, saved.text
        assert saved.json()["revision"] == 1
        review = saved.json()["review"]
        assert review["sourceRevision"] == 1 and review["basis"] == "user-records"
        assert review["candidates"][0]["requiredChecks"] == 4
        assert review["candidates"][0]["completedChecks"] == 0
        assert review["candidates"][0]["checks"][1]["reason"] == "conditions-missing"
        assert review["comparableGroups"] == []
        assert saved.json()["updatedAt"].endswith("Z")
        assert client.get(route, headers=owner).json()["items"] == body["items"]
        assert client.get(route, headers=owner).json()["review"] == review
        assert client.put(route, headers=owner, json=body).status_code == 409
        assert (
            client.put(route, headers=other, json={**body, "expectedRevision": 1}).status_code
            == 404
        )
        invalid = {
            **body,
            "expectedRevision": 1,
            "items": [{**body["items"][0], "candidateId": "not-in-this-decision"}],
        }
        assert client.put(route, headers=owner, json=invalid).status_code == 422
        empty = {**body, "expectedRevision": 1, "items": [{**body["items"][0], "result": ""}]}
        assert client.put(route, headers=owner, json=empty).status_code == 422
        with client.app.state.database.session() as session:
            assert session.get(ResearchRecord, data["id"]).decision_json == original
            assert session.get(ResearchRecord, data["id"]).published_slug is None
        current = client.get(f"/api/v2/research/{data['id']}", headers=owner).json()
        assert "Synthetic latency test" not in json.dumps(current)


def test_validation_migration_preserves_research_and_rolls_back_only_new_table(
    tmp_path, monkeypatch
):
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import create_engine, inspect, text

    root = Path(__file__).resolve().parents[1]
    database_url = f"sqlite:///{(tmp_path / 'migration.db').as_posix()}"
    monkeypatch.setenv("AI_RADAR_DATABASE_URL", database_url)
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "migrations"))
    command.upgrade(config, "20261002_0024")
    engine = create_engine(database_url)
    with engine.begin() as connection:
        connection.execute(
            ResearchRecord.__table__.insert().values(
                id="history",
                user_id="fixture",
                question="Synthetic migration research",
                summary="Preserve historical research",
                status="insufficient-evidence",
                created_at=datetime.now(UTC),
            )
        )
        before = connection.execute(text("select * from research_records")).all()
    command.upgrade(config, "20261009_0025")
    assert {
        column["name"] for column in inspect(engine).get_columns("decision_validations")
    } == set(DecisionValidationRecord.__table__.columns.keys())
    with engine.connect() as connection:
        assert connection.scalar(text("select version_num from alembic_version")) == "20261009_0025"
        assert connection.execute(text("select * from research_records")).all() == before
    command.downgrade(config, "20261002_0024")
    assert "decision_validations" not in inspect(engine).get_table_names()
    with engine.connect() as connection:
        assert connection.execute(text("select * from research_records")).all() == before
    engine.dispose()
