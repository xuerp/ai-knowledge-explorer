"""Single-attempt native Messages transport; no tools, redirects or automatic retries."""

import copy
import json
import re
from time import monotonic

import httpx

from .decision_semantic_transport import ChatTaskInterpreter


def transport_schema(schema):
    schema = copy.deepcopy(schema)

    def walk(value):
        if isinstance(value, dict):
            # Transport grammar supports a subset. Local Pydantic validation
            # still enforces ALL original constraints after receipt.
            for key in (
                "minimum",
                "maximum",
                "multipleOf",
                "minLength",
                "maxLength",
                "maxItems",
                "pattern",
                "default",
            ):
                value.pop(key, None)
            if value.get("minItems", 0) > 1:
                value.pop("minItems")
            if value.get("type") == "object" and "properties" in value:
                value["additionalProperties"] = False
                value["required"] = list(value["properties"])
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(schema)
    return schema


class MessagesTaskInterpreter(ChatTaskInterpreter):
    def interpret(self, request):
        with self.lock:
            if self.blocked or self.calls >= self.max_calls:
                raise ValueError("Model call allocation is closed.")
            self.calls += 1
        started = monotonic()
        self.last_exchange = {"call": self.calls, "requestedOutputTokens": self.max_output_tokens}
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
                    headers={
                        "x-api-key": self.api_key,
                        "anthropic-version": "2023-06-01",
                    },
                    json={
                        "model": self.model,
                        "max_tokens": self.max_output_tokens,
                        # A compatible gateway may accept output_config without
                        # enforcing it upstream. Supply the identical shape in the
                        # prompt as well, then enforce the original schema locally.
                        "system": request["instruction"]
                        + "\nReturn a single JSON object matching this schema.\n"
                        + json.dumps(
                            transport_schema(request["schema"]),
                            ensure_ascii=False,
                            separators=(",", ":"),
                        ),
                        "messages": [
                            {
                                "role": "user",
                                "content": json.dumps(
                                    {
                                        key: value
                                        for key, value in request.items()
                                        if key not in {"instruction", "schema"}
                                    },
                                    ensure_ascii=False,
                                ),
                            }
                        ],
                        "output_config": {
                            "effort": self.reasoning_effort,
                            "format": {
                                "type": "json_schema",
                                "schema": transport_schema(request["schema"]),
                            },
                        },
                    },
                )
                self.last_exchange["httpStatus"] = response.status_code
                response.raise_for_status()
                body = response.json()
            usage = body.get("usage", {})
            counts = [
                usage.get("input_tokens"),
                usage.get("output_tokens"),
                usage.get("cache_read_input_tokens", 0),
                usage.get("cache_creation_input_tokens", 0),
            ]
            if any(type(value) is not int or value < 0 for value in counts):
                raise ValueError("Missing or invalid model usage receipt.")
            prompt, completion = counts[0] + counts[2] + counts[3], counts[1]
            self.last_exchange.update(
                promptTokens=prompt,
                completionTokens=completion,
                totalTokens=prompt + completion,
                returnedModel=body.get("model"),
                finishReason=body.get("stop_reason"),
            )
            response_id = body.get("id")
            if isinstance(response_id, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,128}", response_id):
                self.last_exchange["responseId"] = response_id
            if body.get("stop_reason") != "end_turn":
                raise ValueError("Structured response did not finish normally.")
            content = body.get("content", [])
            if not isinstance(content, list) or any(
                not isinstance(block, dict) for block in content
            ):
                raise ValueError("Unexpected response content blocks.")
            types = [block.get("type") for block in content]
            self.last_exchange["contentTypes"] = [
                kind if kind in {"text", "thinking", "redacted_thinking"} else "unsupported"
                for kind in types
            ]
            if types.count("text") != 1 or any(
                kind not in {"text", "thinking", "redacted_thinking"} for kind in types
            ):
                raise ValueError("Unexpected response content blocks.")
            raw = next(block.get("text") for block in content if block.get("type") == "text")
            if not isinstance(raw, str) or len(raw) > 20000:
                raise ValueError("Structured response exceeds its bound.")
            self.last_content = raw
            fenced = re.fullmatch(r"\s*```json\s*([\s\S]*?)\s*```\s*", raw, re.IGNORECASE)
            return fenced[1] if fenced else raw
        except Exception as error:
            self.last_exchange["errorType"] = type(error).__name__
            self.blocked = True
            raise
        finally:
            self.last_exchange["elapsedMs"] = int((monotonic() - started) * 1000)
