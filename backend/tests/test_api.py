from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.database import EmailOutboxRecord, SourceRecord
from app.extraction import ExtractionUnavailableError, StructuredExtractionService
from app.fetching import FetchedDocument, SafeHttpFetcher
from app.main import create_app
from app.schemas import CandidateCreate

SEED_PATH = Path(__file__).resolve().parents[1] / "data" / "demo_snapshot.json"


@pytest.fixture
def client(tmp_path: Path):
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        seed_snapshot_path=SEED_PATH,
        admin_token="test-admin-token",
        cors_origins=("http://localhost:3000",),
        automation_token="test-automation-token-with-at-least-32-characters",
        environment="test",
        jwt_secret="test-jwt-secret-that-is-long-enough-for-hs256",
        fetch_allowed_hosts=("example.com",),
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def test_health_exposes_write_boundary(client: TestClient):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "release": "2026.08.14-verbatim-evidence-anchor-v39",
        "environment": "test",
        "dataMode": "demo",
        "database": "sqlite",
        "adminWritesEnabled": True,
        "authEnabled": True,
    }

    ready = client.get("/ready")
    assert ready.status_code == 200
    assert ready.json() == response.json()


def test_admin_operations_requires_admin_and_starts_without_false_heartbeat(
    client: TestClient,
):
    assert client.get("/api/v2/admin/operations").status_code == 401
    response = client.get(
        "/api/v2/admin/operations",
        headers={"X-Admin-Token": "test-admin-token"},
    )
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    payload = response.json()
    assert payload["heartbeatStatus"] == "missing"
    assert payload["worker"] is None
    assert payload["recentRuns"] == []
    assert payload["queues"] == {
        "automaticSources": 0,
        "sourcesDue": 0,
        "sourcesRetrying": 0,
        "extractionReady": 0,
        "extractionRetrying": 0,
        "emailQueued": 0,
        "emailRetrying": 0,
        "emailSending": 0,
        "emailFailed": 0,
    }
    serialized = response.text.casefold()
    assert "password" not in serialized
    assert "api_key" not in serialized


