"""Frozen semantic API acceptance in isolated databases; prices are synthetic."""

import hashlib
import json
import os
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import Settings
from app.database import AuditLogRecord, ResearchRecord
from app.main import create_app

ROOT = Path(__file__).resolve().parents[2]
FREEZE_PATH = ROOT / "docs/DECISION_SEMANTIC_FROZEN_12H_20261007.json"
FREEZE_SHA = "13ca494fe6773af21c1931e0c6e966b474d7a30524a88752b2f27f27eb56a750"
FREEZE = json.loads(FREEZE_PATH.read_text(encoding="utf-8"))


def stored_research_hash(client, research_id):
    with client.app.state.database.session() as session:
        row = session.get(ResearchRecord, research_id)
        payload = {column.name: str(getattr(row, column.name)) for column in row.__table__.columns}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


@pytest.mark.parametrize("case", FREEZE["cases"], ids=lambda case: case["id"])
def test_frozen_semantic_api_lifecycle(tmp_path, case):
    assert hashlib.sha256(FREEZE_PATH.read_bytes()).hexdigest() == FREEZE_SHA
    seed_path = ROOT / "backend/tests/fixtures/decision_seed_20261007.json"
    assert hashlib.sha256(seed_path.read_bytes()).hexdigest() == FREEZE["seedSha256"]
    seed = json.loads(seed_path.read_text(encoding="utf-8"))
    for key in ("claims", "evidence", "changes", "reviewCandidates", "syncRuns"):
        seed[key] = []
    seed["timeline"] = {}
    seed["graph"]["edges"] = []
    isolated_seed = tmp_path / "isolated_seed.json"
    isolated_seed.write_text(json.dumps(seed, ensure_ascii=False), encoding="utf-8")
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'semantic.db').as_posix()}",
        seed_snapshot_path=isolated_seed,
        admin_token="test-semantic-admin-token",
        cors_origins=("http://localhost:3000",),
        environment="test",
        jwt_secret="isolated-semantic-jwt-secret-at-least-32-chars",
        rag_generation_enabled=False,
        embedding_provider="none",
        auto_extraction_max_snapshots_per_cycle=0,
        auto_approve_grounded_relations=False,
    )
    proof = {
        "caseId": case["id"],
        "category": case["category"],
        "startedAt": datetime.now(UTC).isoformat(),
        "freezeSha256": FREEZE_SHA,
        "syntheticFixtures": True,
        "steps": [],
        "passed": False,
    }
    try:
        with TestClient(create_app(settings)) as client:
            auth = client.post(
                "/api/v2/auth/bootstrap",
                headers={"X-Admin-Token": settings.admin_token},
                json={
                    "email": "semantic-admin@example.com",
                    "password": "isolated semantic admin password",
                },
            )
            assert auth.status_code == 200
            admin = {"Authorization": "Bearer " + auth.json()["accessToken"]}
            viewer = client.post(
                "/api/v2/auth/register",
                json={
                    "email": "semantic-viewer@example.com",
                    "password": "isolated semantic viewer password",
                },
            )
            assert viewer.status_code == 201
            owner = {"Authorization": "Bearer " + viewer.json()["accessToken"]}
            assert viewer.json()["user"]["role"] == "viewer"

            def send(method, path, body=None, headers=admin):
                response = client.request(method, path, headers=headers, json=body)
                proof["steps"].append(
                    {
                        "method": method,
                        "path": path,
                        "request": body,
                        "status": response.status_code,
                        "response": response.json(),
                    }
                )
                assert response.status_code in (200, 201), response.text
                return response.json()

            def approve(item):
                return send(
                    "POST",
                    f"/api/v2/admin/review-queue/{item['id']}/approve",
                    {
                        "expectedVersion": item["version"],
                        "reason": "Synthetic source checked in isolated acceptance fixture.",
                    },
                )

            items = []
            for fact in case["facts"]:
                item = send("POST", "/api/v2/admin/review-candidates", fact["body"])
                if fact["initialState"] == "approved":
                    item = approve(item)
                items.append(item)

            def research():
                result = send(
                    "POST",
                    "/api/v2/research",
                    {
                        "question": case["question"],
                        "language": case["language"],
                        "decisionContext": case["context"],
                    },
                    owner,
                )
                reopened = send("GET", "/api/v2/research/" + result["id"], headers=owner)
                assert result == reopened, "POST and immediate owner reopen disagree."
                assert result["publishedSlug"] is None
                assert client.get("/api/v2/research/" + result["id"]).status_code == 401
                assert (
                    client.get("/api/v2/research/" + result["id"], headers=admin).status_code == 404
                )
                assert result["answerMode"] == "extractive"
                public = client.get("/api/v2/snapshot").json()
                claims = {claim["id"]: claim for claim in public["claims"]}
                citations = {citation["claim"]["id"]: citation for citation in result["citations"]}
                assert set(result["claimIds"]) == set(citations)
                for claim_id, state in result["citationStates"].items():
                    expected_state = (
                        "unavailable"
                        if claim_id in case.get("forbiddenCitationIds", [])
                        else "current"
                    )
                    assert state == expected_state
                assert set(citations) <= set(claims)
                for claim_id, citation in citations.items():
                    assert citation["claim"] == claims[claim_id]
                    assert citation["claim"]["confidence"] == "verified"
                    assert set(citation["claim"]["sourceIds"]) == {
                        source["id"] for source in citation["evidence"]
                    }
                    assert all(source["sourceExcerpt"] for source in citation["evidence"])
                decision = result["decision"]
                assert set(decision["claimIds"]) <= set(citations)
                for finding in decision["tradeoffs"]:
                    assert len(finding["claimIds"]) == 1
                    assert (
                        finding["finding"]
                        == citations[finding["claimIds"][0]]["claim"]["text"][case["language"]]
                    )
                for comparison in decision["comparisons"]:
                    for cell in comparison["cells"]:
                        assert (cell["state"] == "supported") == bool(cell["facts"])
                        for finding in cell["facts"]:
                            assert len(finding["claimIds"]) == 1
                            claim = citations[finding["claimIds"][0]]["claim"]
                            assert claim["entityId"] == cell["entityId"]
                            assert finding["finding"] == claim["text"][case["language"]]
                return result

            def publication(item, action):
                return send(
                    "POST",
                    f"/api/v2/admin/review-queue/{item['id']}/publication-state",
                    {
                        "action": action,
                        "expectedVersion": item["version"],
                        "reason": "Isolated synthetic publication lifecycle drill.",
                    },
                )

            def assert_stale(saved, before_hash):
                stale = send("GET", "/api/v2/research/" + saved["id"], headers=owner)
                assert stale["citationStates"][items[0]["claim"]["id"]] == "unavailable"
                assert stale["status"] == "insufficient-evidence"
                assert stale["claimIds"] == [] and stale["citations"] == []
                assert (
                    stale["decision"]["claimIds"] == [] and stale["decision"]["comparisons"] == []
                )
                assert stale["decision"]["recommendation"]["primaryEntityId"] is None
                assert stored_research_hash(client, saved["id"]) == before_hash
                proof["historicalStorageUnchanged"] = True

            flow = case["flow"]
            if flow in {"withdrawal", "restore", "superseding"}:
                saved = research()
                assert saved["decision"]["recommendation"]["primaryEntityId"] == "e-gpt"
                before_hash = stored_research_hash(client, saved["id"])
                if flow == "superseding":
                    items[1] = send(
                        "POST",
                        f"/api/v2/admin/review-queue/{items[1]['id']}/approve-superseding",
                        {
                            "expectedVersion": items[1]["version"],
                            "expectedTargetVersion": items[0]["version"],
                            "targetClaimId": items[0]["claim"]["id"],
                            "idempotencyKey": "semantic-superseding-v1",
                            "reason": "Fixture source changed rates on its stated validity date.",
                        },
                    )
                    public = client.get("/api/v2/snapshot").json()
                    assert items[0]["claim"]["id"] not in {c["id"] for c in public["claims"]}
                    assert_stale(saved, before_hash)
                else:
                    items[0] = publication(items[0], "retract")
                    assert_stale(saved, before_hash)
                    if flow == "restore":
                        withdrawn = research()
                        assert withdrawn["decision"]["recommendation"]["primaryEntityId"] is None
                        items[0] = publication(items[0], "restore")
            elif flow == "publish":
                unpublished = research()
                assert unpublished["claimIds"] == [] and unpublished["decision"]["claimIds"] == []
                assert unpublished["decision"]["recommendation"]["primaryEntityId"] is None
                unpublished_hash = stored_research_hash(client, unpublished["id"])
                items[0] = approve(items[0])
                old = send("GET", "/api/v2/research/" + unpublished["id"], headers=owner)
                assert old["claimIds"] == []
                assert stored_research_hash(client, old["id"]) == unpublished_hash

            result = research()
            decision = result["decision"]
            recommendation = decision["recommendation"]
            if case["expected"] == "blocked":
                assert recommendation["primaryEntityId"] is None
                assert recommendation["alternativeEntityIds"] == []
                assert decision["claimIds"] == [] and decision["comparisons"] == []
                assert decision["status"] == "insufficient-evidence"
            elif case["expected"] == "sole-gpt":
                assert recommendation["primaryEntityId"] == "e-gpt"
                assert recommendation["alternativeEntityIds"] == []
                assert decision["status"] == "ready"
                assert set(decision["claimIds"]) >= {items[-1]["claim"]["id"]}
            else:
                assert case["expected"] == "comparison-only"
                assert recommendation["primaryEntityId"] is None
                assert set(recommendation["alternativeEntityIds"]) == {"e-gpt", "e-claude"}
                quality = next(
                    row for row in decision["comparisons"] if row["id"] == "task-quality"
                )
                assert all(
                    cell["state"] == "unknown" and cell["facts"] == [] for cell in quality["cells"]
                )
            assert not set(case.get("forbiddenCitationIds", [])) & set(result["claimIds"])
            if case.get("forbiddenAllCitations"):
                assert result["claimIds"] == [] and result["citations"] == []
            if case["id"] == "conflicting-current-prices":
                assert "price-unverified-or-conflicting" in " ".join(decision["nextChecks"])
                assert set(result["claimIds"]) == {"semantic-price", "semantic-price-conflict"}
            if case["id"] in {"budget-exact-en", "budget-exact-zh"}:
                prefix = (
                    "在当前约束" if case["language"] == "zh" else "Under the current constraints"
                )
                assert recommendation["summary"].startswith(prefix)
            if flow in {"publish", "superseding", "restore"}:
                assert items[-1]["claim"]["id"] in result["claimIds"]
            with client.app.state.database.session() as session:
                actions = list(session.scalars(select(AuditLogRecord.action)))
            for action in (
                {"review.retract"}
                if flow == "withdrawal"
                else {"review.retract", "review.restore"}
                if flow == "restore"
                else {"review.superseding"}
                if flow == "superseding"
                else set()
            ):
                assert action in actions
            proof["auditActions"] = actions
            proof["finalDecision"] = decision
            proof["ownerIsolationChecked"] = True
            proof["passed"] = True
    finally:
        proof["finishedAt"] = datetime.now(UTC).isoformat()
        if report_dir := os.getenv("DECISION_SEMANTIC_REPORT_DIR"):
            directory = Path(report_dir)
            directory.mkdir(parents=True, exist_ok=True)
            (directory / (case["id"] + ".json")).write_text(
                json.dumps(proof, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
