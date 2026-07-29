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
        jwt_secret="test-jwt-secret-that-is-long-enough-for-hs256",
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
        "authEnabled": True,
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


def test_model_family_version_catalog_and_comparison(client: TestClient):
    families = client.get("/api/v2/model-families")
    assert families.status_code == 200
    family_ids = {item["id"] for item in families.json()}
    assert {"e-gpt", "e-claude", "e-gemini", "e-deepseek", "e-qwen"} <= family_ids
    assert all(item.get("familyId") is None for item in families.json())

    versions = client.get("/api/v2/model-families/e-qwen/versions")
    assert versions.status_code == 200
    assert [item["id"] for item in versions.json()] == ["e-qwen-25-max", "e-qwen-3-max"]
    assert all(item["familyId"] == "e-qwen" for item in versions.json())
    assert all(item["specs"]["contextWindow"] for item in versions.json())

    comparison = client.post(
        "/api/v2/model-versions/compare",
        json={"versionIds": ["e-gpt-5", "e-gemini-25-pro", "e-qwen-3-max"]},
    )
    assert comparison.status_code == 200
    assert [item["id"] for item in comparison.json()] == [
        "e-gpt-5",
        "e-gemini-25-pro",
        "e-qwen-3-max",
    ]
    assert all(item["familyId"] for item in comparison.json())

    assert client.get("/api/v2/model-families/missing/versions").status_code == 404
    duplicate = client.post(
        "/api/v2/model-versions/compare",
        json={"versionIds": ["e-gpt-5", "e-gpt-5"]},
    )
    assert duplicate.status_code == 422


def test_admin_can_extend_persistent_catalog_without_frontend_changes(client: TestClient):
    headers = {"X-Admin-Token": "test-admin-token"}
    assert client.post("/api/v2/admin/entities", json={}, headers={}).status_code == 401

    family = client.get("/api/v2/entities/model/gpt").json()
    family.update(
        {
            "id": "e-test-series",
            "slug": "test-series",
            "name": {"zh": "测试模型系列", "en": "Test Model Series"},
            "summary": {"zh": "用于验证目录持久化。", "en": "Catalog persistence fixture."},
            "vendor": "Test Vendor",
            "latestVersion": "Test Model v1",
            "lastUpdatedAt": "2026-07-29",
        }
    )
    created_family = client.post(
        "/api/v2/admin/entities",
        headers=headers,
        json=family,
    )
    assert created_family.status_code == 201

    version = client.get("/api/v2/model-families/e-gpt/versions").json()[0]
    version.update(
        {
            "id": "e-test-v1",
            "slug": "test-v1",
            "name": {"zh": "测试模型 v1", "en": "Test Model v1"},
            "summary": {"zh": "首个具体版本。", "en": "First concrete release."},
            "vendor": "Test Vendor",
            "familyId": "e-test-series",
            "latestVersion": None,
            "firstReleasedAt": "2026-07-01",
            "lastUpdatedAt": "2026-07-29",
        }
    )
    created_version = client.post(
        "/api/v2/admin/entities",
        headers=headers,
        json=version,
    )
    assert created_version.status_code == 201

    event = {
        "id": "timeline-test-v1-launch",
        "date": "2026-07-01",
        "title": {"zh": "测试模型 v1 发布", "en": "Test Model v1 launched"},
        "summary": {"zh": "验证新增版本的时间线。", "en": "Verifies an extensible timeline."},
        "kind": "release",
        "sourceIds": ["s-openai-gpt5"],
        "confidence": "verified",
    }
    timeline = client.post(
        "/api/v2/admin/entities/e-test-series/timeline",
        headers=headers,
        json=event,
    )
    assert timeline.status_code == 201

    relation = {
        "id": "edge-test-v1-family",
        "fromId": "e-test-v1",
        "toId": "e-test-series",
        "kind": "part-of",
        "label": {"zh": "属于系列", "en": "Part of family"},
        "confidence": "verified",
        "sourceIds": ["s-openai-gpt5"],
        "validFrom": "2026-07-01",
        "validTo": None,
    }
    created_relation = client.post(
        "/api/v2/admin/relations",
        headers=headers,
        json=relation,
    )
    assert created_relation.status_code == 201

    versions = client.get("/api/v2/model-families/e-test-series/versions")
    assert versions.status_code == 200
    assert [item["id"] for item in versions.json()] == ["e-test-v1"]
    assert client.get("/api/v2/entities/model/test-series").status_code == 200
    assert client.get("/api/v2/entities/e-test-series/timeline").json() == [event]
    neighbors = client.get("/api/v2/entities/e-test-series/neighbors").json()
    assert any(item["id"] == "edge-test-v1-family" for item in neighbors["edges"])

    audit_log = client.get("/api/v2/admin/audit-log", headers=headers).json()
    actions = {item["action"] for item in audit_log}
    assert {
        "catalog.entity.upsert",
        "catalog.timeline.upsert",
        "catalog.relation.upsert",
    } <= actions

    invalid_version = dict(version, id="e-orphan-version", slug="orphan-version")
    invalid_version["familyId"] = "e-missing-family"
    rejected = client.post(
        "/api/v2/admin/entities",
        headers=headers,
        json=invalid_version,
    )
    assert rejected.status_code == 422


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