def test_golden_question_report_is_protected_and_executable(client: TestClient):
    endpoint = "/api/v2/admin/golden-questions"
    assert client.get(endpoint).status_code == 401
    response = client.get(endpoint, headers={"X-Admin-Token": "test-admin-token"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 20
    assert payload["passed"] == 18
    assert payload["passRatio"] == 0.9
    assert payload["requiredRatio"] == 0.85
    assert payload["ready"] is True
    assert len(payload["results"]) == 20


def test_automation_cycle_uses_dedicated_token_and_records_heartbeat(client: TestClient):
    endpoint = "/api/v2/automation/run-cycle"
    assert client.post(endpoint).status_code == 401
    assert client.post(endpoint, headers={"X-Automation-Token": "wrong-token"}).status_code == 401

    response = client.post(
        endpoint,
        headers={"X-Automation-Token": "test-automation-token-with-at-least-32-characters"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["workerId"] == "scheduler"
    assert payload["status"] == "succeeded"
    assert payload["result"]["ingestion"] == {
        "due": 0,
        "succeeded": 0,
        "unchanged": 0,
        "failed": 0,
    }
    assert payload["result"]["extraction"] == {
        "configured": False,
        "enabled": False,
        "pipelineVersion": "2026-08-weighted-quality-gap-v5",
        "planned": 0,
        "processed": 0,
        "candidatesCreated": 0,
        "duplicatesSkipped": 0,
        "relationsAutoApproved": 0,
        "failed": 0,
    }

    operations = client.get(
        "/api/v2/admin/operations",
        headers={"X-Admin-Token": "test-admin-token"},
    ).json()
    assert operations["heartbeatStatus"] == "healthy"
    assert operations["worker"]["lastCycleStatus"] == "succeeded"
    assert operations["recentRuns"][0]["id"] == payload["cycleId"]


def test_automation_cycle_extracts_each_new_stored_snapshot_once(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'automatic-extraction.db').as_posix()}",
        seed_snapshot_path=SEED_PATH,
        admin_token="test-admin-token",
        cors_origins=("http://localhost:3000",),
        automation_token="test-automation-token-with-at-least-32-characters",
        environment="test",
        jwt_secret="test-jwt-secret-that-is-long-enough-for-hs256",
        fetch_allowed_hosts=("example.com",),
        extraction_api_url="https://provider.example/v1/chat/completions",
        extraction_api_key="test-provider-key",
        extraction_model="test-structured-model",
        auto_extraction_max_snapshots_per_cycle=2,
    )
    monkeypatch.setattr(
        StructuredExtractionService,
        "extract",
        lambda self, source, snapshot, max_candidates, catalog_entities=None, **kwargs: [],
    )
    with TestClient(create_app(settings)) as automatic_client:
        admin_headers = {"X-Admin-Token": "test-admin-token"}
        automation_headers = {
            "X-Automation-Token": "test-automation-token-with-at-least-32-characters"
        }
        integrations = automatic_client.get(
            "/api/v2/admin/integrations",
            headers=admin_headers,
        ).json()
        assert integrations["automaticExtractionEnabled"] is True
        assert integrations["automaticExtractionMaxSnapshotsPerCycle"] == 2
        assert integrations["automaticExtractionMaxCandidatesPerSnapshot"] == 10
        assert integrations["automaticExtractionRetryMinutes"] == 360
        assert integrations["automaticRelationApprovalEnabled"] is False
        assert integrations["extractionPipelineVersion"] == (
            "2026-08-weighted-quality-gap-v5"
        )
        created = automatic_client.post(
            "/api/v2/admin/sources",
            headers=admin_headers,
            json={
                "id": "source-automatic-extraction",
                "url": "https://example.com/automatic-extraction",
                "title": "Automatic extraction source",
                "publisher": "Example",
            },
        )
        assert created.status_code == 201
        snapshot = automatic_client.post(
            "/api/v2/admin/sources/source-automatic-extraction/snapshots",
            headers=admin_headers,
            json={"content": "This source contains an explicit, verifiable product fact."},
        )
        assert snapshot.status_code == 200
        with automatic_client.app.state.database.session() as session:
            source = session.get(SourceRecord, "source-automatic-extraction")
            assert source is not None
            assert source.fetch_enabled is False

        first = automatic_client.post(
            "/api/v2/automation/run-cycle",
            headers=automation_headers,
        )
        assert first.status_code == 200
        assert first.json()["result"]["extraction"] == {
            "configured": True,
            "enabled": True,
            "pipelineVersion": "2026-08-weighted-quality-gap-v5",
            "planned": 1,
            "processed": 1,
            "candidatesCreated": 0,
            "duplicatesSkipped": 0,
            "relationsAutoApproved": 0,
            "failed": 0,
        }

        second = automatic_client.post(
            "/api/v2/automation/run-cycle",
            headers=automation_headers,
        )
        assert second.status_code == 200
        assert second.json()["result"]["extraction"]["planned"] == 0
        assert second.json()["result"]["extraction"]["processed"] == 0

        changed = automatic_client.post(
            "/api/v2/admin/sources/source-automatic-extraction/snapshots",
            headers=admin_headers,
            json={"content": "This revised source contains another explicit product fact."},
        )
        assert changed.status_code == 200

        def fail_extraction(*args, **kwargs):
            raise ExtractionUnavailableError("Provider is temporarily unavailable.")

        monkeypatch.setattr(StructuredExtractionService, "extract", fail_extraction)
        failed = automatic_client.post(
            "/api/v2/automation/run-cycle",
            headers=automation_headers,
        )
        assert failed.status_code == 200
        assert failed.json()["status"] == "partial"
        assert failed.json()["result"]["extraction"]["processed"] == 0
        assert failed.json()["result"]["extraction"]["failed"] == 1
        retry_plan = automatic_client.get(
            "/api/v2/admin/extraction-plan",
            headers=admin_headers,
        ).json()
        assert any(
            item["snapshotId"] == changed.json()["snapshotId"] for item in retry_plan
        )
        cooling_down = automatic_client.post(
            "/api/v2/automation/run-cycle",
            headers=automation_headers,
        )
        assert cooling_down.status_code == 200
        assert cooling_down.json()["result"]["extraction"]["planned"] == 0


def test_automation_extraction_failure_does_not_block_the_next_snapshot(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'isolated-extraction.db').as_posix()}",
        seed_snapshot_path=SEED_PATH,
        admin_token="test-admin-token",
        cors_origins=("http://localhost:3000",),
        automation_token="test-automation-token-with-at-least-32-characters",
        environment="test",
        jwt_secret="test-jwt-secret-that-is-long-enough-for-hs256",
        fetch_allowed_hosts=("example.com",),
        extraction_api_url="https://provider.example/v1/chat/completions",
        extraction_api_key="test-provider-key",
        extraction_model="test-structured-model",
        auto_extraction_max_snapshots_per_cycle=2,
    )
    extraction_calls: list[str] = []

    def extract_with_first_failure(
        self,
        source,
        snapshot,
        max_candidates,
        catalog_entities=None,
        **kwargs,
    ):
        extraction_calls.append(source.id)
        if len(extraction_calls) == 1:
            raise ExtractionUnavailableError("The first source is temporarily unavailable.")
        return []

    monkeypatch.setattr(StructuredExtractionService, "extract", extract_with_first_failure)
    with TestClient(create_app(settings)) as automatic_client:
        admin_headers = {"X-Admin-Token": "test-admin-token"}
        for suffix in ("one", "two"):
            source_id = f"source-isolated-{suffix}"
            created = automatic_client.post(
                "/api/v2/admin/sources",
                headers=admin_headers,
                json={
                    "id": source_id,
                    "url": f"https://example.com/isolated-{suffix}",
                    "title": f"Isolated extraction source {suffix}",
                    "publisher": "Example",
                },
            )
            assert created.status_code == 201
            snapshot = automatic_client.post(
                f"/api/v2/admin/sources/{source_id}/snapshots",
                headers=admin_headers,
                json={"content": f"Explicit source fact for {suffix}."},
            )
            assert snapshot.status_code == 200
            with automatic_client.app.state.database.session() as session:
                source = session.get(SourceRecord, source_id)
                assert source is not None
                source.fetch_enabled = True
                source.next_fetch_at = datetime.now(UTC) + timedelta(days=1)
                session.commit()

        response = automatic_client.post(
            "/api/v2/automation/run-cycle",
            headers={
                "X-Automation-Token": "test-automation-token-with-at-least-32-characters"
            },
        )
        assert response.status_code == 200
        extraction = response.json()["result"]["extraction"]
        assert extraction["planned"] == 2
        assert extraction["processed"] == 1
        assert extraction["failed"] == 1
        assert len(extraction_calls) == 2


