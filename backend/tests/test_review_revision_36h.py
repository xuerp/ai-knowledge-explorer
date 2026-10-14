import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import Settings
from app.database import AuditLogRecord, ReviewJobRecord
from app.main import create_app


@pytest.fixture
def setup(tmp_path):
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        seed_snapshot_path=Path(__file__).resolve().parents[1] / "data/demo_snapshot.json",
        admin_token="test-admin-token",
        cors_origins=("http://localhost:3000",),
        environment="test",
        jwt_secret="test-jwt-secret-that-is-long-enough-for-hs256",
    )
    with TestClient(create_app(settings)) as client:
        auth = client.post(
            "/api/v2/auth/bootstrap",
            headers={"X-Admin-Token": "test-admin-token"},
            json={
                "email": "revision36h@example.com",
                "password": "isolated revision fixture password",
            },
        )
        assert auth.status_code == 200
        headers = {"Authorization": "Bearer " + auth.json()["accessToken"]}
        body = {
            "id": "review-revision-source",
            "entityId": "e-gpt",
            "claim": {
                "id": "claim-revision-source",
                "text": {"zh": "GPT 测试API价格", "en": "GPT fixture API price"},
                "confidence": "unverified",
                "sourceIds": ["evidence-revision-source"],
                "updatedAt": "2026-10-01",
                "subject": "GPT",
                "predicate": "api_price",
                "validFrom": "2026-10-01",
                "objectOrValue": json.dumps(
                    {
                        "input": 2,
                        "output": 8,
                        "currency": "USD",
                        "unit": "per-million-tokens",
                        "channel": "official",
                    }
                ),
            },
            "evidence": [
                {
                    "id": "evidence-revision-source",
                    "title": {"zh": "隔离价格资料", "en": "Isolated price fixture"},
                    "url": "https://example.com/revision",
                    "publisher": "Fixture",
                    "publishedAt": "2026-10-01",
                    "collectedAt": "2026-10-07",
                    "sourceExcerpt": "GPT fixture API price: input 2 USD, output 8 USD per million tokens, official channel.",
                    "type": "official",
                    "supportsClaimIds": ["claim-revision-source"],
                }
            ],
        }
        candidate = client.post("/api/v2/admin/review-candidates", headers=headers, json=body)
        assert candidate.status_code == 201
        source = next(
            item
            for item in client.get("/api/v2/admin/review-queue", headers=headers).json()
            if item["id"] == body["id"]
        )
        payload = {
            "expectedVersion": candidate.json()["version"],
            "idempotencyKey": "isolated-revision-key-v1",
            "textZh": "GPT 测试API价格，每百万token输入2USD、输出8USD，仅官方渠道。",
            "textEn": "GPT fixture API price: input 2 USD and output 8 USD per million tokens, official channel only.",
            "reason": "对照隔离原文补充单位和渠道，保持数值与日期。",
        }
        yield client, headers, source, payload


def revise(setup, **changes):
    client, headers, source, payload = setup
    return client.post(
        f"/api/v2/admin/review-queue/{source['id']}/revise",
        headers=headers,
        json={**payload, **changes},
    )


def test_revision_preserves_source_and_public_data_until_separate_review(setup):
    client, headers, source, _ = setup
    before = client.get("/api/v2/snapshot").json()
    response = revise(setup)
    assert response.status_code == 200
    revised = response.json()
    assert revised["status"] == "pending" and revised["claim"]["confidence"] == "unverified"
    for key in (
        "subject",
        "predicate",
        "objectOrValue",
        "validFrom",
        "validTo",
        "updatedAt",
        "observedAt",
    ):
        assert revised["claim"].get(key) == source["claim"].get(key)
    old, new = source["evidenceItems"][0], revised["evidenceItems"][0]
    for key in ("url", "sourceExcerpt", "publishedAt", "collectedAt", "publisher"):
        assert old[key] == new[key]
    assert new["verifiedAt"] is None and new["supportsClaimIds"] == [revised["claim"]["id"]]
    queue = {
        item["id"]: item
        for item in client.get("/api/v2/admin/review-queue", headers=headers).json()
    }
    assert queue[source["id"]] == source
    after = client.get("/api/v2/snapshot").json()
    assert before["claims"] == after["claims"] and before["evidence"] == after["evidence"]


