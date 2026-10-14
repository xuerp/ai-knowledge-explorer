import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from app.database import DocumentSnapshotRecord, SourceRecord
from app.extraction import (
    ExtractionUnavailableError,
    StructuredExtractionService,
    is_generic_license_fact,
)


@pytest.mark.parametrize(
    "subject,predicate",
    [
        ("Permission", "granted-free-of-charge-to"),
        ("THE SOFTWARE", "provided-without-warranty"),
        ("this Software", "accompanied-by"),
        ("LangChain, Inc.", "copyright-year"),
        ("Model Context Protocol a Series of LF Projects, LLC", "has MIT License copyright years"),
        ("Apache License", "version is"),
        ("Creative Commons Attribution 4.0 International", "is abbreviated as"),
        ("Model Context Protocol", "copyright notice covers years"),
        ("Contributor", "grants to You"),
        ("Each Contributor", "provides"),
        ("Licensor", "provides the Work on"),
        ("You", "must give recipients"),
        ("This License", "does not grant permission"),
        ("THE AUTHORS OR COPYRIGHT HOLDERS", "not-liable-for"),
        ("The above copyright notice and this permission notice", "must-be-included-in"),
        ("such contributions", "convey no rights beyond those granted by"),
        (
            "any patent licenses granted to You under this License for that Work",
            "shall terminate as of",
        ),
        ("Apache License, Version 2.0", "includes-terms"),
        ("Apache-2.0", "version"),
        ("CC-BY-4.0", "is abbreviated as"),
    ],
)
def test_legal_template_is_not_product_capability(subject, predicate):
    assert is_generic_license_fact(subject, predicate)


@pytest.mark.parametrize(
    "subject,predicate",
    [
        ("MCP", "license-transition"),
        ("LangGraph", "license"),
        ("DeepSeek V3", "commercial-use"),
        ("Hunyuan", "license-restriction"),
        ("Apache Airflow", "license"),
    ],
)
def test_product_specific_license_is_retained(subject, predicate):
    assert not is_generic_license_fact(subject, predicate)


def test_legal_project_namespace_is_distinct_from_product_family_membership():
    assert is_generic_license_fact("Model Context Protocol", "is a Series of", "LF Projects, LLC")
    assert not is_generic_license_fact("Model V3", "is a series of", "Model family")
    assert not is_generic_license_fact("Named product", "copyright-license", "Apache-2.0")


def test_current_real_mcp_output_retains_only_six_explicit_relicensing_statements():
    path = (
        Path(__file__).resolve().parents[1]
        / "data/real_loop/extraction-eval-20261005/results-36h-negative-v16-20261006-limit32768/mcp-license.json"
    )
    if not path.exists():
        pytest.skip("Local real provider receipt unavailable")
    facts = json.loads(json.loads(path.read_text(encoding="utf-8"))["rawOutputs"][0])["facts"]
    retained = [
        f
        for f in facts
        if not is_generic_license_fact(f["subject"], f["predicate"], f["objectOrValue"])
    ]
    assert len(facts) == 16 and len(retained) == 6
    assert [f["objectOrValue"] for f in retained] == [
        "MIT License",
        "Apache License, Version 2.0",
        "Apache-2.0",
        "CC-BY-4.0",
        "Apache-2.0",
        "MIT License",
    ]
    assert retained[-1]["subject"].endswith("have not yet granted explicit permission to relicense")


def test_saved_real_negative_candidates_are_quarantined():
    path = (
        Path(__file__).resolve().parents[1]
        / "data/real_loop/extraction-eval-20261005/results-36h-negative-20261006-limit32768/langgraph-license.json"
    )
    if not path.exists():
        pytest.skip("Local real provider receipt unavailable")
    candidates = json.loads(path.read_text(encoding="utf-8"))["candidates"]
    assert len(candidates) == 5
    assert all(
        is_generic_license_fact(c["claim"]["subject"], c["claim"]["predicate"]) for c in candidates
    )


def test_saved_mcp_receipt_retains_transition_but_not_license_metadata():
    path = (
        Path(__file__).resolve().parents[1]
        / "data/real_loop/extraction-eval-20261005/results-36h-remaining-v13-20261006-limit32768/mcp-license.json"
    )
    if not path.exists():
        pytest.skip("Local real provider receipt unavailable")
    candidates = json.loads(path.read_text(encoding="utf-8"))["candidates"]
    assert len(candidates) == 8
    rejected = [
        c
        for c in candidates
        if is_generic_license_fact(c["claim"]["subject"], c["claim"]["predicate"])
    ]
    assert len(rejected) == 3
    assert not is_generic_license_fact(
        candidates[0]["claim"]["subject"], candidates[0]["claim"]["predicate"]
    )


@pytest.mark.parametrize(
    "document_id,version",
    [("mcp-license", "v16"), ("langgraph-license", "v16"), ("mcp-license", "v17")],
)
def test_saved_live_output_through_current_schema_anchor_and_relevance_pipeline(
    document_id, version
):
    backend = Path(__file__).resolve().parents[1]
    path = (
        backend
        / f"data/real_loop/extraction-eval-20261005/results-36h-negative-{version}-20261006-limit32768/{document_id}.json"
    )
    if not path.exists():
        pytest.skip("Local real provider receipt unavailable")
    receipt = json.loads(path.read_text(encoding="utf-8"))
    content = (backend / f"data/real_loop/extraction-eval-20261005/{document_id}.txt").read_text(
        encoding="utf-8"
    )
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
        "local-only-replay",
        "gpt-6-astra",
        reasoning_effort="medium",
        max_completion_tokens=32768,
        require_usage=True,
        require_json_schema=True,
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=body)),
    )
    now = datetime.now(UTC)
    source = SourceRecord(
        id="replay-source",
        url="https://example.com/license",
        title=document_id,
        publisher="Saved official document",
        active=True,
        fetch_enabled=False,
        fetch_interval_minutes=240,
        created_at=now,
    )
    snapshot = DocumentSnapshotRecord(
        id="replay-snapshot",
        source_id=source.id,
        content_text=content,
        content_hash=receipt["sourceHash"],
        observed_at=now,
    )
    if document_id == "langgraph-license" or version == "v17":
        with pytest.raises(ExtractionUnavailableError, match="invalid structured response"):
            service.extract(source, snapshot, 20)
        assert service.call_metadata()["coverageStatus"] == "failed"
    else:
        candidates = service.extract(source, snapshot, 20)
        assert len(candidates) == 6
        assert all(c.evidence[0].source_excerpt in content for c in candidates)
        assert candidates[-1].claim.subject.endswith(
            "have not yet granted explicit permission to relicense"
        )
        assert service.call_metadata()["rejectedIrrelevantFacts"] == 10
        assert service.call_metadata()["coverageStatus"] == "full"
