import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier

import httpx
import pytest

from app.config import Settings
from app.database import DocumentSnapshotRecord, SourceRecord
from app.extraction import ExtractionUnavailableError, StructuredExtractionService


def _body(*, fact=None, model="gpt-6.1-sol"):
    return {
        "model": model,
        "choices": [
            {
                "finish_reason": "stop",
                "message": {"content": json.dumps({"facts": [fact] if fact else []})},
            }
        ],
        "usage": {
            "prompt_tokens": 50,
            "completion_tokens": 70,
            "total_tokens": 120,
            "completion_tokens_details": {"reasoning_tokens": 20},
        },
    }


def _service(handler, **kwargs):
    model = kwargs.pop("model", "gpt-6.1-sol")
    if model == "gpt-6-astra":
        kwargs.setdefault("reasoning_effort", "medium")
        kwargs.setdefault("max_completion_tokens", 8192)
    return StructuredExtractionService(
        "https://provider.example/v1/chat/completions",
        "private-test-key",
        model,
        require_json_schema=True,
        require_usage=True,
        transport=httpx.MockTransport(handler),
        **kwargs,
    )


def _source_snapshot():
    source = SourceRecord(
        id="sol-source",
        url="https://example.com/spec",
        title="Test source",
        publisher="Example",
        active=True,
        fetch_enabled=False,
        fetch_interval_minutes=240,
        created_at=datetime.now(UTC),
    )
    snapshot = DocumentSnapshotRecord(
        id="sol-snapshot",
        source_id=source.id,
        content_hash="hash",
        content_text="MCP uses JSON-RPC.",
        observed_at=datetime.now(UTC),
    )
    return source, snapshot


@pytest.mark.parametrize("partial_date", ["2024", "2004-01"])
def test_incomplete_source_date_does_not_become_an_invented_effective_date(partial_date):
    fact = {
        "subject": "MCP",
        "predicate": "uses",
        "objectOrValue": "JSON-RPC",
        "textZh": "MCP 使用 JSON-RPC。",
        "textEn": "MCP uses JSON-RPC.",
        "validFrom": partial_date,
        "validTo": None,
    }

    def handler(request):
        payload = json.loads(request.content)
        instruction = payload["messages"][0]["content"]
        assert "complete YYYY-MM-DD calendar date or null" in instruction
        assert "never invent a first or last day" in instruction
        date_schema = payload["response_format"]["json_schema"]["schema"]["$defs"]["_Fact"][
            "properties"
        ]["validFrom"]
        assert "Never fill missing month or day" in date_schema["description"]
        return httpx.Response(200, json=_body(fact=fact))

    service = _service(handler)
    with pytest.raises(ExtractionUnavailableError, match="invalid structured response"):
        service.extract(*_source_snapshot(), 1)
    assert service.call_metadata()["coverageStatus"] == "failed"


