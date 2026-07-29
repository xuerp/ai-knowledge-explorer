import json
from datetime import UTC, datetime

import httpx

from app.database import DocumentSnapshotRecord, SourceRecord
from app.extraction import StructuredExtractionService


def test_structured_extraction_is_strict_unverified_and_evidence_linked():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer test-secret"
        request_json = json.loads(request.content)
        assert request_json["response_format"]["type"] == "json_schema"
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

    result = service.extract(source, snapshot, 5)

    assert len(result) == 1
    assert result[0].claim.confidence == "unverified"
    assert result[0].claim.subject == "GPT"
    assert result[0].claim.object_or_value == "2M"
    assert result[0].claim.source_ids == [result[0].evidence[0].id]
    assert result[0].evidence[0].url == source.url
