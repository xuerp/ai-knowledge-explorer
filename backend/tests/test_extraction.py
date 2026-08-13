import json
from datetime import UTC, datetime

import httpx
import pytest

from app.database import DocumentSnapshotRecord, SourceRecord
from app.extraction import (
    EXTRACTION_PIPELINE_VERSION,
    ExtractionUnavailableError,
    StructuredExtractionService,
    extraction_audit_is_current,
    locate_source_excerpt,
)


def test_structured_extraction_is_strict_unverified_and_evidence_linked():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer test-secret"
        request_json = json.loads(request.content)
        assert request_json["response_format"]["type"] == "json_schema"
        prompt = "\n".join(message["content"] for message in request_json["messages"])
        assert "canonical predicates" in prompt
        assert "Known catalog entities" in prompt
        assert "Priority entities with incomplete relation coverage" in prompt
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": (
                                '{"facts":[{"subject":"GPT","predicate":"context-window",'
                                '"objectOrValue":"2M","textZh":"GPT 上下文为 2M。",'
                                '"textEn":"GPT has a 2M context window.",'
                                '"validFrom":"2026-07-29","validTo":null}]}'
                            )
                        }
                    }
                ]
            },
        )

    source = SourceRecord(
        id="source-test",
        url="https://example.com/spec",
        title="Official specification",
        publisher="Example",
        active=True,
        fetch_enabled=False,
        fetch_interval_minutes=240,
        created_at=datetime.now(UTC),
    )
    snapshot = DocumentSnapshotRecord(
        id="snapshot-test",
        source_id=source.id,
        content_hash="hash",
        content_text="The official specification says the context window is 2M tokens.",
        observed_at=datetime.now(UTC),
    )
    service = StructuredExtractionService(
        "https://extractor.example/v1/chat/completions",
        "test-secret",
        "structured-model",
        transport=httpx.MockTransport(handler),
    )

    result = service.extract(source, snapshot, 5, priority_entity_ids=["e-gpt"])

    assert len(result) == 1
    assert result[0].claim.confidence == "unverified"
    assert result[0].claim.subject == "GPT"
    assert result[0].claim.object_or_value == "2M"
    assert result[0].claim.source_ids == [result[0].evidence[0].id]
    assert result[0].evidence[0].url == source.url
    assert result[0].evidence[0].source_excerpt is None


def test_extraction_audit_only_accepts_the_current_pipeline_version():
    assert extraction_audit_is_current(
        json.dumps({"pipelineVersion": EXTRACTION_PIPELINE_VERSION})
    )
    assert extraction_audit_is_current("{}") is False
    assert extraction_audit_is_current("not-json") is False


def test_source_excerpt_requires_subject_and_object_in_the_same_segment():
    content = (
        "Overview without the target.\n"
        "GPT uses MCP to connect external tools.\n"
        "MCP is described elsewhere."
    )

    assert locate_source_excerpt(content, "GPT", "MCP") == (
        "GPT uses MCP to connect external tools."
    )
    assert locate_source_excerpt(content, "GPT", "OpenAI") is None


def test_extraction_probe_checks_authentication_and_json_schema_support():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer test-secret"
        request_json = json.loads(request.content)
        assert request_json["response_format"]["type"] == "json_schema"
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": '{"facts":[]}'}}]},
        )

    service = StructuredExtractionService(
        "https://extractor.example/v1/chat/completions",
        "test-secret",
        "structured-model",
        transport=httpx.MockTransport(handler),
    )

    result = service.probe()

    assert result.configured is True
    assert result.passed is True
    assert result.endpoint_host == "extractor.example"
    assert result.model == "structured-model"
    assert result.error_code is None
    assert "JSON Schema" in result.detail


def test_extraction_probe_classifies_provider_failures_without_exposing_response_body():
    service = StructuredExtractionService(
        "https://extractor.example/v1/chat/completions",
        "secret-that-must-not-leak",
        "unsupported-model",
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(400, text="sensitive provider response")
        ),
    )

    result = service.probe()

    assert result.passed is False
    assert result.error_code == "structured_output_unsupported"
    assert "sensitive" not in result.detail
    assert "secret" not in result.model


