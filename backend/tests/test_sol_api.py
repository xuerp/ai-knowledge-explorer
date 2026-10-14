import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.extraction import StructuredExtractionService
from app.main import create_app


@pytest.mark.parametrize("supported", [True, False])
def test_sol_configuration_probe_extraction_audit_and_public_isolation(
    tmp_path, monkeypatch, supported
):
    requests = []
    fact = {
        "subject": "MCP",
        "predicate": "uses",
        "objectOrValue": "JSON-RPC",
        "textZh": "MCP 使用 JSON-RPC。",
        "textEn": "MCP uses JSON-RPC.",
        "validFrom": None,
        "validTo": None,
    }

    def handler(request):
        payload = json.loads(request.content)
        requests.append(payload)
        assert payload["reasoning_effort"] == "low"
        assert payload["max_completion_tokens"] == 8192
        assert "temperature" not in payload
        assert payload["response_format"]["type"] == "json_schema"
        if not supported:
            return httpx.Response(
                400,
                json={"error": {"param": "reasoning_effort", "message": "private provider error"}},
            )
        return httpx.Response(
            200,
            json={
                "model": "gpt-6.1-sol",
                "choices": [
                    {"finish_reason": "stop", "message": {"content": json.dumps({"facts": [fact]})}}
                ],
                "usage": {
                    "prompt_tokens": 50,
                    "completion_tokens": 70,
                    "total_tokens": 120,
                    "completion_tokens_details": {"reasoning_tokens": 20},
                },
            },
        )

    original_init = StructuredExtractionService.__init__

    def init(self, *args, **kwargs):
        assert kwargs["require_json_schema"] is True
        assert kwargs["require_usage"] is True
        original_init(self, *args, **kwargs, transport=httpx.MockTransport(handler))

    monkeypatch.setattr(StructuredExtractionService, "__init__", init)
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'sol.db').as_posix()}",
        seed_snapshot_path=Path(__file__).resolve().parents[1] / "data" / "demo_snapshot.json",
        admin_token="test-admin",
        cors_origins=(),
        environment="test",
        extraction_api_url="https://provider.example/v1/chat/completions",
        extraction_api_key="private-test-key",
        extraction_model="gpt-6.1-sol",
        extraction_reasoning_effort="low",
        extraction_max_completion_tokens=8192,
        extraction_require_json_schema=True,
        extraction_require_usage=True,
    )
    headers = {"X-Admin-Token": "test-admin"}
    with TestClient(create_app(settings)) as client:
        endpoint = "/api/v2/admin/integrations/extraction/probe"
        assert client.post(endpoint).status_code == 401
        assert not requests
        result = client.post(endpoint, headers=headers).json()
        assert result["passed"] is supported
        assert len(requests) == 1
        if not supported:
            assert result["errorCode"] == "invalid_request"
        assert (
            client.post(
                "/api/v2/admin/sources",
                headers=headers,
                json={
                    "id": "source-sol-contract",
                    "url": "https://example.com/spec",
                    "title": "Sol contract source",
                    "publisher": "Example",
                },
            ).status_code
            == 201
        )
        snapshot = client.post(
            "/api/v2/admin/sources/source-sol-contract/snapshots",
            headers=headers,
            json={
                "content": "MCP uses JSON-RPC. This isolated contract fixture contains source text for extraction."
            },
        ).json()
        extract_endpoint = "/api/v2/admin/sources/source-sol-contract/extract"
        payload = {"snapshotId": snapshot["snapshotId"], "maxCandidates": 1}
        extracted = client.post(extract_endpoint, headers=headers, json=payload)
        assert extracted.status_code == (200 if supported else 503)
        if supported:
            candidates = extracted.json()
            assert len(candidates) == 1
            assert candidates[0]["status"] in {"pending", "needs-more-evidence"}
            claim_id = candidates[0]["claim"]["id"]
            assert claim_id not in {
                c["id"] for c in client.get("/api/v2/snapshot").json()["claims"]
            }
            assert client.post(extract_endpoint, headers=headers, json=payload).json() == []
        audit = client.get("/api/v2/admin/audit-log", headers=headers).json()
        entries = [
            row
            for row in audit
            if row["action"]
            in {"extraction.run", "extraction.failed", "integration.extraction.probe"}
        ]
        assert len(entries) == (3 if supported else 2)
        for entry in entries:
            receipt = entry["detail"]["providerCall"]
            assert receipt["requestCount"] == 1
            assert receipt["parametersForwardingVerified"] is False
        assert "private-test-key" not in json.dumps(audit)
        assert "private provider error" not in json.dumps(audit)
