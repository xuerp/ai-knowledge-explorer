from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import Settings
from app.database import RagClaimDocumentRecord
from app.main import create_app
from app.rag import LexicalRagRetriever
from app.schemas import KnowledgeSnapshot

HEADERS = {"X-Admin-Token": "test-admin-token"}


@pytest.fixture
def client(tmp_path):
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'review.db').as_posix()}",
        seed_snapshot_path=Path(__file__).resolve().parents[1] / "data/demo_snapshot.json",
        admin_token="test-admin-token",
        cors_origins=("http://localhost:3000",),
        environment="test",
        jwt_secret="test-jwt-secret-that-is-long-enough-for-hs256",
    )
    with TestClient(create_app(settings)) as c:
        yield c


def submit(client, suffix="one", predicate="available-as", evidence_id=None):
    evidence_id = evidence_id or f"evidence-publication-{suffix}"
    content = "Claude Code is generally available and uses MCP."
    result = client.post(
        "/api/v2/admin/review-candidates",
        headers=HEADERS,
        json={
            "id": f"review-publication-{suffix}",
            "entityId": "e-claude-code",
            "claim": {
                "id": f"claim-publication-{suffix}",
                "entityId": "e-claude-code",
                "text": {"zh": "Claude Code 已正式可用，并使用 MCP。", "en": content},
                "subject": "Claude Code",
                "predicate": predicate,
                "objectOrValue": "MCP" if predicate == "uses" else "generally available",
                "confidence": "unverified",
                "sourceIds": [evidence_id],
                "updatedAt": "2025-05-22",
                "validFrom": "2025-05-22",
            },
            "evidence": [
                {
                    "id": evidence_id,
                    "title": {"zh": "测试来源", "en": "Fixture"},
                    "url": "https://example.com/claude-code",
                    "publisher": "Anthropic",
                    "publishedAt": "2025-05-22",
                    "collectedAt": "2025-05-22",
                    "sourceExcerpt": content,
                    "type": "official",
                }
            ],
        },
    )
    assert result.status_code == 201
    return result.json()


def approve(client, item):
    result = client.post(
        f"/api/v2/admin/review-queue/{item['id']}/approve",
        headers=HEADERS,
        json={"expectedVersion": item["version"], "reason": "Fixture evidence inspected."},
    )
    assert result.status_code == 200
    return result.json()


def change(client, item, action, **overrides):
    return client.post(
        f"/api/v2/admin/review-queue/{item['id']}/publication-state",
        headers=HEADERS,
        json={
            "expectedVersion": item["version"],
            "action": action,
            "reason": "Lifecycle acceptance fixture.",
            **overrides,
        },
    )


def test_retraction_and_restoration_sync_claim_changes_retrieval_and_history(client):
    item = approve(client, submit(client))
    claim_id = item["claim"]["id"]
    snapshot = client.get("/api/v2/snapshot").json()
    assert claim_id in {c["id"] for c in snapshot["claims"]}
    assert f"change-claim-{claim_id}" in {c["id"] for c in snapshot["changes"]}
    withdrawn = change(client, item, "retract")
    assert withdrawn.status_code == 200
    withdrawn = withdrawn.json()
    assert withdrawn["status"] == "approved" and withdrawn["lifecycleStatus"] == "retracted"
    snapshot = client.get("/api/v2/snapshot").json()
    assert claim_id not in {c["id"] for c in snapshot["claims"]}
    assert f"change-claim-{claim_id}" not in {c["id"] for c in snapshot["changes"]}
    with client.app.state.database.session() as session:
        assert session.get(RagClaimDocumentRecord, claim_id) is None
        result = LexicalRagRetriever(include_derived_knowledge=False).search(
            session,
            KnowledgeSnapshot.model_validate(snapshot),
            "Claude Code generally available",
            limit=8,
        )
        assert claim_id not in {c.claim.id for c in result.citations}
    assert change(client, item, "restore").status_code == 409
    restored = change(client, withdrawn, "restore")
    assert restored.status_code == 200
    assert restored.json()["version"] == item["version"] + 2
    snapshot = client.get("/api/v2/snapshot").json()
    assert claim_id in {c["id"] for c in snapshot["claims"]}
    with client.app.state.database.session() as session:
        assert session.get(RagClaimDocumentRecord, claim_id) is not None
    history = client.get("/api/v2/admin/publication-history", headers=HEADERS).json()
    assert sum(h["claimId"] == claim_id for h in history) == 3
    audit = client.get("/api/v2/admin/audit-log", headers=HEADERS).json()
    assert {a["action"] for a in audit if a["targetId"] == item["id"]} >= {
        "review.retract",
        "review.restore",
    }