def test_jwt_bootstrap_login_roles_and_audit_log(client: TestClient):
    legacy_headers = {"X-Admin-Token": "test-admin-token"}
    bootstrap = client.post(
        "/api/v2/auth/bootstrap",
        headers=legacy_headers,
        json={"email": "admin@example.com", "password": "correct horse battery staple"},
    )
    assert bootstrap.status_code == 200
    admin_token = bootstrap.json()["accessToken"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    me = client.get("/api/v2/auth/me", headers=admin_headers)
    assert me.status_code == 200
    assert me.json()["role"] == "admin"

    reviewer = client.post(
        "/api/v2/admin/users",
        headers=admin_headers,
        json={
            "email": "reviewer@example.com",
            "password": "another correct horse battery",
            "role": "reviewer",
        },
    )
    assert reviewer.status_code == 201

    login = client.post(
        "/api/v2/auth/login",
        json={
            "email": "reviewer@example.com",
            "password": "another correct horse battery",
        },
    )
    assert login.status_code == 200
    reviewer_headers = {"Authorization": f"Bearer {login.json()['accessToken']}"}
    assert client.get("/api/v2/admin/review-queue", headers=reviewer_headers).status_code == 200
    assert client.get("/api/v2/admin/sources", headers=reviewer_headers).status_code == 403

    audit = client.get("/api/v2/admin/audit-log", headers=admin_headers)
    assert audit.status_code == 200
    assert {item["action"] for item in audit.json()} >= {"user.bootstrap", "user.create"}


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


def test_follow_notification_digest_and_private_research_flow(client: TestClient):
    bootstrap = client.post(
        "/api/v2/auth/bootstrap",
        headers={"X-Admin-Token": "test-admin-token"},
        json={"email": "owner@example.com", "password": "correct horse battery staple"},
    )
    headers = {"Authorization": f"Bearer {bootstrap.json()['accessToken']}"}

    followed = client.post(
        "/api/v2/following",
        headers=headers,
        json={"entityId": "e-gpt", "intensity": "instant"},
    )
    assert followed.status_code == 200

    candidate = client.post(
        "/api/v2/admin/review-candidates",
        headers=headers,
        json={
            "id": "review-gpt-notification",
            "entityId": "e-gpt",
            "claim": {
                "id": "claim-gpt-notification",
                "text": {
                    "zh": "GPT 的演示更新已经通过人工审核。",
                    "en": "The GPT demo update passed human review.",
                },
                "confidence": "verified",
                "sourceIds": ["evidence-gpt-notification"],
                "updatedAt": "2026-07-29",
                "subject": "GPT",
                "predicate": "demo-status",
                "objectOrValue": "reviewed",
            },
            "evidence": [
                {
                    "id": "evidence-gpt-notification",
                    "title": {"zh": "官方更新", "en": "Official update"},
                    "url": "https://example.com/gpt-update",
                    "publisher": "Example",
                    "publishedAt": "2026-07-29",
                    "collectedAt": "2026-07-29",
                    "type": "official",
                }
            ],
        },
    )
    assert candidate.status_code == 201
    approved = client.post(
        "/api/v2/admin/review-queue/review-gpt-notification/approve",
        headers=headers,
        json={
            "expectedVersion": candidate.json()["version"],
            "reason": "Official evidence and entity mapping verified.",
        },
    )
    assert approved.status_code == 200

    notifications = client.get("/api/v2/notifications", headers=headers)
    assert notifications.status_code == 200
    assert notifications.json()[0]["changeId"] == "claim-gpt-notification"
    assert notifications.json()[0]["priority"] == "important"

    preferences = client.post(
        "/api/v2/notification-preferences",
        headers=headers,
        json={"enabled": True, "hour": "08:30"},
    )
    assert preferences.status_code == 200
    digest = client.post("/api/v2/admin/digests/run", headers=headers)
    assert digest.json() == {"recipients": 1, "messagesQueued": 1}
    assert client.get("/api/v2/admin/email-outbox", headers=headers).json()[0]["status"] == "queued"

    research = client.post(
        "/api/v2/research",
        headers=headers,
        json={"question": "GPT 最近有什么已经核验的变化？", "language": "zh"},
    )
    assert research.status_code == 200
    assert research.json()["status"] == "ready"
    assert "claim-gpt-notification" in research.json()["claimIds"]

    published = client.post(
        f"/api/v2/research/{research.json()['id']}/publish",
        headers=headers,
    )
    slug = published.json()["publishedSlug"]
    assert slug
    shared = client.get(f"/api/v2/share/{slug}")
    assert shared.status_code == 200
    assert shared.json()["citations"][0]["claim"]["id"] == "claim-gpt-notification"
    assert shared.json()["citations"][0]["evidence"][0]["publisher"] == "Example"
    markdown = client.get(f"/api/v2/share/{slug}/markdown")
    assert markdown.status_code == 200
    assert "claim-gpt-notification" in markdown.text
