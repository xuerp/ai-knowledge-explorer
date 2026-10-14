import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.config import Settings
from app.database import EntryRequestRecord, ReviewJobRecord
from app.main import create_app

SEED = Path(__file__).resolve().parents[1] / "data" / "demo_snapshot.json"
HEADERS = {"X-Admin-Token": "test-admin-token"}


def settings(tmp_path):
    return Settings(
        database_url=f"sqlite:///{(tmp_path / 'entry.db').as_posix()}",
        seed_snapshot_path=SEED,
        admin_token="test-admin-token",
        cors_origins=("http://localhost:8082",),
        environment="test",
        jwt_secret="test-jwt-secret-that-is-long-enough-for-hs256",
    )


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(settings(tmp_path))) as client:
        yield client


def payload():
    return {
        "requestId": str(uuid4()),
        "name": "待收录对象示例",
        "entityType": "model",
        "sourceUrl": "https://example.com/official",
        "reason": "这是一个需要补充到知识库的测试对象。",
    }


def test_submission_is_persisted_idempotent_and_never_publishes_knowledge(client, tmp_path):
    body = payload()
    before = client.get("/api/v2/snapshot").json()
    response = client.post("/api/v2/entry-requests", json=body)
    assert response.status_code == 201
    assert response.json()["id"] == body["requestId"]
    assert response.json()["status"] == "pending"
    assert set(response.json()) == {"id", "status", "createdAt"}
    assert client.post("/api/v2/entry-requests", json=body).json() == response.json()
    assert (
        client.post("/api/v2/entry-requests", json={**body, "name": "另一个对象"}).status_code
        == 409
    )
    after = client.get("/api/v2/snapshot").json()
    for key in ["entities", "claims", "evidence", "changes", "timeline"]:
        assert after[key] == before[key]
    with client.app.state.database.session() as session:
        assert session.scalar(select(func.count()).select_from(EntryRequestRecord)) == 1
    with TestClient(create_app(settings(tmp_path))) as restarted:
        rows = restarted.get("/api/v2/admin/entry-requests", headers=HEADERS).json()
        assert len(rows) == 1 and rows[0]["reason"] == body["reason"]


def test_request_search_status_and_exact_pagination(client):
    bodies = [{**payload(), "name": name} for name in ["WorkBuddy", "Trae", "Literal%Tool"]]
    for body in bodies:
        assert client.post("/api/v2/entry-requests", json=body).status_code == 201
    endpoint = "/api/v2/admin/entry-requests"
    assert [
        row["name"]
        for row in client.get(endpoint, headers=HEADERS, params={"q": "workbuddy"}).json()
    ] == ["WorkBuddy"]
    assert [
        row["name"] for row in client.get(endpoint, headers=HEADERS, params={"q": "%"}).json()
    ] == ["Literal%Tool"]
    assert client.get(endpoint, headers=HEADERS, params={"status": "resolved"}).json() == []
    first = client.get(endpoint, headers=HEADERS, params={"limit": 2}).json()
    second = client.get(endpoint, headers=HEADERS, params={"limit": 2, "offset": 2}).json()
    assert len(first) == 2 and len(second) == 1
    assert {row["id"] for row in [*first, *second]} == {body["requestId"] for body in bodies}


def test_fact_search_topic_total_and_cursor_are_applied_before_paging(client):
    snapshot = client.get("/api/v2/snapshot").json()
    entity_id = max(
        {claim["entityId"] for claim in snapshot["claims"]},
        key=lambda key: sum(claim["entityId"] == key for claim in snapshot["claims"]),
    )
    claims = [claim for claim in snapshot["claims"] if claim["entityId"] == entity_id]
    endpoint = f"/api/v2/entities/{entity_id}/claims"
    first = client.get(endpoint, params={"scope": "all", "limit": 1}).json()
    assert first["total"] == len(claims) and first["nextCursor"]
    second = client.get(
        endpoint, params={"scope": "all", "limit": 1, "cursor": first["nextCursor"]}
    ).json()
    assert second["total"] == first["total"]
    assert second["items"][0]["id"] != first["items"][0]["id"]
    needle = claims[0]["text"]["zh"][:8]
    searched = client.get(endpoint, params={"scope": "all", "q": needle}).json()
    assert searched["total"] >= 1
    assert all(needle in json.dumps(claim, ensure_ascii=False) for claim in searched["items"])
    assert (
        client.get(endpoint, params={"scope": "all", "q": "definitely-no-matching-fact"}).json()[
            "total"
        ]
        == 0
    )
    topic = claims[0].get("predicate")
    if topic:
        filtered = client.get(endpoint, params={"scope": "all", "topic": topic}).json()
        assert filtered["total"] > 0
        assert all(claim["predicate"] == topic for claim in filtered["items"])
    assert (
        client.get(endpoint, params={"scope": "all", "topic": "definitely-no-such-topic"}).json()[
            "total"
        ]
        == 0
    )