def test_automation_only_auto_approves_strictly_grounded_low_ambiguity_relations(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'grounded-relations.db').as_posix()}",
        seed_snapshot_path=SEED_PATH,
        admin_token="test-admin-token",
        cors_origins=("http://localhost:3000",),
        automation_token="test-automation-token-with-at-least-32-characters",
        environment="test",
        jwt_secret="test-jwt-secret-that-is-long-enough-for-hs256",
        fetch_allowed_hosts=("example.com",),
        extraction_api_url="https://provider.example/v1/chat/completions",
        extraction_api_key="test-provider-key",
        extraction_model="test-structured-model",
        auto_extraction_max_snapshots_per_cycle=1,
        auto_approve_grounded_relations=True,
    )

    def candidate(candidate_id: str, predicate: str, value: str) -> CandidateCreate:
        return CandidateCreate.model_validate(
            {
                "id": candidate_id,
                "claim": {
                    "id": f"claim-{candidate_id}",
                    "text": {
                        "zh": f"GPT 系列的关系为 {predicate} {value}。",
                        "en": f"GPT family has relation {predicate} {value}.",
                    },
                    "confidence": "unverified",
                    "sourceIds": [f"evidence-{candidate_id}"],
                    "updatedAt": "2026-08-13",
                    "subject": "GPT family",
                    "predicate": predicate,
                    "objectOrValue": value,
                },
                "evidence": [
                    {
                        "id": f"evidence-{candidate_id}",
                        "title": {"zh": "官方关系说明", "en": "Official relation note"},
                        "url": "https://example.com/grounded-relations",
                        "publisher": "Example",
                        "publishedAt": "2026-08-13",
                        "collectedAt": "2026-08-13",
                        "type": "official",
                    }
                ],
            }
        )

    with TestClient(create_app(settings)) as automatic_client:
        admin_headers = {"X-Admin-Token": "test-admin-token"}
        automation_headers = {
            "X-Automation-Token": "test-automation-token-with-at-least-32-characters"
        }
        source = automatic_client.post(
            "/api/v2/admin/sources",
            headers=admin_headers,
            json={
                "id": "source-grounded-relations",
                "url": "https://example.com/grounded-relations",
                "title": "Grounded relations",
                "publisher": "Example",
            },
        )
        assert source.status_code == 201
        first_snapshot = automatic_client.post(
            "/api/v2/admin/sources/source-grounded-relations/snapshots",
            headers=admin_headers,
            json={"content": "GPT family uses MCP according to this official record."},
        )
        assert first_snapshot.status_code == 200
        with automatic_client.app.state.database.session() as session:
            row = session.get(SourceRecord, "source-grounded-relations")
            assert row is not None
            row.fetch_enabled = True
            row.next_fetch_at = datetime.now(UTC) + timedelta(days=1)
            session.commit()
        monkeypatch.setattr(
            StructuredExtractionService,
            "extract",
            lambda *args, **kwargs: [
                candidate("review-grounded-relation", "uses", "MCP")
            ],
        )

        approved = automatic_client.post(
            "/api/v2/automation/run-cycle",
            headers=automation_headers,
        )
        assert approved.status_code == 200
        assert approved.json()["result"]["extraction"]["relationsAutoApproved"] == 1
        queue = automatic_client.get(
            "/api/v2/admin/review-queue",
            headers=admin_headers,
        ).json()
        grounded = next(item for item in queue if item["id"] == "review-grounded-relation")
        assert grounded["status"] == "approved"
        assert grounded["reviewMethod"] == "automation"
        assert grounded["reviewReason"].startswith("自动批准")
        publications = automatic_client.get(
            "/api/v2/admin/publication-history",
            headers=admin_headers,
        ).json()
        assert publications[0]["actor"] == "automation@ai-radar.local"
        snapshot = automatic_client.get("/api/snapshot").json()
        automatic_evidence = next(
            evidence
            for evidence in snapshot["evidence"]
            if evidence["id"] == "evidence-review-grounded-relation"
        )
        assert automatic_evidence["verifiedAt"] is None

        verified = automatic_client.post(
            "/api/v2/admin/review-queue/batch-verify-automation",
            headers=admin_headers,
            json={
                "items": [
                    {
                        "id": grounded["id"],
                        "expectedVersion": grounded["version"],
                        "reason": "人工复核：已对照官方证据确认关系表述一致。",
                    }
                ]
            },
        )
        assert verified.status_code == 200
        assert verified.json()[0]["reviewMethod"] == "human"
        assert verified.json()[0]["version"] == grounded["version"] + 1
        verified_snapshot = automatic_client.get("/api/snapshot").json()
        verified_evidence = next(
            evidence
            for evidence in verified_snapshot["evidence"]
            if evidence["id"] == "evidence-review-grounded-relation"
        )
        assert verified_evidence["verifiedAt"] is not None
        repeated = automatic_client.post(
            "/api/v2/admin/review-queue/batch-verify-automation",
            headers=admin_headers,
            json={
                "items": [
                    {
                        "id": grounded["id"],
                        "expectedVersion": grounded["version"],
                        "reason": "再次确认不应覆盖首次人工复核。",
                    }
                ]
            },
        )
        assert repeated.status_code == 409

        second_snapshot = automatic_client.post(
            "/api/v2/admin/sources/source-grounded-relations/snapshots",
            headers=admin_headers,
            json={"content": "GPT family and Anthropic are both mentioned in this record."},
        )
        assert second_snapshot.status_code == 200
        monkeypatch.setattr(
            StructuredExtractionService,
            "extract",
            lambda *args, **kwargs: [
                candidate("review-unanchored-relation", "developed-by", "Anthropic")
            ],
        )
        pending = automatic_client.post(
            "/api/v2/automation/run-cycle",
            headers=automation_headers,
        )
        assert pending.status_code == 200
        assert pending.json()["result"]["extraction"]["relationsAutoApproved"] == 0
        queue = automatic_client.get(
            "/api/v2/admin/review-queue",
            headers=admin_headers,
        ).json()
        unanchored = next(
            item for item in queue if item["id"] == "review-unanchored-relation"
        )
        assert unanchored["status"] == "pending"

        merged_snapshot = automatic_client.post(
            "/api/v2/admin/sources/source-grounded-relations/snapshots",
            headers=admin_headers,
            json={"content": "GPT family and Anthropic are repeated with additional evidence."},
        )
        assert merged_snapshot.status_code == 200
        monkeypatch.setattr(
            StructuredExtractionService,
            "extract",
            lambda *args, **kwargs: [
                candidate("review-merged-evidence", "developed-by", "Anthropic")
            ],
        )
        merged = automatic_client.post(
            "/api/v2/automation/run-cycle",
            headers=automation_headers,
        )
        assert merged.status_code == 200
        merged_extraction = merged.json()["result"]["extraction"]
        assert merged_extraction["candidatesCreated"] == 0
        assert merged_extraction["duplicatesSkipped"] == 1
        queue = automatic_client.get(
            "/api/v2/admin/review-queue",
            headers=admin_headers,
        ).json()
        merged_candidate = next(
            item for item in queue if item["id"] == "review-unanchored-relation"
        )
        assert len(merged_candidate["evidenceIds"]) == 2
        assert merged_candidate["version"] == 2
        assert all(item["id"] != "review-merged-evidence" for item in queue)

        duplicate_snapshot = automatic_client.post(
            "/api/v2/admin/sources/source-grounded-relations/snapshots",
            headers=admin_headers,
            json={"content": "GPT family is developed-by OpenAI according to this repeated record."},
        )
        assert duplicate_snapshot.status_code == 200
        monkeypatch.setattr(
            StructuredExtractionService,
            "extract",
            lambda *args, **kwargs: [
                candidate("review-duplicate-relation", "developed-by", "OpenAI")
            ],
        )
        duplicate = automatic_client.post(
            "/api/v2/automation/run-cycle",
            headers=automation_headers,
        )
        assert duplicate.status_code == 200
        extraction = duplicate.json()["result"]["extraction"]
        assert extraction["candidatesCreated"] == 0
        assert extraction["duplicatesSkipped"] == 1
        queue = automatic_client.get(
            "/api/v2/admin/review-queue",
            headers=admin_headers,
        ).json()
        assert all(item["id"] != "review-duplicate-relation" for item in queue)


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


