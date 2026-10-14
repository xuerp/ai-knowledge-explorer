"""Software fixtures only: maintenance receipts must not become product evidence."""

import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.config import Settings
from app.database import DecisionEvidenceRequestRecord, EntryRequestRecord, ResearchRecord
from app.main import create_app
from app.schemas import Claim, Evidence, KnowledgeSnapshot


def test_source_routing_uses_the_requested_service_and_never_forwards_unknown_private_channels():
    from app.decision_evidence_requests import public_source_reference
    from app.schemas import DecisionContext

    context = DecisionContext(
        task="合成路由测试",
        priority="quality",
        deployment="cloud-api",
        service_access={"channel": "CCSub", "tier": "paid", "region": "US"},
        budget={"mode": "range", "channel": "Google Gemini Developer API"},
    )
    commercial = public_source_reference(context, ["commercial-use"])
    price = public_source_reference(context, ["api-price"])
    assert commercial[1] == "https://www.ccsub.net/zh/terms-of-service"
    assert "归属仍须核对" in commercial[0]
    assert price[1] == "https://ai.google.dev/gemini-api/docs/pricing"
    context.service_access.channel = "https://private.internal/customer-secret?key=secret"
    context.budget.channel = "private-finance-provider-marker"
    assert public_source_reference(context, ["commercial-use"]) is None
    assert public_source_reference(context, ["api-price"]) is None


