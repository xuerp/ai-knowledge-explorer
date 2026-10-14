import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from app.database import DocumentSnapshotRecord, SourceRecord
from app.extraction import (
    ExtractionUnavailableError,
    StructuredExtractionService,
    locate_source_excerpt,
)


def records(content):
    now = datetime.now(UTC)
    source = SourceRecord(
        id="coverage-source",
        url="https://example.com/spec",
        title="Spec",
        publisher="Example",
        active=True,
        fetch_enabled=False,
        fetch_interval_minutes=240,
        created_at=now,
    )
    snapshot = DocumentSnapshotRecord(
        id="coverage-snapshot",
        source_id=source.id,
        content_hash="test",
        content_text=content,
        observed_at=now,
    )
    return source, snapshot


def fact(subject="TailModel", value="128K"):
    return {
        "subject": subject,
        "predicate": "context-window",
        "objectOrValue": value,
        "textZh": f"{subject} 上下文为 {value}。",
        "textEn": f"{subject} has a {value} context window.",
        "validFrom": None,
        "validTo": None,
    }


def response(facts):
    return httpx.Response(
        200, json={"choices": [{"message": {"content": json.dumps({"facts": facts})}}]}
    )


def test_long_document_tail_is_sent_and_anchored_without_mutating_snapshot():
    content = "background\n" * 6000 + "TailModel has a 128K context window."
    prompts = []

    def handler(request):
        prompt = json.loads(request.content)["messages"][1]["content"]
        prompts.append(prompt)
        return response([fact()] if "TailModel has" in prompt else [])

    service = StructuredExtractionService(
        "https://extract.example/v1", "key", "test", transport=httpx.MockTransport(handler)
    )
    source, snapshot = records(content)
    candidates = service.extract(source, snapshot, 5)
    assert len(prompts) == 2
    assert candidates[0].evidence[0].source_excerpt == "TailModel has a 128K context window."
    assert snapshot.content_text == content
    assert candidates[0].evidence[0].published_at == ""
    assert candidates[0].evidence[0].collected_at == snapshot.observed_at.date().isoformat()
    assert service.call_metadata()["coverageStatus"] == "full"
    assert service.call_metadata()["processedCharacters"] == len(content)


def test_tail_failure_does_not_return_a_partial_batch():
    content = "HeadModel has a 128K context window.\n" + "background\n" * 6000
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        if calls == 1:
            return response([fact("HeadModel")])
        raise httpx.ReadTimeout("private provider detail", request=request)

    service = StructuredExtractionService(
        "https://extract.example/v1", "key", "test", transport=httpx.MockTransport(handler)
    )
    source, snapshot = records(content)
    with pytest.raises(ExtractionUnavailableError, match="timed out"):
        service.extract(source, snapshot, 5)
    assert service.call_metadata()["coverageStatus"] == "partial"
    assert service.call_metadata()["completedSegments"] == 1


def test_limit_before_tail_is_an_explicit_incomplete_failure():
    service = StructuredExtractionService(
        "https://extract.example/v1",
        "key",
        "test",
        transport=httpx.MockTransport(lambda _: response([fact("HeadModel")])),
    )
    source, snapshot = records("HeadModel has a 128K context window.\n" + "background\n" * 6000)
    with pytest.raises(ExtractionUnavailableError, match="document_coverage_incomplete"):
        service.extract(source, snapshot, 1)
    assert service.call_metadata()["coverageStatus"] == "partial"


def test_provider_overflow_is_rejected_instead_of_silently_sliced():
    service = StructuredExtractionService(
        "https://extract.example/v1",
        "key",
        "test",
        transport=httpx.MockTransport(lambda _: response([fact(), fact()])),
    )
    source, snapshot = records("TailModel has a 128K context window.")
    with pytest.raises(ExtractionUnavailableError, match="candidate_limit_exceeded"):
        service.extract(source, snapshot, 1)
    assert service.call_metadata()["segments"][0]["providerCall"]["rawFacts"] == 2


def test_document_budget_is_reserved_for_middle_and_tail_without_raising_the_limit():
    content = (
        "HeadModel has a 128K context window and a 256K extended context window.\n"
        + "background\n" * 5600
        + "MiddleModel has a 128K context window and a 256K extended context window.\n"
        + "background\n" * 5600
        + "TailModel has a 128K context window and a 256K extended context window."
    )
    budgets = []
    schema_budgets = []

    def handler(request):
        request_body = json.loads(request.content)
        prompt = request_body["messages"][1]["content"]
        budget = int(prompt.split("Maximum facts: ")[1].split("\n")[0])
        budgets.append(budget)
        schema_budgets.append(
            request_body["response_format"]["json_schema"]["schema"]["properties"]["facts"][
                "maxItems"
            ]
        )
        subject = next(
            name for name in ("HeadModel", "MiddleModel", "TailModel") if name + " has" in prompt
        )
        return response([fact(subject), fact(subject, "256K")])

    service = StructuredExtractionService(
        "https://extract.example/v1", "key", "test", transport=httpx.MockTransport(handler)
    )
    source, snapshot = records(content)
    candidates = service.extract(source, snapshot, 6)
    assert budgets == [2, 2, 2]
    assert schema_budgets == budgets
    assert {candidate.claim.subject for candidate in candidates} == {
        "HeadModel",
        "MiddleModel",
        "TailModel",
    }
    assert len(candidates) == 6
    metadata = service.call_metadata()
    assert metadata["coverageStatus"] == "full"
    assert metadata["processedCharacters"] == len(content)
    assert metadata["candidateSelectionLimited"] is True
    assert metadata["candidateLimit"] == 6