def test_live_mode_fails_closed_until_data_quality_is_ready(tmp_path: Path):
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'live-gate.db').as_posix()}",
        seed_snapshot_path=SEED_PATH,
        admin_token="test-admin-token",
        cors_origins=("https://radar.example",),
        environment="production",
        data_mode="live",
        jwt_secret="test-jwt-secret-that-is-long-enough-for-hs256",
    )
    with TestClient(create_app(settings)) as live_client:
        assert live_client.get("/health").status_code == 200
        ready = live_client.get("/ready")
        assert ready.status_code == 503
        assert ready.json()["detail"] == "Live data quality gate is not satisfied."
        snapshot = live_client.get("/api/v2/snapshot")
        assert snapshot.status_code == 503
        assert snapshot.json()["detail"] == "Live data quality gate is not satisfied."

        quality = live_client.get(
            "/api/v2/admin/data-quality",
            headers={"X-Admin-Token": "test-admin-token"},
        )
        assert quality.status_code == 200
        assert quality.json()["liveReady"] is False
        assert quality.json()["issues"]


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


def test_non_model_entities_expose_editorial_knowledge_articles(client: TestClient):
    entity = client.get("/api/v2/entities/framework/mcp")
    assert entity.status_code == 200
    knowledge = entity.json()["knowledge"]
    assert len(knowledge["introduction"]) >= 2
    assert len(knowledge["keyPoints"]) >= 3
    assert len(knowledge["useCases"]) >= 3
    assert len(knowledge["limitations"]) >= 2
    assert knowledge["officialUrl"].startswith("https://")
    assert all(point["sourceIds"] for point in knowledge["keyPoints"])


def test_model_families_expose_editorial_guides(client: TestClient):
    families = client.get("/api/v2/model-families")
    assert families.status_code == 200
    assert len(families.json()) == 8

    for family in families.json():
        entity = client.get(f"/api/v2/entities/model/{family['slug']}")
        assert entity.status_code == 200
        knowledge = entity.json()["knowledge"]
        assert len(knowledge["introduction"]) >= 2
        assert len(knowledge["keyPoints"]) >= 3
        assert len(knowledge["useCases"]) >= 3
        assert len(knowledge["limitations"]) >= 3
        assert knowledge["officialUrl"].startswith("https://")
        assert any(point.get("sourceIds") for point in knowledge["keyPoints"])


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

    kimi_versions = client.get("/api/v2/model-families/e-kimi/versions")
    assert kimi_versions.status_code == 200
    assert [item["id"] for item in kimi_versions.json()] == [
        "e-kimi-k26",
        "e-kimi-k3",
    ]

    ernie_versions = client.get("/api/v2/model-families/e-ernie/versions")
    assert ernie_versions.status_code == 200
    assert [item["id"] for item in ernie_versions.json()] == [
        "e-ernie-45",
        "e-ernie-50",
        "e-ernie-51",
    ]

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