def test_revision_is_idempotent_and_rejects_reused_key_content(setup):
    first, second = revise(setup), revise(setup)
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert revise(setup, reason="同一个键不能更换修订理由").status_code == 409
    with setup[0].app.state.database.session() as session:
        assert (
            len(
                session.scalars(
                    select(AuditLogRecord).where(AuditLogRecord.action == "review.revision")
                ).all()
            )
            == 1
        )


def test_concurrent_revision_retries_create_one_candidate_and_audit(setup):
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: revise(setup), range(2)))
    assert [r.status_code for r in responses] == [200, 200]
    assert responses[0].json()["id"] == responses[1].json()["id"]
    with setup[0].app.state.database.session() as session:
        assert (
            len(
                session.scalars(
                    select(ReviewJobRecord).where(ReviewJobRecord.id.like("revision-%"))
                ).all()
            )
            == 1
        )
        assert (
            len(
                session.scalars(
                    select(AuditLogRecord).where(AuditLogRecord.action == "review.revision")
                ).all()
            )
            == 1
        )


@pytest.mark.parametrize(
    "changes", [{"expectedVersion": 99}, {"textZh": " "}, {"textEn": " "}, {"reason": "   "}]
)
def test_stale_or_empty_revision_has_no_candidate_or_audit(setup, changes):
    assert revise(setup, **changes).status_code in {409, 422}
    with setup[0].app.state.database.session() as session:
        assert (
            session.scalars(
                select(ReviewJobRecord).where(ReviewJobRecord.id.like("revision-%"))
            ).first()
            is None
        )
        assert (
            session.scalars(
                select(AuditLogRecord).where(AuditLogRecord.action == "review.revision")
            ).first()
            is None
        )


def test_revision_requires_reviewer_permission(setup):
    client, _, source, payload = setup
    viewer = client.post(
        "/api/v2/auth/register",
        json={
            "email": "revision-viewer@example.com",
            "password": "isolated viewer fixture password",
        },
    ).json()
    url = f"/api/v2/admin/review-queue/{source['id']}/revise"
    assert client.post(url, json=payload).status_code == 401
    assert (
        client.post(
            url, json=payload, headers={"Authorization": "Bearer " + viewer["accessToken"]}
        ).status_code
        == 403
    )


def test_approved_text_revision_only_replaces_after_explicit_lifecycle_review(setup):
    client, headers, source, payload = setup
    approved = client.post(
        f"/api/v2/admin/review-queue/{source['id']}/approve",
        headers=headers,
        json={"expectedVersion": source["version"], "reason": "隔离测试价格依据核验"},
    ).json()
    revised = revise(setup, expectedVersion=approved["version"]).json()
    public = {item["id"] for item in client.get("/api/v2/snapshot").json()["claims"]}
    assert source["claim"]["id"] in public and revised["claim"]["id"] not in public
    replacement = client.post(
        f"/api/v2/admin/review-queue/{revised['id']}/approve-superseding",
        headers=headers,
        json={
            "expectedVersion": revised["version"],
            "targetClaimId": source["claim"]["id"],
            "expectedTargetVersion": approved["version"],
            "idempotencyKey": "isolated-replacement-key-v1",
            "reason": payload["reason"],
        },
    )
    assert replacement.status_code == 200
    public = {item["id"] for item in client.get("/api/v2/snapshot").json()["claims"]}
    assert source["claim"]["id"] not in public and revised["claim"]["id"] in public


def test_audit_failure_rolls_back_revision_candidate(setup, monkeypatch):
    client = setup[0]

    def fail(*args, **kwargs):
        raise RuntimeError("isolated audit failure")

    monkeypatch.setattr(client.app.state.audit, "record", fail)
    with pytest.raises(RuntimeError, match="isolated audit failure"):
        revise(setup)
    with client.app.state.database.session() as session:
        assert (
            session.scalars(
                select(ReviewJobRecord).where(ReviewJobRecord.id.like("revision-%"))
            ).first()
            is None
        )