@pytest.mark.parametrize("model,effort", [("gpt-6.1-sol", "low"), ("gpt-6-astra", "medium")])
def test_sol_probe_and_extraction_use_supported_parameters_and_preserve_candidate_isolation(
    model, effort
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
        assert "temperature" not in payload
        assert payload["model"] == model
        assert payload["reasoning_effort"] == effort
        assert payload["max_completion_tokens"] == 8192
        schema = payload["response_format"]["json_schema"]
        assert schema["strict"] is True
        fact_schema = schema["schema"]["$defs"]["_Fact"]
        assert set(fact_schema["required"]) == set(fact)
        assert fact_schema["additionalProperties"] is False
        assert "default" not in fact_schema["properties"]["validFrom"]
        return httpx.Response(200, json=_body(fact=fact, model=model))

    service = _service(handler, model=model)
    assert service.probe().passed
    candidates = service.extract(*_source_snapshot(), 1)
    assert len(requests) == 2
    assert len(candidates) == 1
    assert candidates[0].claim.confidence == "unverified"
    assert candidates[0].evidence[0].source_excerpt == "MCP uses JSON-RPC."
    metadata = service.call_metadata()
    assert metadata["requestCount"] == 1
    assert metadata["responses"][0]["usage"]["reasoningTokens"] == 20
    assert metadata["parametersForwardingVerified"] is False
    assert "private-test-key" not in json.dumps(metadata)
    assert "MCP uses" not in json.dumps(metadata)


@pytest.mark.parametrize(
    "param,code",
    [
        ("response_format", "structured_output_unsupported"),
        ("reasoning_effort", "invalid_request"),
        ("max_completion_tokens", "invalid_request"),
    ],
)
def test_sol_capability_rejection_never_removes_parameters_or_falls_back(param, code):
    calls = []

    def handler(request):
        calls.append(json.loads(request.content))
        return httpx.Response(400, json={"error": {"param": param, "message": "private rejection"}})

    service = _service(handler)
    result = service.probe()
    assert result.error_code == code
    assert not result.passed
    assert len(calls) == 1
    assert "private" not in result.detail


@pytest.mark.parametrize(
    "change,code",
    [
        (lambda b: b.pop("usage"), "usage_unavailable"),
        (lambda b: b["usage"].pop("completion_tokens_details"), "usage_unavailable"),
        (lambda b: b["usage"].update(total_tokens=119), "usage_unavailable"),
        (lambda b: b["choices"][0].update(finish_reason="length"), "output_truncated"),
        (lambda b: b["choices"][0]["message"].update(refusal="private refusal"), "output_refused"),
        (lambda b: b.update(model="different-model"), "model_unconfirmed"),
        (
            lambda b: b["usage"].update(completion_tokens=9000, total_tokens=9050),
            "output_limit_ignored",
        ),
    ],
)
@pytest.mark.parametrize("model", ["gpt-6.1-sol", "gpt-6-astra"])
def test_sol_missing_or_invalid_capabilities_fail_without_candidates(change, code, model):
    body = _body(model=model)
    change(body)
    service = _service(lambda request: httpx.Response(200, json=body), model=model)
    result = service.probe()
    assert not result.passed
    assert result.error_code == code
    with pytest.raises(ExtractionUnavailableError):
        service.extract(*_source_snapshot(), 1)


def test_provider_contract_violation_blocks_further_paid_calls_with_new_limit():
    calls = []

    def handler(request):
        calls.append(json.loads(request.content))
        body = _body(model="gpt-6-astra")
        body["usage"].update(completion_tokens=17000, total_tokens=17050)
        return httpx.Response(200, json=body)

    service = _service(handler, model="gpt-6-astra", max_completion_tokens=16384)
    assert service.probe().error_code == "output_limit_ignored"
    assert service.probe().error_code == "provider_contract_blocked"
    with pytest.raises(ExtractionUnavailableError, match="provider_contract_blocked"):
        service.extract(*_source_snapshot(), 1)
    assert len(calls) == 1
    assert calls[0]["max_completion_tokens"] == 16384
    assert service.call_metadata()["requestCount"] == 0


def test_contract_circuit_survives_restart(tmp_path):
    calls = []

    def handler(request):
        calls.append(request)
        body = _body(model="gpt-6-astra")
        body["usage"].update(completion_tokens=17000, total_tokens=17050)
        return httpx.Response(200, json=body)

    service = _service(handler, model="gpt-6-astra", max_completion_tokens=16384)
    service.contract_state_path = tmp_path / "contract.json"
    assert service.probe().error_code == "output_limit_ignored"
    restarted = StructuredExtractionService(
        service.api_url,
        service.api_key,
        service.model,
        transport=httpx.MockTransport(handler),
        contract_state_path=service.contract_state_path,
        require_usage=True,
        require_json_schema=True,
        max_completion_tokens=32768,
    )
    assert restarted.probe().error_code == "provider_contract_blocked"
    assert len(calls) == 1
    assert "api_key" not in service.contract_state_path.read_text()


@pytest.mark.parametrize(
    "content",
    [
        '```json\n{"facts":[]}\n```',
        "[]",
        "",
        (
            '{"facts":[{"subject":"MCP","predicate":"uses","objectOrValue":"JSON-RPC",'
            '"textZh":"使用","textEn":"uses"}]}'
        ),
    ],
)
def test_sol_strict_mode_does_not_repair_noncompliant_output(content):
    body = _body()
    body["choices"][0]["message"]["content"] = content
    result = _service(lambda request: httpx.Response(200, json=body)).probe()
    assert not result.passed
    assert result.error_code == "invalid_response"


def test_compatibility_fallback_and_retry_share_two_request_budget():
    calls = []

    def handler(request):
        calls.append(json.loads(request.content)["response_format"]["type"])
        if len(calls) == 1:
            return httpx.Response(400, json={"error": {"param": "response_format"}})
        return httpx.Response(503)

    service = StructuredExtractionService(
        "https://provider.example/chat/completions",
        "key",
        "legacy",
        transport=httpx.MockTransport(handler),
    )
    assert service.probe().error_code == "provider_error"
    assert calls == ["json_schema", "json_object"]
    assert service.call_metadata()["requestCount"] == 2


def test_retry_after_beyond_deadline_does_not_sleep_or_send_more_requests():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(429, headers={"Retry-After": "3600"})

    service = _service(handler)
    assert service.probe().error_code == "rate_limited"
    assert len(calls) == 1


def test_provider_receipts_are_isolated_between_concurrent_requests():
    service = _service(lambda request: httpx.Response(200, json=_body()))
    barrier = Barrier(2)

    def call(_):
        assert service.call_metadata() is None
        barrier.wait(timeout=5)
        assert service.probe().passed
        return service.call_metadata()["requestCount"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(call, range(2))) == [1, 1]
    assert service.call_metadata() is None


def test_sol_environment_controls_are_read_and_bounded(monkeypatch):
    monkeypatch.setenv("AI_RADAR_EXTRACTION_MODEL", "gpt-6.1-sol")
    monkeypatch.setenv("AI_RADAR_EXTRACTION_REASONING_EFFORT", "low")
    monkeypatch.setenv("AI_RADAR_EXTRACTION_MAX_COMPLETION_TOKENS", "8192")
    monkeypatch.setenv("AI_RADAR_EXTRACTION_REQUIRE_JSON_SCHEMA", "true")
    monkeypatch.setenv("AI_RADAR_EXTRACTION_REQUIRE_USAGE", "true")
    settings = Settings.from_env()
    assert settings.extraction_reasoning_effort == "low"
    assert settings.extraction_max_completion_tokens == 8192
    assert settings.extraction_require_json_schema
    assert settings.extraction_require_usage
    for invalid in ("none", "minimal", "bogus"):
        monkeypatch.setenv("AI_RADAR_EXTRACTION_REASONING_EFFORT", invalid)
        with pytest.raises(ValueError, match="REASONING_EFFORT"):
            Settings.from_env()
    monkeypatch.setenv("AI_RADAR_EXTRACTION_REASONING_EFFORT", "low")
    for invalid in ("255", "32769"):
        monkeypatch.setenv("AI_RADAR_EXTRACTION_MAX_COMPLETION_TOKENS", invalid)
        with pytest.raises(ValueError, match="MAX_COMPLETION_TOKENS"):
            Settings.from_env()


@pytest.mark.parametrize(
    "body", [[], {"choices": []}, {"choices": [None]}, {"choices": [{"message": None}]}]
)
def test_invalid_provider_envelopes_return_safe_diagnostics(body):
    service = StructuredExtractionService(
        "https://provider.example/chat/completions",
        "private-test-key",
        "legacy",
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=body)),
    )
    assert service.probe().error_code == "invalid_response"
    with pytest.raises(ExtractionUnavailableError, match="invalid structured response"):
        service.extract(*_source_snapshot(), 1)


@pytest.mark.parametrize(
    "name", ["AI_RADAR_EXTRACTION_REQUIRE_JSON_SCHEMA", "AI_RADAR_EXTRACTION_REQUIRE_USAGE"]
)
def test_invalid_capability_flags_fail_at_startup(monkeypatch, name):
    monkeypatch.setenv(name, "flase")
    with pytest.raises(ValueError, match=name):
        Settings.from_env()
