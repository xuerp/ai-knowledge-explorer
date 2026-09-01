import json
from datetime import date

import httpx
import pytest

from app.embeddings import (
    CloudflareEmbeddingProvider,
    EmbeddingBudgetExceeded,
    EmbeddingProviderError,
)


def build_provider(
    handler,
    *,
    dimension: int = 3,
    daily_neuron_budget: float = 100,
    daily_api_call_budget: int = 10,
    max_batch_size: int = 2,
):
    client = httpx.Client(
        transport=httpx.MockTransport(handler),
        base_url="https://example.invalid/v1",
    )
    return CloudflareEmbeddingProvider(
        account_id="account-id",
        api_token="secret-token",
        model_name="@cf/baai/bge-m3",
        model_version="managed-test-version",
        dimension=dimension,
        daily_neuron_budget=daily_neuron_budget,
        daily_api_call_budget=daily_api_call_budget,
        max_batch_size=max_batch_size,
        client=client,
        today=lambda: date(2026, 8, 31),
    )


def test_cloudflare_provider_batches_and_validates_vectors():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        payload = json.loads(request.read())
        count = len(payload["input"])
        return httpx.Response(
            200,
            json={
                "data": [
                    {"index": index, "embedding": [float(index + 1), 0.0, 0.0]}
                    for index in range(count)
                ]
            },
        )

    provider = build_provider(handler)
    vectors = provider.embed_documents(["文本一", "文本二", "文本三"])

    assert len(requests) == 2
    assert vectors == [[1.0, 0.0, 0.0], [2.0, 0.0, 0.0], [1.0, 0.0, 0.0]]
    assert all(request.url.path == "/v1/embeddings" for request in requests)


def test_cloudflare_provider_blocks_budget_before_network():
    calls = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"data": []})

    provider = build_provider(handler, daily_neuron_budget=0.0001)

    with pytest.raises(EmbeddingBudgetExceeded, match="Neuron budget"):
        provider.embed_query("这段输入会在网络请求前触发预算保护")

    assert calls == 0


def test_cloudflare_provider_error_is_safe_to_log():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="upstream body may contain secret-token")

    provider = build_provider(handler)

    with pytest.raises(EmbeddingProviderError) as captured:
        provider.embed_query("测试")

    message = str(captured.value)
    assert "401" in message
    assert "secret-token" not in message
    assert "upstream body" not in message


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ({"notData": []}, "invalid embedding payload"),
        ({"data": []}, "unexpected result count"),
        ({"data": [{"index": 0, "embedding": [1.0, 2.0]}]}, "unexpected embedding dimension"),
        ({"data": [{"index": 0, "embedding": ["secret-value", 0, 0]}]}, "non-numeric"),
        ({"data": [{"index": 0, "embedding": ["NaN", 0, 0]}]}, "non-finite"),
    ],
    ids=[
        "missing-data",
        "unexpected-count",
        "unexpected-dimension",
        "non-numeric",
        "non-finite",
    ],
)
def test_cloudflare_provider_rejects_malformed_vectors_without_leaking_payload(
    payload,
    message,
):
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    provider = build_provider(handler)

    with pytest.raises(EmbeddingProviderError, match=message) as captured:
        provider.embed_query("测试")

    assert "secret-value" not in str(captured.value)