def test_gap_requests_owner_isolation_idempotency_privacy_and_review_do_not_qualify(tmp_path):
    snapshot = KnowledgeSnapshot.model_validate_json(
        (Path(__file__).resolve().parents[1] / "data/demo_snapshot.json").read_bytes()
    )
    today = datetime.now(UTC).date().isoformat()
    entity = next(row for row in snapshot.entities if row.id == "e-gpt").model_copy(
        update={
            "id": "gap-fixture",
            "slug": "gap-fixture",
            "family_id": "e-gpt",
            "release": None,
        }
    )
    # model_copy does not coerce nested names; retain typed localized values.
    entity.name = next(row for row in snapshot.entities if row.id == "e-gpt").name.model_copy(
        update={"zh": "资料补充测试对象", "en": "Evidence maintenance fixture"}
    )
    snapshot.entities.append(entity)
    snapshot.evidence = [
        Evidence(
            id="gap-source",
            title={"zh": "合成来源", "en": "Synthetic source"},
            url="https://example.test/model-fixture",
            publisher="Software fixture",
            published_at=today,
            collected_at=today,
            type="official",
        )
    ]
    snapshot.claims = [
        Claim(
            id="gap-claim",
            entity_id=entity.id,
            predicate="workflow-feature",
            object_or_value="text-generation",
            confidence="verified",
            source_ids=["gap-source"],
            text={
                "zh": "合成文本生成说明，非供应商成绩。",
                "en": "Synthetic text-generation description, not supplier performance.",
            },
            updated_at=today,
            valid_from=today,
        )
    ]
    snapshot.review_candidates = []
    seed = tmp_path / "seed.json"
    seed.write_text(snapshot.model_dump_json(by_alias=True), "utf-8")
    settings = Settings(
        database_url="sqlite:///" + (tmp_path / "fixture.db").as_posix(),
        seed_snapshot_path=seed,
        admin_token="fixture-admin-token",
        jwt_secret="isolated-gap-test-secret-not-production",
        environment="test",
        cors_origins=("http://localhost",),
    )
    with TestClient(create_app(settings)) as client:

        def headers(email):
            response = client.post(
                "/api/v2/auth/register", json={"email": email, "password": "fixture-only-password"}
            )
            assert response.status_code == 201
            return {"Authorization": "Bearer " + response.json()["accessToken"]}

        owner, other = headers("owner@example.com"), headers("other@example.com")
        private_marker = "private-task-marker-do-not-share"
        body = {
            "question": "客服对话与文本生成 " + private_marker,
            "decisionContext": {
                "workflowVersion": 2,
                "task": "客服对话与文本生成 " + private_marker,
                "priority": "quality",
                "deployment": "undecided",
                "taskType": "model-api",
                "minimumContextTokens": 2000000,
                "candidateEntityIds": [entity.id],
            },
        }
        response = client.post("/api/v2/research", headers=owner, json=body)
        assert response.status_code == 200, response.text
        research = response.json()
        assert research["decision"]["plan"]["state"] == "needs-evidence"
        path = f"/api/v2/research/{research['id']}/evidence-requests"
        original_public = client.get("/api/v2/snapshot").json()
        with client.app.state.database.session() as session:
            original_private = session.get(ResearchRecord, research["id"]).decision_json
        payload = {"requestId": str(uuid4()), "candidateId": entity.id}
        assert client.post(path, headers=other, json=payload).status_code == 404
        assert client.get(path, headers=other).status_code == 404
        assert client.get(path).status_code == 401
        assert (
            client.post(path, headers=owner, json={**payload, "candidateId": "outside"}).status_code
            == 422
        )

        requested = client.post(path, headers=owner, json=payload)
        assert requested.status_code == 201, requested.text
        receipt = requested.json()
        assert receipt["status"] == "pending" and "context" in receipt["dimensions"]
        assert private_marker not in json.dumps(receipt)

        def stable(value):
            return {key: item for key, item in value.items() if key != "checkedAt"}

        assert receipt["verificationState"] == "awaiting-evidence"
        assert receipt["remainingDimensions"] == ["context"]
        assert stable(client.post(path, headers=owner, json=payload).json()) == stable(receipt)
        assert stable(
            client.post(path, headers=owner, json={**payload, "requestId": str(uuid4())}).json()
        ) == stable(receipt)
        assert [stable(row) for row in client.get(path, headers=owner).json()] == [stable(receipt)]
        admin = {"X-Admin-Token": settings.admin_token}
        queue = client.get("/api/v2/admin/entry-requests", headers=admin).json()
        row = next(row for row in queue if row["id"] == receipt["id"])
        assert private_marker not in json.dumps(row) and research["id"] not in json.dumps(row)
        assert (
            "context" in row["reason"] and row["sourceUrl"] == "https://example.test/model-fixture"
        )
        resolved = client.patch(
            f"/api/v2/admin/entry-requests/{receipt['id']}",
            headers=admin,
            json={
                "status": "resolved",
                "version": row["version"],
                "reviewerNote": "Synthetic request processed, no product facts added.",
                "entityId": entity.id,
            },
        )
        assert resolved.status_code == 422, resolved.text
        assert client.get(path, headers=owner).json()[0]["status"] == "pending"
        current = client.get(f"/api/v2/research/{research['id']}", headers=owner).json()
        assert current["decision"]["plan"]["state"] == "needs-evidence"
        for key in ("claims", "evidence", "entities", "changes"):
            assert client.get("/api/v2/snapshot").json()[key] == original_public[key]
        with client.app.state.database.session() as session:
            assert (
                session.scalar(select(func.count()).select_from(DecisionEvidenceRequestRecord)) == 1
            )
            assert session.scalar(select(func.count()).select_from(EntryRequestRecord)) == 1
            assert session.get(ResearchRecord, research["id"]).decision_json == original_private

        # Complete the actual publication lifecycle. Merely submitting a
        # candidate must not unblock the owner; approved current facts must.
        review = client.post(
            "/api/v2/admin/review-candidates",
            headers=admin,
            json={
                "id": "gap-context-review",
                "entityId": entity.id,
                "claim": {
                    "id": "gap-context-claim",
                    "entityId": entity.id,
                    "text": {
                        "zh": "合成测试对象支持3000000 token输入上下文，仅软件测试。",
                        "en": "The synthetic fixture supports 3000000 tokens of input context; software test only.",
                    },
                    "subject": entity.name.en,
                    "predicate": "context_tokens",
                    "objectOrValue": "3000000",
                    "confidence": "unverified",
                    "sourceIds": ["gap-context-source"],
                    "updatedAt": today,
                    "validFrom": today,
                },
                "evidence": [
                    {
                        "id": "gap-context-source",
                        "title": {"zh": "合成容量来源", "en": "Synthetic capacity fixture"},
                        "url": "https://example.test/context-fixture",
                        "publisher": "Software fixture",
                        "publishedAt": today,
                        "collectedAt": today,
                        "type": "official",
                        "sourceExcerpt": "The synthetic fixture supports 3000000 tokens of input context; software test only.",
                    }
                ],
            },
        )
        assert review.status_code == 201, review.text
        assert client.get(path, headers=owner).json()[0]["verificationState"] == "awaiting-evidence"
        approved = client.post(
            f"/api/v2/admin/review-queue/{review.json()['id']}/approve",
            headers=admin,
            json={
                "expectedVersion": review.json()["version"],
                "reason": "Synthetic source verified for software acceptance only.",
            },
        )
        assert approved.status_code == 200, approved.text
        progress = client.get(path, headers=owner).json()[0]
        assert progress["status"] == "pending"  # Staff label is independent.
        assert progress["verificationState"] == "evidence-ready"
        assert (
            progress["verifiedDimensions"] == ["context"] and progress["remainingDimensions"] == []
        )
        assert progress["currentEligibility"] == "eligible"
        # Read-only projected fixtures exercise negative, conflicting, expired
        # and removed facts without publishing invented supplier claims.
        from app.decision_evidence_requests import evidence_progress

        current_snapshot = KnowledgeSnapshot.model_validate(client.get("/api/v2/snapshot").json())
        with client.app.state.database.session() as session:
            link = session.get(DecisionEvidenceRequestRecord, receipt["id"])
            negative = current_snapshot.model_copy(deep=True)
            capacity = next(claim for claim in negative.claims if claim.id == "gap-context-claim")
            capacity.object_or_value = "1000"
            result = evidence_progress(session, link, negative)
            assert result["verification_state"] == "evidence-ready"
            assert result["current_eligibility"] == "excluded"
            conflict = current_snapshot.model_copy(deep=True)
            conflict.claims.append(
                capacity.model_copy(
                    update={"id": "gap-conflicting-capacity", "object_or_value": "4000000"}
                )
            )
            result = evidence_progress(session, link, conflict)
            assert result["verification_state"] == "awaiting-evidence"
            assert result["current_eligibility"] == "conflict"
            expired = current_snapshot.model_copy(deep=True)
            next(
                claim for claim in expired.claims if claim.id == "gap-context-claim"
            ).valid_to = today
            assert (
                evidence_progress(session, link, expired)["verification_state"]
                == "awaiting-evidence"
            )
            removed = current_snapshot.model_copy(deep=True)
            removed.entities = [item for item in removed.entities if item.id != entity.id]
            assert (
                evidence_progress(session, link, removed)["verification_state"]
                == "candidate-unavailable"
            )
        wrong_entity = client.patch(
            f"/api/v2/admin/entry-requests/{receipt['id']}",
            headers=admin,
            json={
                "status": "resolved",
                "version": row["version"],
                "reviewerNote": "Wrong fixture target.",
                "entityId": "e-gpt",
            },
        )
        assert wrong_entity.status_code == 422
        resolved = client.patch(
            f"/api/v2/admin/entry-requests/{receipt['id']}",
            headers=admin,
            json={
                "status": "resolved",
                "version": row["version"],
                "reviewerNote": "Published synthetic capacity verified.",
                "entityId": entity.id,
            },
        )
        assert resolved.status_code == 200, resolved.text
        # Viewing progress never silently rewrites the historical decision.
        with client.app.state.database.session() as session:
            assert session.get(ResearchRecord, research["id"]).decision_json == original_private
        reanalyzed = client.post("/api/v2/research", headers=owner, json=body)
        assert reanalyzed.status_code == 200, reanalyzed.text
        assert reanalyzed.json()["decision"]["candidates"][0]["eligibility"] == "eligible"
        withdrawn = client.post(
            f"/api/v2/admin/review-queue/{review.json()['id']}/publication-state",
            headers=admin,
            json={
                "expectedVersion": approved.json()["version"],
                "action": "retract",
                "reason": "Synthetic retraction acceptance.",
            },
        )
        assert withdrawn.status_code == 200, withdrawn.text
        progress = client.get(path, headers=owner).json()[0]
        assert (
            progress["status"] == "resolved"
            and progress["verificationState"] == "awaiting-evidence"
        )
        assert progress["remainingDimensions"] == ["context"]
    with TestClient(create_app(settings)) as restarted:
        login = restarted.post(
            "/api/v2/auth/login",
            json={"email": "owner@example.com", "password": "fixture-only-password"},
        ).json()
        assert (
            restarted.get(path, headers={"Authorization": "Bearer " + login["accessToken"]}).json()[
                0
            ]["status"]
            == "resolved"
        )