@pytest.mark.parametrize(
    "replacement",
    [
        {"name": "  "},
        {"reason": "短"},
        {"reason": " " * 20},
        {"name": "x" * 121},
        {"sourceUrl": "http://example.com"},
        {"sourceUrl": "https://user:password@example.com"},
        {"sourceUrl": "javascript:alert(1)"},
        {"entityType": "unknown"},
        {"requestId": "invalid"},
    ],
)
def test_invalid_submission_is_rejected(client, replacement):
    assert (
        client.post("/api/v2/entry-requests", json={**payload(), **replacement}).status_code == 422
    )
    assert client.get("/api/v2/admin/entry-requests", headers=HEADERS).json() == []


def test_staff_review_requires_authentication_and_conflict_safe_transitions(client):
    body = payload()
    client.post("/api/v2/entry-requests", json=body)
    endpoint = f"/api/v2/admin/entry-requests/{body['requestId']}"
    decision = {"status": "in-review", "version": 1, "reviewerNote": "核对官方资料"}
    assert client.get("/api/v2/admin/entry-requests").status_code == 401
    assert client.patch(endpoint, json=decision).status_code == 401
    assert (
        client.get(
            "/api/v2/admin/entry-requests", headers=HEADERS, params={"status": "resolved"}
        ).json()
        == []
    )
    reviewed = client.patch(endpoint, json=decision, headers=HEADERS)
    assert reviewed.status_code == 200
    assert reviewed.json()["version"] == 2
    assert reviewed.json()["reviewedBy"] == "legacy-admin@local"
    assert client.patch(endpoint, json=decision, headers=HEADERS).status_code == 409
    assert (
        client.patch(
            endpoint,
            json={"status": "resolved", "version": 2, "reviewerNote": "已完成收录"},
            headers=HEADERS,
        ).status_code
        == 422
    )
    assert (
        client.patch(
            endpoint,
            json={
                "status": "resolved",
                "version": 2,
                "reviewerNote": "已完成收录",
                "entityId": "missing",
            },
            headers=HEADERS,
        ).status_code
        == 422
    )
    resolved = client.patch(
        endpoint,
        json={
            "status": "resolved",
            "version": 2,
            "reviewerNote": "目录已有该对象",
            "entityId": "e-gpt",
        },
        headers=HEADERS,
    )
    assert resolved.status_code == 200
    assert resolved.json()["entityId"] == "e-gpt"
    assert (
        client.patch(
            endpoint,
            json={"status": "rejected", "version": 3, "reviewerNote": "不再处理"},
            headers=HEADERS,
        ).status_code
        == 409
    )
    audit = client.get("/api/v2/admin/audit-log", headers=HEADERS).json()
    assert any(item["action"] == "entry-request.review" for item in audit)


def test_rejection_and_list_pagination(client):
    body = payload()
    client.post("/api/v2/entry-requests", json=body)
    endpoint = f"/api/v2/admin/entry-requests/{body['requestId']}"
    assert (
        client.patch(
            endpoint,
            json={"status": "rejected", "version": 1, "reviewerNote": "资料不符合收录要求"},
            headers=HEADERS,
        ).status_code
        == 200
    )
    assert (
        len(
            client.get(
                "/api/v2/admin/entry-requests",
                headers=HEADERS,
                params={"status": "rejected", "limit": 1},
            ).json()
        )
        == 1
    )
    assert (
        client.get("/api/v2/admin/entry-requests", headers=HEADERS, params={"offset": 1}).json()
        == []
    )


def test_pending_supporting_fact_removes_non_release_catalog_event(client):
    before = client.get("/api/v2/snapshot").json()
    claim = next(item for item in before["claims"] if item["id"] == "c-change-refusal-billing")
    event_id = "change-event-t-change-refusal-billing"
    assert any(item["id"] == event_id for item in before["changes"])
    with client.app.state.database.session() as session:
        session.add(
            ReviewJobRecord(
                id="pending-event-review",
                entity_id=claim["entityId"],
                claim_id=claim["id"],
                claim_json=json.dumps(claim),
                evidence_ids_json=json.dumps(claim["sourceIds"]),
                evidence_json="[]",
                conflict_ids_json="[]",
                status="pending",
                created_at=datetime.now(UTC),
                version=1,
            )
        )
        session.commit()
    public = client.get("/api/v2/snapshot").json()
    assert all(item["id"] != claim["id"] for item in public["claims"])
    assert all(item["id"] != event_id for item in public["changes"])
    assert (
        sum(item["kind"] == "pricing" for item in public["changes"])
        == sum(item["kind"] == "pricing" for item in before["changes"]) - 1
    )
