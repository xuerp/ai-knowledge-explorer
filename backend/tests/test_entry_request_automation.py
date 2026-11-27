from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import Settings
from app.database import AuditLogRecord, EntryRequestRecord, SourceRecord
from app.entry_request_automation import request_kind
from app.extraction import StructuredExtractionService
from app.fetching import FetchedDocument, SafeHttpFetcher
from app.main import create_app
from app.schemas import CandidateCreate

SEED_PATH = Path(__file__).resolve().parents[1] / "data" / "demo_snapshot.json"
PAGE = "### November 9, 2026\n\nGPT-6.3 Sol has a 2M token context window for every developer."


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        database_url=f"sqlite:///{(tmp_path / 'entry-auto.db').as_posix()}",
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
        auto_extraction_max_snapshots_per_day=10,
    )


def _request(request_id: str, url: str, reason: str, name: str = "GPT-6.3 Sol"):
    return EntryRequestRecord(
        id=request_id,
        name=name,
        entity_type="model",
        source_url=url,
        reason=reason,
        status="pending",
        created_at=datetime.now(UTC) - timedelta(minutes=5),
        version=1,
    )


def _candidate(url: str) -> CandidateCreate:
    return CandidateCreate.model_validate(
        {
            "id": "review-request-context",
            "claim": {
                "id": "claim-request-context",
                "text": {"zh": "GPT 上下文 2M", "en": "GPT has a 2M context window"},
                "confidence": "unverified",
                "sourceIds": ["evidence-request-context"],
                "updatedAt": "2026-11-27",
                "subject": "GPT",
                "predicate": "context-window",
                "objectOrValue": "2M",
            },
            "evidence": [
                {
                    "id": "evidence-request-context",
                    "title": {"zh": "官方页面", "en": "Official page"},
                    "url": url,
                    "publisher": "OpenAI",
                    "publishedAt": "2026-11-09",
                    "collectedAt": "2026-11-27",
                    "sourceExcerpt": PAGE,
                    "type": "official",
                }
            ],
        }
    )


def test_request_kinds_follow_their_origin():
    def row(reason, name="X"):
        return _request("k", "https://example.com/a", reason, name)

    assert request_kind(row("Official release discovery: OpenAI. Verify.")) == "release"
    assert request_kind(row("官方目录发现新模型：OpenAI 官方模型目录出现新型号")) == "release"
    assert request_kind(row("用户请求核验一条内容")) == "verification"
    assert request_kind(row("决策资料补充请求，仅核验公开对象")) == "evidence"
    assert request_kind(row("访客希望收录这个工具，用于团队编程。")) == "visitor"


def test_cycle_turns_requests_into_review_candidates_and_closes_them(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    url = "https://example.com/models/gpt-6-3-sol"
    fetched: list[str] = []

    def fake_fetch(self, target, **_):
        fetched.append(target)
        return FetchedDocument(
            content=PAGE,
            content_type="text/markdown",
            etag=None,
            last_modified=None,
            final_url=target,
        )

    monkeypatch.setattr(SafeHttpFetcher, "fetch", fake_fetch)
    monkeypatch.setattr(
        StructuredExtractionService, "extract", lambda *args, **kwargs: [_candidate(url)]
    )
    automation = {"X-Automation-Token": "test-automation-token-with-at-least-32-characters"}
    admin = {"X-Admin-Token": "test-admin-token"}
    with TestClient(create_app(_settings(tmp_path))) as client:
        database = client.app.state.database
        with database.session() as session:
            session.add_all(
                [
                    _request("req-visitor", url, "访客希望收录这个模型，用于长文档。"),
                    _request(
                        "req-offlist", "https://other.example.org/x", "访客希望收录另一个对象。"
                    ),
                    _request(
                        "req-placeholder",
                        "https://airadar.rainza.cn/admin/review",
                        "用户请求核验一条内容",
                        "核验：某产品",
                    ),
                ]
            )
            session.commit()

        cycle = client.post("/api/v2/automation/run-cycle", headers=automation)
        assert cycle.status_code == 200, cycle.text
        requests = cycle.json()["result"]["extraction"]["entryRequests"]
        assert requests["attempted"] == 1
        assert requests["skipped"] == 2
        assert requests["candidatesCreated"] == 1
        assert fetched == [url]

        views = {
            item["id"]: item
            for item in client.get("/api/v2/admin/entry-requests", headers=admin).json()
        }
        visitor = views["req-visitor"]
        assert visitor["kind"] == "visitor"
        assert visitor["status"] == "in-review"
        assert visitor["autoState"] == "candidates"
        assert visitor["candidateIds"] == ["review-request-context"]
        assert visitor["candidatesOpen"] == 1
        assert views["req-offlist"]["autoState"] == "skipped"
        assert "允许名单" in views["req-offlist"]["autoDetail"]
        assert views["req-placeholder"]["kind"] == "verification"
        assert "没有可访问的官方页面" in views["req-placeholder"]["autoDetail"]

        with database.session() as session:
            source = session.scalars(select_source_by_url(url)).one()
            # A request page is never put on the collection schedule.
            assert source.fetch_enabled is False
            reservations = session.scalars(
                select_audit("extraction.reserved", "entry_request")
            ).all()
            assert len(reservations) == 1

        # Reviewing the candidate closes the request on the next cycle, no linking needed.
        queue = {
            item["id"]: item
            for item in client.get("/api/v2/admin/review-queue", headers=admin).json()
        }
        job = queue["review-request-context"]
        approved = client.post(
            "/api/v2/admin/review-queue/review-request-context/approve",
            headers=admin,
            json={"expectedVersion": job["version"]},
        )
        assert approved.status_code == 200, approved.text
        second = client.post("/api/v2/automation/run-cycle", headers=automation)
        assert second.status_code == 200, second.text
        assert second.json()["result"]["extraction"]["entryRequests"]["closed"] == 1
        closed = {
            item["id"]: item
            for item in client.get("/api/v2/admin/entry-requests", headers=admin).json()
        }["req-visitor"]
        assert closed["status"] == "resolved"
        assert closed["entityId"] == job["entityId"]
        assert closed["candidatesApproved"] == 1
        # Handled requests are not fetched or charged again.
        assert fetched == [url]


def select_source_by_url(url: str):
    return select(SourceRecord).where(SourceRecord.url == url)


def select_audit(action: str, target_type: str):
    return select(AuditLogRecord).where(
        AuditLogRecord.action == action, AuditLogRecord.target_type == target_type
    )