def test_extraction_probe_falls_back_to_strictly_validated_json_object():
    formats: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        request_json = json.loads(request.content)
        response_format = request_json["response_format"]["type"]
        formats.append(response_format)
        if response_format == "json_schema":
            return httpx.Response(400, json={"error": {"message": "unsupported"}})
        prompt = " ".join(message["content"] for message in request_json["messages"])
        assert "objectOrValue" in prompt
        assert "validFrom" in prompt
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": (
                                '{"facts":[{"subject":"AI Radar","predicate":"probe",'
                                '"objectOrValue":"ok","textZh":"连接正常",'
                                '"textEn":"Connection works.","validFrom":null,'
                                '"validTo":null}]}'
                            )
                        }
                    }
                ]
            },
        )

    service = StructuredExtractionService(
        "https://extractor.example/v1/chat/completions",
        "test-secret",
        "structured-model",
        transport=httpx.MockTransport(handler),
    )

    result = service.probe()

    assert result.passed is True
    assert formats == ["json_schema", "json_object"]
    assert "JSON Object 兼容模式" in result.detail


def test_extraction_json_object_fallback_remains_schema_strict():
    def handler(request: httpx.Request) -> httpx.Response:
        request_json = json.loads(request.content)
        if request_json["response_format"]["type"] == "json_schema":
            return httpx.Response(422, json={"error": {"message": "unsupported"}})
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": '{"facts":[],"unsafe":true}'}}]},
        )

    source = SourceRecord(
        id="source-test",
        url="https://example.com/spec",
        title="Official specification",
        publisher="Example",
        active=True,
        fetch_enabled=False,
        fetch_interval_minutes=240,
        created_at=datetime.now(UTC),
    )
    snapshot = DocumentSnapshotRecord(
        id="snapshot-test",
        source_id=source.id,
        content_hash="hash",
        content_text="Official source text.",
        observed_at=datetime.now(UTC),
    )
    service = StructuredExtractionService(
        "https://extractor.example/v1/chat/completions",
        "test-secret",
        "structured-model",
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(ExtractionUnavailableError, match="invalid structured response"):
        service.extract(source, snapshot, 5)


def test_extraction_compatibility_normalizes_fenced_top_level_array():
    def handler(request: httpx.Request) -> httpx.Response:
        request_json = json.loads(request.content)
        if request_json["response_format"]["type"] == "json_schema":
            return httpx.Response(400, json={"error": {"message": "unsupported"}})
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": (
                                "```json\n"
                                '[{"subject":"MCP","predicate":"uses","objectOrValue":"JSON-RPC",'
                                '"textZh":"MCP 使用 JSON-RPC。","textEn":"MCP uses JSON-RPC.",'
                                '"validFrom":null,"validTo":null}]\n'
                                "```"
                            )
                        }
                    }
                ]
            },
        )

    source = SourceRecord(
        id="source-test",
        url="https://example.com/spec",
        title="Official specification",
        publisher="Example",
        active=True,
        fetch_enabled=False,
        fetch_interval_minutes=240,
        created_at=datetime.now(UTC),
    )
    snapshot = DocumentSnapshotRecord(
        id="snapshot-test",
        source_id=source.id,
        content_hash="hash",
        content_text="MCP uses JSON-RPC.",
        observed_at=datetime.now(UTC),
    )
    service = StructuredExtractionService(
        "https://extractor.example/v1/chat/completions",
        "test-secret",
        "structured-model",
        transport=httpx.MockTransport(handler),
    )

    result = service.extract(source, snapshot, 5)

    assert len(result) == 1
    assert result[0].claim.subject == "MCP"
    assert result[0].claim.object_or_value == "JSON-RPC"


def test_extraction_probe_reports_incomplete_configuration_without_network():
    result = StructuredExtractionService(None, None, None).probe()

    assert result.configured is False
    assert result.passed is False
    assert result.error_code == "not_configured"


def test_extraction_probe_distinguishes_connection_timeout():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("connection timed out", request=request)

    service = StructuredExtractionService(
        "https://extractor.example/v1/chat/completions",
        "test-secret",
        "structured-model",
        transport=httpx.MockTransport(handler),
    )

    result = service.probe()

    assert result.error_code == "connection_timeout"
    assert "Render" in result.detail


def test_extraction_probe_distinguishes_dns_failure():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("getaddrinfo failed", request=request)

    service = StructuredExtractionService(
        "https://missing.example/v1/chat/completions",
        "test-secret",
        "structured-model",
        transport=httpx.MockTransport(handler),
    )

    result = service.probe()

    assert result.error_code == "dns_resolution_failed"
    assert "域名" in result.detail