def test_gap_migration_preserves_existing_private_tables_and_rolls_back_only_gap_links(
    tmp_path, monkeypatch
):
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import create_engine, inspect, text

    root = Path(__file__).resolve().parents[1]
    database_url = "sqlite:///" + (tmp_path / "migration.db").as_posix()
    monkeypatch.setenv("AI_RADAR_DATABASE_URL", database_url)
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "migrations"))
    command.upgrade(config, "20261009_0025")
    engine = create_engine(database_url)
    with engine.begin() as connection:
        connection.execute(
            ResearchRecord.__table__.insert().values(
                id="history",
                user_id="fixture",
                question="Synthetic migration record",
                summary="Preserve original",
                status="insufficient-evidence",
                created_at=datetime.now(UTC),
            )
        )
        before = connection.execute(text("select * from research_records")).all()
    command.upgrade(config, "20261013_0026")
    assert {
        column["name"] for column in inspect(engine).get_columns("decision_evidence_requests")
    } == set(DecisionEvidenceRequestRecord.__table__.columns.keys())
    with engine.connect() as connection:
        assert connection.execute(text("select * from research_records")).all() == before
    command.downgrade(config, "20261009_0025")
    assert "decision_evidence_requests" not in inspect(engine).get_table_names()
    assert "decision_validations" in inspect(engine).get_table_names()
    with engine.connect() as connection:
        assert connection.execute(text("select * from research_records")).all() == before
    engine.dispose()
