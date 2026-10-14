"""Isolated synthetic API data; never supplier measurements or public facts."""

from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.database import ResearchRecord
from app.decision_validation import validation_view
from app.main import create_app
from app.schemas import Claim, KnowledgeSnapshot


def test_numeric_records_roundtrip_current_source_guard_and_immutable_research(tmp_path):
    snapshot = KnowledgeSnapshot.model_validate_json(
        (Path(__file__).resolve().parents[1] / "data/demo_snapshot.json").read_bytes()
    )
    template = next(row for row in snapshot.entities if row.id == "e-gpt")
    date = datetime.now(UTC).date().isoformat()
    snapshot.evidence[0].published_at = date
    ids = ["numeric-a", "numeric-b"]
    snapshot.claims = []
    snapshot.review_candidates = []
    for key in ids:
        snapshot.entities.append(
            template.model_copy(
                update={
                    "id": key,
                    "slug": key,
                    "family_id": "e-gpt",
                    "release": None,
                    "status": "active",
                    "summary": template.summary.model_copy(
                        update={"zh": "合成文本生成模型", "en": "Synthetic text generation model"}
                    ),
                    "name": template.name.model_copy(
                        update={"zh": "合成模型" + key, "en": "Synthetic model " + key}
                    ),
                }
            )
        )
        snapshot.claims.append(
            Claim(
                id=key + "-claim",
                entity_id=key,
                predicate="workflow-feature",
                object_or_value="text-generation",
                text={
                    "zh": "合成文本生成描述，不是产品测量。",
                    "en": "Synthetic text generation description, not a product measurement.",
                },
                confidence="verified",
                source_ids=[snapshot.evidence[0].id],
                valid_from=date,
                updated_at=date,
            )
        )
    seed = tmp_path / "snapshot.json"
    seed.write_text(snapshot.model_dump_json(by_alias=True), "utf-8")
    settings = Settings(
        database_url="sqlite:///" + (tmp_path / "isolated.db").as_posix(),
        seed_snapshot_path=seed,
        admin_token="fixture-review-token",
        jwt_secret="isolated-measurements-secret-not-production",
        cors_origins=("http://localhost",),
        environment="test",
    )
    with TestClient(create_app(settings)) as client:
        account = client.post(
            "/api/v2/auth/register",
            json={
                "email": "measure-fixture@example.com",
                "password": "isolated-fixture-only-password",
            },
        ).json()
        headers = {"Authorization": "Bearer " + account["accessToken"]}
        response = client.post(
            "/api/v2/research",
            headers=headers,
            json={
                "question": "客服对话与文本生成，成本优先",
                "decisionContext": {
                    "workflowVersion": 2,
                    "task": "客服对话与文本生成，成本优先",
                    "taskType": "model-api",
                    "priority": "cost",
                    "deployment": "undecided",
                    "candidateEntityIds": ids,
                },
            },
        )
        assert response.status_code == 200, response.text
        record = response.json()
        assert set(record["decision"]["plan"]["trialCandidateIds"]) == set(ids)
        with client.app.state.database.session() as session:
            original = session.get(ResearchRecord, record["id"]).decision_json
        items = []
        for key, cost in zip(ids, (4, 2), strict=True):
            for dimension in ("quality", "terms", "cost"):
                row = {
                    "id": key + "-" + dimension,
                    "candidateId": key,
                    "title": "Synthetic software acceptance fixture",
                    "status": "passed",
                    "result": "Synthetic fixture only; not a product test or bill.",
                    "testConditions": {
                        "modelVersion": "fixture-version-" + key,
                        "configuration": "same fixture config",
                        "sampleCount": 12,
                        "testedAt": date,
                        "scope": "same 12 synthetic cases",
                    },
                }
                if dimension == "cost":
                    row["measurements"] = {
                        "totalCost": cost,
                        "currency": "USD",
                        "costBasis": "actual-charge",
                        "sourceNote": "Synthetic fixture receipt, not an actual supplier charge",
                    }
                items.append(row)
        route = f"/api/v2/research/{record['id']}/validation"
        saved = client.put(route, headers=headers, json={"expectedRevision": 0, "items": items})
        assert saved.status_code == 200, saved.text
        view = saved.json()
        assert view["review"]["conclusion"]["trialCandidateIds"] == ["numeric-b"]
        assert view["review"]["conclusion"]["measuredChoices"][0]["values"] == {
            "numeric-a": 4,
            "numeric-b": 2,
        }
        assert client.get(route, headers=headers).json()["items"] == view["items"]
        assert (
            client.put(
                route, headers=headers, json={"expectedRevision": 0, "items": items}
            ).status_code
            == 409
        )
        with client.app.state.database.session() as session:
            public = client.app.state.repository.public_snapshot(session)
            public.claims = [claim for claim in public.claims if claim.id not in record["claimIds"]]
            withdrawn = validation_view(session, record["id"], account["user"]["id"], public)
            assert withdrawn.items and withdrawn.revision == 1
            assert not withdrawn.review.conclusion.trial_candidate_ids
            assert not withdrawn.review.conclusion.measured_choices
            assert session.get(ResearchRecord, record["id"]).decision_json == original