def test_admin_integration_status_never_exposes_secrets(client: TestClient):
    response = client.get(
        "/api/v2/admin/integrations",
        headers={"X-Admin-Token": "test-admin-token"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload == {
        "extractionConfigured": False,
        "extractionPipelineVersion": "2026-08-weighted-quality-gap-v5",
        "extractionEndpointHost": None,
        "extractionModel": None,
        "automaticExtractionEnabled": False,
        "automaticExtractionMaxSnapshotsPerCycle": 0,
        "automaticExtractionMaxCandidatesPerSnapshot": 10,
        "automaticExtractionRetryMinutes": 360,
        "automaticRelationApprovalEnabled": False,
        "smtpConfigured": False,
        "smtpHost": None,
        "smtpFrom": None,
        "fetchAllowedHosts": ["example.com"],
        "registeredSources": 30,
        "automaticSources": 0,
        "digestTimezone": "Asia/Shanghai",
    }
    serialized = response.text.casefold()
    assert "secret" not in serialized
    assert "password" not in serialized
    assert "api_key" not in serialized


def test_admin_extraction_probe_is_protected_audited_and_safe_when_unconfigured(
    client: TestClient,
):
    endpoint = "/api/v2/admin/integrations/extraction/probe"
    assert client.post(endpoint).status_code == 401

    response = client.post(endpoint, headers={"X-Admin-Token": "test-admin-token"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["configured"] is False
    assert payload["passed"] is False
    assert payload["errorCode"] == "not_configured"
    assert payload["endpointHost"] is None
    assert "api_key" not in response.text.casefold()
    audit = client.get(
        "/api/v2/admin/audit-log",
        headers={"X-Admin-Token": "test-admin-token"},
    ).json()
    assert any(entry["action"] == "integration.extraction.probe" for entry in audit)


def test_admin_production_readiness_reports_blockers_without_secrets(client: TestClient):
    assert client.get("/api/v2/admin/production-readiness").status_code == 401
    response = client.get(
        "/api/v2/admin/production-readiness",
        headers={"X-Admin-Token": "test-admin-token"},
    )
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    payload = response.json()
    assert payload["automatedReady"] is False
    assert payload["blockingCount"] > 0
    assert payload["warningCount"] == 1
    checks = {check["code"]: check for check in payload["checks"]}
    assert checks["runtime_environment"]["status"] == "blocked"
    assert checks["live_data_mode"]["status"] == "blocked"
    assert checks["database_schema"]["status"] == "blocked"
    assert checks["jwt_authentication"]["status"] == "ready"
    assert checks["legacy_admin_token"]["status"] == "warning"
    assert checks["worker_heartbeat"]["status"] == "blocked"
    assert len(payload["manualChecks"]) == 4
    serialized = response.text.casefold()
    assert "test-admin-token" not in serialized
    assert "jwt-secret" not in serialized
    assert "password" not in serialized
    assert "api_key" not in serialized


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
        automation = test_client.post("/api/v2/automation/run-cycle")
        assert automation.status_code == 503
        assert "not configured" in automation.json()["detail"]


def test_approve_publishes_claim_once_and_records_history(client: TestClient):
    headers = {"X-Admin-Token": "test-admin-token"}
    queue_response = client.get("/api/v2/admin/review-queue", headers=headers)
    assert queue_response.headers["cache-control"] == "no-store"
    queue = queue_response.json()
    review = next(item for item in queue if item["id"] == "review-gpt-context")
    assert review["evidenceItems"]
    assert review["evidenceItems"][0]["id"] in review["evidenceIds"]
    assert review["evidenceItems"][0]["url"].startswith("https://")

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
    assert approved.json()["claim"]["confidence"] == "verified"
    assert approved.json()["reviewMethod"] == "human"

    snapshot = client.get("/api/snapshot").json()
    published_claim = next(claim for claim in snapshot["claims"] if claim["id"] == "c-gpt5-1m")
    assert published_claim["confidence"] == "verified"
    published_evidence = next(
        evidence for evidence in snapshot["evidence"] if evidence["id"] in review["evidenceIds"]
    )
    assert published_evidence["verifiedAt"] is not None

    repeated = client.post(
        f"/api/v2/admin/review-queue/{review['id']}/approve",
        headers=headers,
        json={
            "expectedVersion": review["version"],
            "reason": "Attempting the same review again.",
        },
    )
    assert repeated.status_code == 200
    assert repeated.json()["status"] == "approved"
    assert repeated.json()["version"] == approved.json()["version"]

    opposite = client.post(
        f"/api/v2/admin/review-queue/{review['id']}/reject",
        headers=headers,
        json={
            "expectedVersion": approved.json()["version"],
            "reason": "Attempting the opposite decision.",
        },
    )
    assert opposite.status_code == 409

    history = client.get("/api/v2/admin/publication-history", headers=headers)
    assert history.status_code == 200
    assert len(history.json()) == 1
    assert history.json()[0]["claimId"] == "c-gpt5-1m"


def create_batch_review_candidate(
    client: TestClient,
    headers: dict[str, str],
    suffix: str,
    *,
    anchored: bool = True,
) -> dict[str, object]:
    evidence = {
        "id": f"evidence-batch-context-{suffix}",
        "title": {"zh": "GPT 官方文档", "en": "GPT official docs"},
        "url": f"https://example.com/gpt-context-{suffix}",
        "publisher": "OpenAI",
        "publishedAt": "2026-08-14",
        "collectedAt": "2026-08-14",
        "type": "official",
    }
    if anchored:
        evidence["sourceExcerpt"] = f"GPT has configurable context {suffix}."
    created = client.post(
        "/api/v2/admin/review-candidates",
        headers=headers,
        json={
            "id": f"review-batch-context-{suffix}",
            "entityId": "e-gpt",
            "claim": {
                "id": f"claim-batch-context-{suffix}",
                "text": {
                    "zh": f"GPT 系列提供可配置的上下文能力 {suffix}。",
                    "en": f"The GPT family provides configurable context capability {suffix}.",
                },
                "confidence": "unverified",
                "sourceIds": [f"evidence-batch-context-{suffix}"],
                "updatedAt": "2026-08-14",
                "subject": "GPT",
                "predicate": "has-capability",
                "objectOrValue": f"configurable context {suffix}",
            },
            "evidence": [evidence],
        },
    )
    assert created.status_code == 201
    candidate = created.json()
    assert candidate["status"] == "pending"
    return candidate


def test_batch_approve_publishes_multiple_reviews_in_one_transaction(client: TestClient):
    headers = {"X-Admin-Token": "test-admin-token"}
    first = create_batch_review_candidate(client, headers, "one")
    second = create_batch_review_candidate(client, headers, "two")

    endpoint = "/api/v2/admin/review-queue/batch-approve"
    assert client.post(endpoint, json={"items": []}).status_code == 401
    approved = client.post(
        endpoint,
        headers=headers,
        json={
            "items": [
                {
                    "id": first["id"],
                    "expectedVersion": first["version"],
                    "reason": "已批量核对官方证据和事实。",
                },
                {
                    "id": second["id"],
                    "expectedVersion": second["version"],
                    "reason": "已批量核对官方证据和事实。",
                },
            ]
        },
    )
    assert approved.status_code == 200
    assert {item["id"] for item in approved.json()} == {first["id"], second["id"]}
    assert all(item["status"] == "approved" for item in approved.json())
    history = client.get("/api/v2/admin/publication-history", headers=headers).json()
    assert {item["claimId"] for item in history} == {
        "claim-batch-context-one",
        "claim-batch-context-two",
    }


def test_batch_approve_rejects_evidence_without_an_anchored_excerpt(client: TestClient):
    headers = {"X-Admin-Token": "test-admin-token"}
    candidate = create_batch_review_candidate(
        client,
        headers,
        "unanchored",
        anchored=False,
    )

    response = client.post(
        "/api/v2/admin/review-queue/batch-approve",
        headers=headers,
        json={
            "items": [
                {
                    "id": candidate["id"],
                    "expectedVersion": candidate["version"],
                    "reason": "缺少原文锚点时不能批量批准。",
                }
            ]
        },
    )

    assert response.status_code == 409
    queue = client.get("/api/v2/admin/review-queue", headers=headers).json()
    unchanged = next(item for item in queue if item["id"] == candidate["id"])
    assert unchanged["status"] == "pending"


def test_batch_approve_rolls_back_every_decision_when_one_item_fails(client: TestClient):
    headers = {"X-Admin-Token": "test-admin-token"}
    existing = create_batch_review_candidate(client, headers, "rollback")
    response = client.post(
        "/api/v2/admin/review-queue/batch-approve",
        headers=headers,
        json={
            "items": [
                {
                    "id": existing["id"],
                    "expectedVersion": existing["version"],
                    "reason": "已核对第一条事实和官方证据。",
                },
                {
                    "id": "review-does-not-exist",
                    "expectedVersion": 1,
                    "reason": "该条用于验证事务回滚。",
                },
            ]
        },
    )
    assert response.status_code == 404
    refreshed = next(
        item
        for item in client.get("/api/v2/admin/review-queue", headers=headers).json()
        if item["id"] == existing["id"]
    )
    assert refreshed["status"] == existing["status"]
    assert refreshed["version"] == existing["version"]
    assert client.get("/api/v2/admin/publication-history", headers=headers).json() == []


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


def test_approved_canonical_relation_claim_updates_graph(client: TestClient):
    headers = {"X-Admin-Token": "test-admin-token"}
    submitted = client.post(
        "/api/v2/admin/review-candidates",
        headers=headers,
        json={
            "id": "review-claude-code-uses-mcp",
            "entityId": "e-claude-code",
            "claim": {
                "id": "claim-claude-code-uses-mcp",
                "text": {
                    "zh": "Claude Code 使用 MCP 连接外部工具。",
                    "en": "Claude Code uses MCP to connect external tools.",
                },
                "confidence": "unverified",
                "sourceIds": ["evidence-claude-code-uses-mcp"],
                "updatedAt": "2026-08-13",
                "subject": "Claude Code",
                "predicate": "uses",
                "objectOrValue": "MCP",
            },
            "evidence": [
                {
                    "id": "evidence-claude-code-uses-mcp",
                    "title": {"zh": "Claude Code 官方文档", "en": "Claude Code docs"},
                    "url": "https://example.com/claude-code-mcp",
                    "publisher": "Anthropic",
                    "publishedAt": "2026-08-13",
                    "collectedAt": "2026-08-13",
                    "type": "official",
                }
            ],
        },
    )
    assert submitted.status_code == 201
    review = submitted.json()

    approved = client.post(
        f"/api/v2/admin/review-queue/{review['id']}/approve",
        headers=headers,
        json={
            "expectedVersion": review["version"],
            "reason": "Official relation evidence checked by a human reviewer.",
        },
    )
    assert approved.status_code == 200

    snapshot = client.get("/api/snapshot").json()
    relation = next(
        edge
        for edge in snapshot["graph"]["edges"]
        if edge["fromId"] == "e-claude-code"
        and edge["toId"] == "e-mcp"
        and edge["kind"] == "uses"
    )
    assert relation["confidence"] == "verified"
    assert "evidence-claude-code-uses-mcp" in relation["sourceIds"]


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
    assert client.get("/api/v2/admin/integrations", headers=reviewer_headers).status_code == 403
    assert client.get("/api/v2/admin/operations", headers=reviewer_headers).status_code == 403
    assert (
        client.get("/api/v2/admin/production-readiness", headers=reviewer_headers).status_code
        == 403
    )

    audit = client.get("/api/v2/admin/audit-log", headers=admin_headers)
    assert audit.status_code == 200
    assert {item["action"] for item in audit.json()} >= {"user.bootstrap", "user.create"}


def test_source_snapshots_are_normalized_deduplicated_and_diffed(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
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
    assert created.json()["fetchEnabled"] is False

    monkeypatch.setattr(
        SafeHttpFetcher,
        "fetch",
        lambda self, url, **kwargs: FetchedDocument(
            content="A sufficiently long official release document for preflight.",
            content_type="text/html",
            etag=None,
            last_modified=None,
        ),
    )
    probe = client.post(
        "/api/v2/admin/sources/source-demo-release/probe",
        headers=headers,
    )
    assert probe.status_code == 200

    enabled = client.patch(
        "/api/v2/admin/sources/source-demo-release",
        headers=headers,
        json={"fetchEnabled": True, "fetchIntervalMinutes": 360},
    )
    assert enabled.status_code == 200
    assert enabled.json()["active"] is True
    assert enabled.json()["fetchEnabled"] is True
    assert enabled.json()["fetchIntervalMinutes"] == 360
    assert enabled.json()["nextFetchAt"] is None

    retried = client.post(
        "/api/v2/admin/sources/source-demo-release/retry",
        headers=headers,
        json={"expectedFailureCount": 0},
    )
    assert retried.status_code == 200
    assert retried.json()["nextFetchAt"] is None
    assert retried.json()["consecutiveFailures"] == 0

    first = client.post(
        "/api/v2/admin/sources/source-demo-release/snapshots",
        headers=headers,
        json={"content": "Version 1 introduces evidence-linked graph queries."},
    )
    assert first.status_code == 200
    assert first.json()["changeType"] == "created"

    snapshots = client.get(
        "/api/v2/admin/sources/source-demo-release/snapshots",
        headers=headers,
    )
    assert snapshots.status_code == 200
    assert snapshots.json()[0]["id"] == first.json()["snapshotId"]
    assert snapshots.json()[0]["readableCharacters"] == 51
    assert "evidence-linked graph" in snapshots.json()[0]["contentPreview"]
    assert client.get("/api/v2/admin/sources/source-demo-release/snapshots").status_code == 401

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

    collected = client.post(
        "/api/v2/admin/sources/source-demo-release/collect",
        headers=headers,
    )
    assert collected.status_code == 200
    assert collected.json() == {"due": 1, "succeeded": 1, "unchanged": 0, "failed": 0}
    assert client.post("/api/v2/admin/sources/source-demo-release/collect").status_code == 401

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

    disabled = client.patch(
        "/api/v2/admin/sources/source-demo-release",
        headers=headers,
        json={"active": False},
    )
    assert disabled.status_code == 200
    assert disabled.json()["active"] is False
    assert disabled.json()["fetchEnabled"] is False

    missing = client.patch(
        "/api/v2/admin/sources/source-missing",
        headers=headers,
        json={"fetchEnabled": True},
    )
    assert missing.status_code == 404


def test_extraction_plan_only_returns_latest_unprocessed_snapshot(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    headers = {"X-Admin-Token": "test-admin-token"}
    created = client.post(
        "/api/v2/admin/sources",
        headers=headers,
        json={
            "id": "source-extraction-plan",
            "url": "https://example.com/extraction-plan",
            "title": "Extraction plan source",
            "publisher": "Example",
        },
    )
    assert created.status_code == 201
    first = client.post(
        "/api/v2/admin/sources/source-extraction-plan/snapshots",
        headers=headers,
        json={"content": "The first source document contains an explicit fact."},
    ).json()
    latest = client.post(
        "/api/v2/admin/sources/source-extraction-plan/snapshots",
        headers=headers,
        json={"content": "The latest source document contains a revised explicit fact."},
    ).json()

    assert client.get("/api/v2/admin/extraction-plan").status_code == 401
    planned = client.get("/api/v2/admin/extraction-plan", headers=headers)
    assert planned.status_code == 200
    assert planned.headers["cache-control"] == "no-store"
    item = next(row for row in planned.json() if row["sourceId"] == "source-extraction-plan")
    assert item["snapshotId"] == latest["snapshotId"]
    assert item["snapshotId"] != first["snapshotId"]

    monkeypatch.setattr(
        StructuredExtractionService,
        "extract",
        lambda self, source, snapshot, max_candidates, catalog_entities=None, **kwargs: [],
    )
    extracted = client.post(
        "/api/v2/admin/sources/source-extraction-plan/extract",
        headers=headers,
        json={"snapshotId": latest["snapshotId"], "maxCandidates": 15},
    )
    assert extracted.status_code == 200
    assert extracted.json() == []

    refreshed = client.get("/api/v2/admin/extraction-plan", headers=headers).json()
    assert not any(row["sourceId"] == "source-extraction-plan" for row in refreshed)


def test_extraction_plan_prioritizes_sources_that_mention_relation_gaps(
    client: TestClient,
):
    headers = {"X-Admin-Token": "test-admin-token"}
    for source_id in (
        "source-high-priority-plan",
        "source-low-priority-plan",
        "source-generic-plan",
    ):
        response = client.post(
            "/api/v2/admin/sources",
            headers=headers,
            json={
                "id": source_id,
                "url": f"https://example.com/{source_id}",
                "title": source_id,
                "publisher": "Example",
            },
        )
        assert response.status_code == 201

    high_priority = client.post(
        "/api/v2/admin/sources/source-high-priority-plan/snapshots",
        headers=headers,
        json={"content": "Manus uses an official tool integration."},
    )
    assert high_priority.status_code == 200
    low_priority = client.post(
        "/api/v2/admin/sources/source-low-priority-plan/snapshots",
        headers=headers,
        json={"content": "Gemini family uses an official tool integration."},
    )
    assert low_priority.status_code == 200
    generic = client.post(
        "/api/v2/admin/sources/source-generic-plan/snapshots",
        headers=headers,
        json={"content": "A newer generic document contains an explicit fact."},
    )
    assert generic.status_code == 200

    planned = client.get(
        "/api/v2/admin/extraction-plan?limit=50",
        headers=headers,
    ).json()
    source_order = [row["sourceId"] for row in planned]
    assert source_order.index("source-high-priority-plan") < source_order.index(
        "source-low-priority-plan"
    )
    assert source_order.index("source-low-priority-plan") < source_order.index(
        "source-generic-plan"
    )


def test_source_probe_is_admin_only_read_only_and_audited(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    headers = {"X-Admin-Token": "test-admin-token"}
    created = client.post(
        "/api/v2/admin/sources",
        headers=headers,
        json={
            "id": "source-probe",
            "url": "https://example.com/releases",
            "title": "Example probe source",
            "publisher": "Example",
        },
    )
    assert created.status_code == 201

    monkeypatch.setattr(
        SafeHttpFetcher,
        "fetch",
        lambda self, url: FetchedDocument(
            content="A sufficiently long official release document for preflight.",
            content_type="text/html",
            etag='"release-v1"',
            last_modified="Wed, 12 Aug 2026 12:00:00 GMT",
            final_url="https://example.com/canonical-release",
        ),
    )

    assert client.post("/api/v2/admin/sources/source-probe/probe").status_code == 401
    response = client.post(
        "/api/v2/admin/sources/source-probe/probe",
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json() == {
        "sourceId": "source-probe",
        "url": "https://example.com/canonical-release",
        "contentType": "text/html",
        "readableCharacters": 60,
        "etag": '"release-v1"',
        "lastModified": "Wed, 12 Aug 2026 12:00:00 GMT",
    }
    source = client.get("/api/v2/admin/sources", headers=headers).json()[-1]
    assert source["lastSeenAt"] is None
    assert source["lastProbeStatus"] == "passed"
    assert source["lastProbeContentType"] == "text/html"
    assert source["lastProbeReadableCharacters"] == 60
    assert source["url"] == "https://example.com/canonical-release"
    audit = client.get("/api/v2/admin/audit-log", headers=headers)
    assert any(
        entry["action"] == "source.probe" and entry["targetId"] == "source-probe"
        for entry in audit.json()
    )
    assert any(
        entry["action"] == "source.canonical_url_adopted" and entry["targetId"] == "source-probe"
        for entry in audit.json()
    )


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
    published_claim = next(
        claim for claim in after["claims"] if claim["id"] == "c-ingested-capability"
    )
    assert published_claim["entityId"] == "e-gpt"
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
    assert (
        client.delete(f"/api/v2/following/{followed.json()['id']}", headers=headers).status_code
        == 204
    )
    assert client.get("/api/v2/following", headers=headers).json() == []

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
    outbox = client.get("/api/v2/admin/email-outbox", headers=headers).json()[0]
    assert outbox["status"] == "queued"
    with client.app.state.database.session() as session:
        row = session.get(EmailOutboxRecord, outbox["id"])
        assert row is not None
        row.status = "failed"
        row.attempt_count = 5
        row.error = "Temporary test delivery failure"
        session.commit()
    retried = client.post(
        f"/api/v2/admin/email-outbox/{outbox['id']}/retry",
        headers=headers,
        json={"expectedAttemptCount": 5},
    )
    assert retried.status_code == 200
    assert retried.json()["status"] == "queued"
    assert retried.json()["attemptCount"] == 0
    assert retried.json()["error"] is None
    assert (
        client.post(
            f"/api/v2/admin/email-outbox/{outbox['id']}/retry",
            headers=headers,
            json={"expectedAttemptCount": 5},
        ).status_code
        == 409
    )

    research = client.post(
        "/api/v2/research",
        headers=headers,
        json={"question": "GPT 最近有什么已经核验的变化？", "language": "zh"},
    )
    assert research.status_code == 200
    assert research.json()["status"] == "ready"
    assert "claim-gpt-notification" in research.json()["claimIds"]

    agent_research = client.post(
        "/api/v2/research",
        headers=headers,
        json={
            "question": "OpenAI Codex、Claude Code 和 Devin 分别能做什么？",
            "language": "zh",
        },
    )
    assert agent_research.status_code == 200
    assert set(agent_research.json()["claimIds"]) == {
        "c-codex-agent",
        "c-claude-code-agent",
        "c-devin-agent",
    }
    assert agent_research.json()["steps"][1]["detail"]["en"] == ("Matched 3 entities and 3 claims")

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
