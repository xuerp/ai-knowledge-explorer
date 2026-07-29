from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

SEED_PATH = Path(__file__).resolve().parents[1] / "data" / "demo_snapshot.json"


@pytest.fixture
def client(tmp_path: Path):
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        seed_snapshot_path=SEED_PATH,
        admin_token="test-admin-token",
        cors_origins=("http://localhost:3000",),
        environment="test",
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def test_health_exposes_write_boundary(client: TestClient):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "environment": "test",
        "dataMode": "demo",
        "database": "sqlite",
        "adminWritesEnabled": True,
    }


def test_public_snapshot_is_live_and_hides_unreviewed_claims(client: TestClient):
    response = client.get("/api/snapshot")
    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["mode"] == "demo"
    assert payload["meta"]["freshness"] == "cached"
    assert "演示种子" in payload["meta"]["message"]["zh"]
    assert payload["reviewCandidates"] == []
    assert payload["syncRuns"] == []
    assert "c-gpt5-1m" not in {claim["id"] for claim in payload["claims"]}


def test_entity_and_graph_reads_use_the_same_snapshot(client: TestClient):
    entity = client.get("/api/v2/entities/model/gpt")
    assert entity.status_code == 200
    assert entity.json()["id"] == "e-gpt"

    query = client.post(
        "/api/v2/graph/query",
        json={"entityTypes": ["model"], "confidences": ["verified"]},
    )
    assert query.status_code == 200
    assert all(node["type"] == "model" for node in query.json()["nodes"])
    assert query.json()["edges"]
    assert all(edge["confidence"] == "verified" for edge in query.json()["edges"])

    neighbors = client.get("/api/v2/entities/e-gpt/neighbors")
    assert neighbors.status_code == 200
    assert len(neighbors.json()["nodes"]) > 1
    assert neighbors.json()["edges"]


def test_admin_queue_requires_token(client: TestClient):
    assert client.get("/api/v2/admin/review-queue").status_code == 401
    assert (
        client.get(
            "/api/v2/admin/review-queue",
            headers={"X-Admin-Token": "wrong"},
        ).status_code
        == 401
    )


def test_admin_writes_are_disabled_without_configuration(tmp_path: Path):
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'disabled.db').as_posix()}",
        seed_snapshot_path=SEED_PATH,
        admin_token=None,
        cors_origins=(),
        environment="test",
    )
    with TestClient(create_app(settings)) as test_client:
        health = test_client.get("/health").json()
        assert health["adminWritesEnabled"] is False
        response = test_client.get("/api/v2/admin/review-queue")
        assert response.status_code == 503
        assert "disabled" in response.json()["detail"]