def test_candidate_schema_budget_does_not_leak_between_calls():
    limits = []

    def handler(request):
        request_body = json.loads(request.content)
        limits.append(
            request_body["response_format"]["json_schema"]["schema"]["properties"]["facts"][
                "maxItems"
            ]
        )
        return response([fact()])

    service = StructuredExtractionService(
        "https://extract.example/v1", "key", "test", transport=httpx.MockTransport(handler)
    )
    source, snapshot = records("TailModel has a 128K context window.")
    assert len(service.extract(source, snapshot, 1)) == 1
    assert len(service.extract(source, snapshot, 3)) == 1
    assert limits == [1, 3]


def test_strict_candidate_schema_rejection_does_not_retry_or_downgrade():
    requests = []

    def handler(request):
        request_body = json.loads(request.content)
        requests.append(request_body)
        assert (
            request_body["response_format"]["json_schema"]["schema"]["properties"]["facts"][
                "maxItems"
            ]
            == 1
        )
        return httpx.Response(
            400,
            json={
                "error": {
                    "param": "response_format",
                    "message": "Unsupported maxItems in JSON Schema",
                }
            },
        )

    service = StructuredExtractionService(
        "https://extract.example/v1",
        "key",
        "test",
        require_json_schema=True,
        transport=httpx.MockTransport(handler),
    )
    source, snapshot = records("TailModel has a 128K context window.")
    with pytest.raises(ExtractionUnavailableError, match="structured_output_unsupported"):
        service.extract(source, snapshot, 1)
    assert len(requests) == 1
    assert service.call_metadata()["coverageStatus"] == "failed"
    assert service.call_metadata()["requestCount"] == 1


def test_anchor_rejection_is_visible_with_zero_retained_candidates():
    service = StructuredExtractionService(
        "https://extract.example/v1",
        "key",
        "test",
        transport=httpx.MockTransport(lambda _: response([fact()])),
    )
    source, snapshot = records("No context specification is provided.")
    assert service.extract(source, snapshot, 5) == []
    metadata = service.call_metadata()
    assert metadata["rawFacts"] == 1
    assert metadata["rejectedEvidenceAnchors"] == 1
    assert metadata["coverageStatus"] == "full"


@pytest.mark.parametrize(
    "content",
    [
        '<a href="https://www.langchain.com/langgraph">',
        "[LangGraph](https://www.langchain.com/langgraph)",
        "https://www.langchain.com/langgraph",
        '<img alt="LangGraph and LangChain" src="logo.svg">',
    ],
)
def test_url_fragments_and_html_attributes_do_not_support_product_relationships(content):
    assert locate_source_excerpt(content, "LangGraph", "LangChain") is None


def test_visible_link_labels_and_explicit_url_values_remain_exact_quotes():
    content = "[LangGraph](https://example.com) integrates with [LangChain](https://example.org)."
    assert locate_source_excerpt(content, "LangGraph", "LangChain") == content
    url_fact = "MCP website is https://modelcontextprotocol.io/."
    assert locate_source_excerpt(url_fact, "MCP", "https://modelcontextprotocol.io/") == url_fact


def test_same_entities_choose_the_asserted_relationship_without_rewriting_the_quote():
    independent = "LangGraph is built by LangChain Inc, the creators of LangChain, but can be used without LangChain."
    integration = "While LangGraph can be used standalone, it also integrates seamlessly with any LangChain product, giving developers a full suite of tools for building agents."
    content = '<a href="https://www.langchain.com/langgraph">\n' + independent + "\n" + integration
    assert (
        locate_source_excerpt(
            content, "LangGraph", "LangChain", claim_text="LangGraph can be used without LangChain."
        )
        == independent
    )
    assert (
        locate_source_excerpt(
            content,
            "LangGraph",
            "LangChain",
            claim_text="LangGraph integrates seamlessly with any LangChain product.",
        )
        == integration
    )


@pytest.mark.parametrize(
    "text,value",
    [
        ("ChatGLM3-6B supports 128K tokens.", "8K"),
        ("ChatGLM3-6B was tested on GSM8K.", "8K"),
        ("ModelA has 1671B parameters.", "671B"),
        ("ModelA scores 85.51 on the benchmark.", "85.5"),
    ],
)
def test_partial_numeric_and_identifier_matches_are_not_evidence(text, value):
    subject = "ChatGLM3-6B" if text.startswith("ChatGLM") else "ModelA"
    assert locate_source_excerpt(text, subject, value) is None


