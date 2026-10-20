"""Explicitly constructed, bounded evaluation adapter for compatible chat APIs.

No environment discovery, credential reuse, automatic startup, retry or supplier
selection. A host must authorize the endpoint, model, input and session budget.
The call counter is process-local: this adapter is not a production billing cap.
"""

import json
from threading import Lock
from time import monotonic
from urllib.parse import urlsplit

import httpx


class ChatTaskInterpreter:
    def __init__(
        self,
        *,
        endpoint: str,
        api_key: str,
        model: str,
        max_calls: int,
        response_timeout_seconds: int = 30,
        transport=None,
    ):
        parsed = urlsplit(endpoint)
        local = parsed.hostname in {"127.0.0.1", "localhost", "::1"}
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Use an endpoint without embedded credentials or query parameters.")
        if not parsed.hostname or (
            parsed.scheme != "https" and not (local and parsed.scheme == "http")
        ):
            raise ValueError("Use HTTPS or an explicitly configured loopback endpoint.")
        if not 1 <= max_calls <= 100 or not model.strip():
            raise ValueError("A model and bounded evaluation call budget are required.")
        if not 1 <= response_timeout_seconds <= 90:
            raise ValueError("The response timeout must stay within 1..90 seconds.")
        self.response_timeout_seconds = response_timeout_seconds
        self.endpoint, self.api_key, self.model = endpoint, api_key, model
        self.max_calls = max_calls
        self.calls = 0
        self.total_tokens = 0
        self.blocked = False
        self.lock = Lock()
        self.transport = transport
        self.last_exchange = {}
        self.last_content = None

    def interpret(self, request: dict) -> str:
        with self.lock:
            if self.blocked or self.calls >= self.max_calls:
                raise ValueError("Evaluation call budget is closed.")
            self.calls += 1
        # Increment before sending, including failures, to prevent retry loops.
        started = monotonic()
        self.last_exchange = {"call": self.calls}
        self.last_content = None
        try:
            with httpx.Client(
                timeout=self.response_timeout_seconds,
                trust_env=False,
                follow_redirects=False,
                transport=self.transport,
            ) as client:
                response = client.post(
                    self.endpoint,
                    headers={"Authorization": "Bearer " + self.api_key},
                    json={
                        "model": self.model,
                        "messages": [
                            {"role": "system", "content": request["instruction"]},
                            {
                                "role": "user",
                                "content": json.dumps(
                                    {
                                        key: value
                                        for key, value in request.items()
                                        if key != "instruction"
                                    },
                                    ensure_ascii=False,
                                ),
                            },
                        ],
                        "max_completion_tokens": 4096,
                        "reasoning_effort": "low",
                        "response_format": {
                            "type": "json_schema",
                            "json_schema": {
                                "name": "task_meaning",
                                "strict": True,
                                "schema": request["schema"],
                            },
                        },
                    },
                )
                self.last_exchange["httpStatus"] = response.status_code
                response.raise_for_status()
                body = response.json()
            usage = body.get("usage", {})
            total = usage.get("total_tokens")
            if type(total) is not int or total <= 0:
                raise ValueError("Missing usage receipt.")
            with self.lock:
                self.total_tokens += total
            self.last_exchange["totalTokens"] = total
            finish = body["choices"][0].get("finish_reason")
            self.last_exchange["finishReason"] = (
                finish if finish in {"stop", "length", "content_filter", "tool_calls"} else "other"
            )
            if finish != "stop":
                raise ValueError("The structured response did not finish normally.")
            content = body["choices"][0]["message"]["content"]
            if not isinstance(content, str) or len(content) > 20000:
                raise ValueError("Invalid structured response.")
            self.last_content = content
            self.last_exchange["contentCharacters"] = len(content)
            return content
        except Exception as error:
            # Error classes and status codes only; never serialize headers,
            # endpoint URLs, provider messages or exception arguments.
            self.last_exchange["errorType"] = type(error).__name__
            with self.lock:
                self.blocked = True
            raise
        finally:
            self.last_exchange["elapsedMs"] = int((monotonic() - started) * 1000)