def test_approve_publishes_claim_once_and_records_history(client: TestClient):
    headers = {"X-Admin-Token": "test-admin-token"}
    queue = client.get("/api/v2/admin/review-queue", headers=headers).json()
    review = next(item for item in queue if item["id"] == "review-gpt-context")

    approved = client.post(
        f"/api/v2/admin/review-queue/{review['id']}/approve",
        headers=headers,
        json={
            "expectedVersion": review["version"],
            "reason": "Official evidence checked by a human reviewer.",
        },
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"
    assert approved.json()["version"] == review["version"] + 1

    snapshot = client.get("/api/snapshot").json()
    assert "c-gpt5-1m" in {claim["id"] for claim in snapshot["claims"]}

    repeated = client.post(
        f"/api/v2/admin/review-queue/{review['id']}/approve",
        headers=headers,
        json={
            "expectedVersion": review["version"],
            "reason": "Attempting the same review again.",
        },
    )
    assert repeated.status_code == 409

    history = client.get("/api/v2/admin/publication-history", headers=headers)
    assert history.status_code == 200
    assert history.json()[0]["claimId"] == "c-gpt5-1m"


def test_reject_keeps_claim_out_of_public_snapshot(client: TestClient):
    headers = {"X-Admin-Token": "test-admin-token"}
    review = client.get("/api/v2/admin/review-queue", headers=headers).json()[0]
    rejected = client.post(
        f"/api/v2/admin/review-queue/{review['id']}/reject",
        headers=headers,
        json={
            "expectedVersion": review["version"],
            "reason": "The source does not meet the publication threshold.",
        },
    )
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"

    snapshot = client.get("/api/snapshot").json()
    assert review["claim"]["id"] not in {claim["id"] for claim in snapshot["claims"]}
    history = client.get("/api/v2/admin/publication-history", headers=headers)
    assert history.json() == []


def test_source_snapshots_are_normalized_deduplicated_and_diffed(client: TestClient):
    headers = {"X-Admin-Token": "test-admin-token"}
    created = client.post(
        "/api/v2/admin/sources",
        headers=headers,
        json={
            "id": "source-demo-release",
            "url": "https://Example.com/releases/#latest",
            "title": "Example release feed",
            "publisher": "Example",
        },
    )
    assert created.status_code == 201
    assert created.json()["url"] == "https://example.com/releases"

    first = client.post(
        "/api/v2/admin/sources/source-demo-release/snapshots",
        headers=headers,
        json={"content": "Version 1 introduces evidence-linked graph queries."},
    )
    assert first.status_code == 200
    assert first.json()["changeType"] == "created"

    duplicate = client.post(
        "/api/v2/admin/sources/source-demo-release/snapshots",
        headers=headers,
        json={"content": "Version 1 introduces evidence-linked graph queries.   "},
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["changeType"] == "unchanged"
    assert duplicate.json()["snapshotId"] == first.json()["snapshotId"]

    changed = client.post(
        "/api/v2/admin/sources/source-demo-release/snapshots",
        headers=headers,
        json={"content": "Version 2 adds a human review gate before public release."},
    )
    assert changed.status_code == 200
    assert changed.json()["changeType"] == "updated"
    assert changed.json()["previousSnapshotId"] == first.json()["snapshotId"]

    runs = client.get(
        "/api/v2/admin/ingestion-runs",
        headers=headers,
        params={"sourceId": "source-demo-release"},
    )
    assert runs.status_code == 200
    assert {item["changeType"] for item in runs.json()} == {
        "created",
        "updated",
        "unchanged",
    }

    duplicate_source = client.post(
        "/api/v2/admin/sources",
        headers=headers,
        json={
            "id": "source-duplicate",
            "url": "https://example.com/releases",
            "title": "Duplicate release feed",
            "publisher": "Example",
        },
    )
    assert duplicate_source.status_code == 409


def test_dynamic_candidate_is_private_until_human_approval(client: TestClient):
    headers = {"X-Admin-Token": "test-admin-token"}
    candidate_payload = {
        "id": "review-ingested-capability",
        "entityId": "e-gpt",
        "claim": {
            "id": "c-ingested-capability",
            "text": {
                "zh": "演示采集内容在人工批准后进入公共快照。",
                "en": "Demo ingestion enters the public snapshot only after human approval.",
            },
            "confidence": "verified",
            "sourceIds": ["s-ingested-release"],
            "updatedAt": "2026-07-29",
            "validFrom": "2026-07-29",
            "observedAt": "2026-07-29",
        },
        "evidence": [
            {
                "id": "s-ingested-release",
                "title": {
                    "zh": "演示发布记录",
                    "en": "Demo release record",
                },
                "url": "https://example.com/releases/v2",
                "publisher": "Example",
                "publishedAt": "2026-07-29",
                "collectedAt": "2026-07-29",
                "verifiedAt": "2026-07-29",
                "type": "official",
            }
        ],
    }
    submitted = client.post(
        "/api/v2/admin/review-candidates",
        headers=headers,
        json=candidate_payload,
    )
    assert submitted.status_code == 201
    assert submitted.json()["status"] == "pending"

    before = client.get("/api/snapshot").json()
    assert "c-ingested-capability" not in {claim["id"] for claim in before["claims"]}
    assert "s-ingested-release" not in {item["id"] for item in before["evidence"]}

    approved = client.post(
        "/api/v2/admin/review-queue/review-ingested-capability/approve",
        headers=headers,
        json={
            "expectedVersion": submitted.json()["version"],
            "reason": "The source, timestamps, and claim scope were manually checked.",
        },
    )
    assert approved.status_code == 200

    after = client.get("/api/snapshot").json()
    assert "c-ingested-capability" in {claim["id"] for claim in after["claims"]}
    assert "s-ingested-release" in {item["id"] for item in after["evidence"]}
