"""Mock HTTP only. These tests never contact a supplier."""

import json

import httpx
import pytest

from app.decision_semantic_transport import ChatTaskInterpreter

REQUEST = {"instruction": "Parse", "task": "Synthetic task", "schema": {"type": "object"}}


def test_budget_and_http_contract_without_supplier_call():
    received = []

    def handle(request):
        received.append(request)
        return httpx.Response(
            200,
            json={
                "usage": {"total_tokens": 100},
                "choices": [{"finish_reason": "stop", "message": {"content": "{}"}}],
            },
        )

    interpreter = ChatTaskInterpreter(
        endpoint="https://example.test/chat/completions",
        api_key="fake",
        model="fake",
        max_calls=1,
        transport=httpx.MockTransport(handle),
    )
    assert interpreter.interpret(REQUEST) == "{}"
    assert interpreter.total_tokens == 100
    with pytest.raises(ValueError, match="budget"):
        interpreter.interpret(REQUEST)
    assert len(received) == 1
    payload = json.loads(received[0].content)
    assert payload["max_completion_tokens"] == 4096
    assert payload["reasoning_effort"] == "low"


def test_missing_usage_closes_adapter_without_retry():
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}}]})

    interpreter = ChatTaskInterpreter(
        endpoint="http://127.0.0.1:9999/v1/chat/completions",
        api_key="",
        model="fake-local",
        max_calls=3,
        transport=httpx.MockTransport(handle),
    )
    with pytest.raises(ValueError, match="usage"):
        interpreter.interpret(REQUEST)
    with pytest.raises(ValueError, match="budget"):
        interpreter.interpret(REQUEST)
    assert len(requests) == 1


def test_remote_plaintext_endpoint_rejected():
    with pytest.raises(ValueError, match="HTTPS"):
        ChatTaskInterpreter(
            endpoint="http://example.test/chat/completions",
            api_key="fake",
            model="fake",
            max_calls=1,
        )


def test_explicit_nonreasoning_profile_preserves_model_and_token_budget():
    requests = []

    def handle(request):
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "usage": {"total_tokens": 30},
                "choices": [{"finish_reason": "stop", "message": {"content": "{}"}}],
            },
        )

    interpreter = ChatTaskInterpreter(
        endpoint="https://example.test/chat/completions",
        api_key="fake",
        model="explicit-lightweight-model",
        max_calls=1,
        reasoning_effort="none",
        transport=httpx.MockTransport(handle),
    )
    assert interpreter.interpret(REQUEST) == "{}"
    assert requests[0]["model"] == "explicit-lightweight-model"
    assert requests[0]["reasoning_effort"] == "none"
    assert requests[0]["max_completion_tokens"] == 4096


def test_truncated_output_closes_adapter_even_if_json_looks_complete():
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200,
            json={
                "usage": {
                    "total_tokens": 100,
                    "prompt_tokens": 20,
                    "completion_tokens": 80,
                    "completion_tokens_details": {"reasoning_tokens": 70},
                },
                "choices": [{"finish_reason": "length", "message": {"content": "{}"}}],
            },
        )
    )
    interpreter = ChatTaskInterpreter(
        endpoint="https://example.test/chat/completions",
        api_key="fake",
        model="fake",
        max_calls=2,
        transport=transport,
    )
    with pytest.raises(ValueError, match="finish"):
        interpreter.interpret(REQUEST)
    assert interpreter.blocked and interpreter.calls == 1 and interpreter.total_tokens == 100
    assert interpreter.last_exchange["reasoningTokens"] == 70
    assert interpreter.last_exchange["contentCharacters"] == 2
    assert interpreter.last_content is None


def test_nonreasoning_profile_rejects_contradictory_provider_usage():
    interpreter = ChatTaskInterpreter(
        endpoint="https://example.test/chat/completions",
        api_key="fake",
        model="fake",
        max_calls=2,
        reasoning_effort="none",
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200,
                json={
                    "model": "returned-model",
                    "usage": {
                        "total_tokens": 100,
                        "completion_tokens_details": {"reasoning_tokens": 80},
                    },
                    "choices": [{"finish_reason": "stop", "message": {"content": "{}"}}],
                },
            )
        ),
    )
    with pytest.raises(ValueError, match="nonreasoning"):
        interpreter.interpret(REQUEST)
    assert interpreter.calls == 1 and interpreter.blocked
    assert interpreter.last_exchange["returnedModel"] == "returned-model"
    assert interpreter.last_content is None