def test_relation_evidence_is_removed_only_when_no_current_claim_supports_it(client):
    first = approve(client, submit(client, "relation", "uses", "evidence-shared-publication"))
    second = approve(client, submit(client, "shared", "uses", "evidence-shared-publication"))
    assert change(client, first, "retract").status_code == 200
    edges = client.get("/api/v2/snapshot").json()["graph"]["edges"]
    assert any("evidence-shared-publication" in e["sourceIds"] for e in edges)
    assert change(client, second, "retract").status_code == 200
    edges = client.get("/api/v2/snapshot").json()["graph"]["edges"]
    assert not any("evidence-shared-publication" in e["sourceIds"] for e in edges)
    assert edges  # Other independently sourced relations are retained.


def test_invalid_or_unauthenticated_lifecycle_operations_do_not_change_state(client):
    item = submit(client)
    path = f"/api/v2/admin/review-queue/{item['id']}/publication-state"
    payload = {"action": "retract", "expectedVersion": 1, "reason": "Test reason."}
    assert client.post(path, json=payload).status_code == 401
    assert change(client, item, "retract").status_code == 409
    item = approve(client, item)
    assert change(client, item, "retract", reason="   ").status_code == 422
    assert change(client, item, "retract", expectedVersion=1).status_code == 409
    assert change(client, item, "restore").status_code == 409
    with client.app.state.database.session() as session:
        from app.database import ReviewJobRecord

        row = session.scalar(select(ReviewJobRecord).where(ReviewJobRecord.id == item["id"]))
        assert row.lifecycle_status == "current" and row.version == item["version"]


def test_restore_human_reviewed_synthesis_and_reject_missing_excerpts(client):
    item = approve(client, submit(client))
    withdrawn = change(client, item, "retract").json()
    import json

    from app.database import ReviewJobRecord

    with client.app.state.database.session() as session:
        row = session.get(ReviewJobRecord, item["id"])
        claim = json.loads(row.claim_json)
        claim["objectOrValue"] = "generally available (publisher report)"
        row.claim_json = json.dumps(claim)
        session.commit()
    restored = change(client, withdrawn, "restore")
    assert restored.status_code == 200
    withdrawn = change(client, restored.json(), "retract").json()
    with client.app.state.database.session() as session:
        row = session.get(ReviewJobRecord, item["id"])
        evidence = json.loads(row.evidence_json)
        for entry in evidence:
            entry["sourceExcerpt"] = ""
        row.evidence_json = json.dumps(evidence)
        session.commit()
    assert change(client, withdrawn, "restore").status_code == 422


def test_viewer_forbidden_and_concurrent_retractions_have_one_winner(client):
    item = approve(client, submit(client))
    viewer = client.post(
        "/api/v2/auth/register",
        json={
            "email": "publication-viewer@example.com",
            "password": "correct horse battery staple",
        },
    ).json()
    response = client.post(
        f"/api/v2/admin/review-queue/{item['id']}/publication-state",
        headers={"Authorization": f"Bearer {viewer['accessToken']}"},
        json={"action": "retract", "expectedVersion": item["version"], "reason": "Viewer test."},
    )
    assert response.status_code == 403
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: change(client, item, "retract"), range(2)))
    assert sorted(r.status_code for r in results) == [200, 409]


def test_home_is_a_small_public_projection_and_follows_review_lifecycle(client):
    def read_and_compare():
        full_response = client.get("/api/v2/snapshot")
        home_response = client.get("/api/v2/home")
        assert full_response.status_code == home_response.status_code == 200
        full, home = full_response.json(), home_response.json()
        assert home["entityCount"] == len(full["entities"])
        assert home["claimCount"] == len(full["claims"])
        assert home["sourcedClaimCount"] == sum(bool(c["sourceIds"]) for c in full["claims"])
        assert len(home_response.content) < 50_000
        assert len(home_response.content) < len(full_response.content) / 10
        assert (
            not {
                "claims",
                "timeline",
                "following",
                "notifications",
                "researchAnswers",
                "reviewCandidates",
                "syncRuns",
                "interestProfile",
            }
            & home.keys()
        )
        assert len(home["changes"]) <= 3
        assert len(home["featuredRelations"]) <= 3
        sources = {e["id"]: e for e in full["evidence"]}
        for edge in home["featuredRelations"]:
            assert edge["confidence"] == "verified"
            assert any(sources.get(sid, {}).get("url") for sid in edge["sourceIds"])
        assert {e["id"] for e in home["entities"]} <= {e["id"] for e in full["entities"]}
        return home["claimCount"]

    original_count = read_and_compare()
    pending = submit(client, suffix="homepage-lifecycle")
    assert read_and_compare() == original_count
    published = approve(client, pending)
    assert read_and_compare() == original_count + 1
    assert change(client, published, "retract").status_code == 200
    assert read_and_compare() == original_count