def test_exact_units_and_adjacent_chinese_prose_keep_the_contiguous_source_quote():
    source = "ChatGLM3-6B支持8K上下文，扩展版另有128K。"
    assert locate_source_excerpt(source, "ChatGLM3-6B", "8K") == source
    assert locate_source_excerpt("ModelA scores 85.5%.", "ModelA", "85.5") == "ModelA scores 85.5%."


def test_model_variant_does_not_supply_the_subject_for_a_different_model():
    assert (
        locate_source_excerpt("ChatGLM3-6B-128K supports a 128K context.", "ChatGLM3-6B", "128K")
        is None
    )
    assert locate_source_excerpt("ModelA-Preview supports JSON-RPC.", "ModelA", "JSON-RPC") is None
    assert (
        locate_source_excerpt("ModelA supports a 128K-token context.", "ModelA", "128K")
        == "ModelA supports a 128K-token context."
    )


def test_model_name_suffix_alone_is_not_a_measured_context_specification():
    assert (
        locate_source_excerpt("ChatGLM3-6B-128K was released.", "ChatGLM3-6B-128K", "128K") is None
    )
    assert (
        locate_source_excerpt(
            "ChatGLM3-6B-128K supports a 128K context.", "ChatGLM3-6B-128K", "128K"
        )
        == "ChatGLM3-6B-128K supports a 128K context."
    )


def test_nested_identifier_is_not_a_second_relation_anchor():
    assert (
        locate_source_excerpt(
            "The model ChatGLM3-6B-Base was released.", "ChatGLM3-6B-Base", "ChatGLM3-6B"
        )
        is None
    )
    actual = "The base model of ChatGLM3-6B, ChatGLM3-6B-Base, uses the reviewed training recipe."
    assert locate_source_excerpt(actual, "ChatGLM3-6B-Base", "ChatGLM3-6B") == actual
    assert (
        locate_source_excerpt("ChatGLM3-6B belongs to ChatGLM3.", "ChatGLM3-6B", "ChatGLM3")
        == "ChatGLM3-6B belongs to ChatGLM3."
    )


def test_saved_langgraph_output_selects_both_supported_relationship_sentences():
    base = Path(__file__).resolve().parents[1] / "data/real_loop/extraction-eval-20261005"
    path = base / "results-36h-remaining-v13-20261006-limit32768/langgraph.json"
    if not path.exists():
        pytest.skip("Local saved provider receipt unavailable")
    receipt = json.loads(path.read_text("utf-8"))
    content = (base / "langgraph.txt").read_text("utf-8")
    usage = receipt["providerCall"]["responses"][0]["usage"]
    body = {
        "model": "gpt-6-astra",
        "choices": [{"message": {"content": receipt["rawOutputs"][0]}, "finish_reason": "stop"}],
        "usage": {
            "prompt_tokens": usage["inputTokens"],
            "completion_tokens": usage["outputTokens"],
            "total_tokens": usage["totalTokens"],
            "completion_tokens_details": {"reasoning_tokens": usage["reasoningTokens"]},
        },
    }
    service = StructuredExtractionService(
        "https://saved-replay.invalid/v1",
        "local-only",
        "gpt-6-astra",
        reasoning_effort="medium",
        max_completion_tokens=32768,
        require_usage=True,
        require_json_schema=True,
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=body)),
    )
    candidates = service.extract(*records(content), 20)
    assert len(candidates) == 15
    by_relation = {candidate.claim.predicate: candidate for candidate in candidates}
    assert (
        "can be used without LangChain"
        in by_relation["can-be-used-without"].evidence[0].source_excerpt
    )
    assert (
        "integrates seamlessly with any LangChain product"
        in by_relation["integrates-with"].evidence[0].source_excerpt
    )
    assert all(candidate.evidence[0].source_excerpt in content for candidate in candidates)


def test_table_evidence_preserves_metric_headers_without_cross_row_anchors():
    content = "| Model | AIME pass@1 | MATH pass@1 |\n|---|---|---|\n| ModelA | 72.6 | 94.3 |\n| ModelB | 70.0 | 94.5 |"
    excerpt = locate_source_excerpt(content, "ModelA", "72.6")
    assert "AIME pass@1" in excerpt
    assert "ModelA | 72.6" in excerpt
    assert "ModelB" not in excerpt
    assert locate_source_excerpt(content, "ModelA", "94.5") is None
    assert locate_source_excerpt(content, "ModelA", "72.6", max_characters=20) is None


@pytest.mark.parametrize(
    "dates",
    [
        {"validFrom": "2026.10.05"},
        {"validFrom": "2026-02-30"},
        {"validFrom": "2026-10-05", "validTo": "2026-10-04"},
    ],
)
def test_invalid_validity_dates_fail_instead_of_entering_the_review_queue(dates):
    invalid_fact = {**fact(), **dates}
    service = StructuredExtractionService(
        "https://extract.example/v1",
        "key",
        "test",
        transport=httpx.MockTransport(lambda _: response([invalid_fact])),
    )
    source, snapshot = records("TailModel has a 128K context window.")
    with pytest.raises(ExtractionUnavailableError, match="invalid structured response"):
        service.extract(source, snapshot, 5)
