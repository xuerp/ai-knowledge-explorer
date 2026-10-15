"""Opt-in local API trials. No network on import or preview; never executes model code.

Credentials stay in local environment variables. The public web service does not
accept provider keys or arbitrary endpoints. Receipts are private user records,
not verified public facts or proof of a gateway's underlying model identity.
"""

import argparse
import asyncio
import hashlib
import json
import math
import os
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

import httpx
from pydantic import Field, ValidationError, field_validator, model_validator

from .schemas import CamelModel


def digest(value) -> str:
    return hashlib.sha256(
        json.dumps(
            value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False
        ).encode()
    ).hexdigest()


class TrialSample(CamelModel):
    id: str = Field(min_length=1, max_length=100)
    input: str = Field(min_length=1, max_length=20000)
    expected: str | dict | list | int | float | bool | None


class TrialPlan(CamelModel):
    format: Literal["ai-radar-api-trial-v1"] = "ai-radar-api-trial-v1"
    research_id: str = Field(min_length=1, max_length=128)
    candidate_ids: list[str] = Field(min_length=1, max_length=3)
    task: str = Field(min_length=1, max_length=5000)
    instruction: str = Field(min_length=1, max_length=5000)
    samples: list[TrialSample] = Field(min_length=1, max_length=20)
    grader: Literal["json-exact", "text-exact"] = "json-exact"
    minimum_successful_samples: int = Field(ge=1, le=20)
    maximum_output_tokens: int = Field(default=4096, ge=64, le=32768)
    maximum_seconds: int = Field(default=120, ge=1, le=900)
    maximum_estimated_cost: float = Field(gt=0, le=10000, allow_inf_nan=False)
    currency: str = Field(pattern=r"^[A-Z]{3}$")

    @model_validator(mode="after")
    def consistent(self):
        if len(set(self.candidate_ids)) != len(self.candidate_ids):
            raise ValueError("Duplicate candidates")
        if len({row.id for row in self.samples}) != len(self.samples):
            raise ValueError("Duplicate sample ids")
        if self.minimum_successful_samples > len(self.samples):
            raise ValueError("Success threshold exceeds the sample count")
        if self.grader == "text-exact" and any(
            not isinstance(row.expected, str) for row in self.samples
        ):
            raise ValueError("Text grading requires predeclared text answers")
        return self


class TrialTarget(CamelModel):
    candidate_id: str = Field(min_length=1, max_length=128)
    model: str = Field(min_length=1, max_length=200)
    endpoint: str = Field(min_length=1, max_length=1000)
    protocol: Literal["messages", "chat-completions"]
    key_env: str = Field(pattern=r"^[A-Z][A-Z0-9_]{0,99}$")
    input_per_million: float = Field(ge=0, le=100000, allow_inf_nan=False)
    output_per_million: float = Field(ge=0, le=100000, allow_inf_nan=False)
    currency: str = Field(pattern=r"^[A-Z]{3}$")

    @field_validator("endpoint")
    @classmethod
    def public_https_endpoint(cls, value):
        url = urlsplit(value)
        if (
            url.scheme != "https"
            or not url.hostname
            or url.username
            or url.password
            or url.query
            or url.fragment
            or url.port not in (None, 443)
            or url.hostname in {"localhost", "127.0.0.1", "::1"}
        ):
            raise ValueError("Use an explicit HTTPS endpoint without credentials or query strings")
        return value


def request_body(plan: TrialPlan, target: TrialTarget, sample: TrialSample):
    instruction = plan.instruction
    if plan.grader == "json-exact":
        instruction += "\nReturn only the requested JSON value. Do not add a code fence."
    if target.protocol == "messages":
        return {
            "model": target.model,
            "max_tokens": plan.maximum_output_tokens,
            "system": instruction,
            "messages": [{"role": "user", "content": sample.input}],
        }
    return {
        "model": target.model,
        "max_completion_tokens": plan.maximum_output_tokens,
        "messages": [
            {"role": "system", "content": instruction},
            {"role": "user", "content": sample.input},
        ],
    }


def response_result(payload, target: TrialTarget):
    if not isinstance(payload, dict):
        raise TypeError("invalid-response-object")
    if payload.get("model") != target.model:
        raise ValueError("response-model-mismatch")
    usage = payload.get("usage") or {}
    if not isinstance(usage, dict):
        raise TypeError("invalid-usage-object")
    if target.protocol == "messages":
        if payload.get("stop_reason") != "end_turn":
            raise ValueError("incomplete-or-unsupported-stop")
        content = payload.get("content")
        if (
            not isinstance(content, list)
            or not content
            or any(
                not isinstance(row, dict)
                or row.get("type") != "text"
                or not isinstance(row.get("text"), str)
                for row in content
            )
        ):
            raise ValueError("unsupported-content")
        output = "".join(row["text"] for row in content)
        input_tokens, output_tokens = usage.get("input_tokens"), usage.get("output_tokens")
        if any(
            usage.get(key, 0) for key in ("cache_creation_input_tokens", "cache_read_input_tokens")
        ):
            raise ValueError("cache-cost-not-covered-by-declared-rates")
    else:
        choices = payload.get("choices")
        if not isinstance(choices, list) or len(choices) != 1:
            raise ValueError("unsupported-choices")
        choice = choices[0]
        if not isinstance(choice, dict):
            raise ValueError("invalid-choice-object")
        message = choice.get("message") or {}
        if not isinstance(message, dict):
            raise ValueError("invalid-message-object")
        if (
            choice.get("finish_reason") != "stop"
            or message.get("refusal")
            or message.get("tool_calls")
        ):
            raise ValueError("incomplete-or-unsupported-stop")
        output = message.get("content")
        input_tokens, output_tokens = usage.get("prompt_tokens"), usage.get("completion_tokens")
    if not isinstance(output, str) or not output.strip():
        raise ValueError("missing-output")
    if any(type(n) is not int or n < 0 for n in (input_tokens, output_tokens)):
        raise ValueError("missing-or-invalid-usage")
    return output, input_tokens, output_tokens


def grade(output: str, expected, grader: str) -> bool:
    if grader == "text-exact":
        return output.strip() == expected.strip()
    try:
        # Canonical JSON equality keeps booleans distinct from integers and
        # verifies missing/extra fields as well as nested structures.
        return digest(json.loads(output)) == digest(expected)
    except ValueError:
        return False


async def fetch_payload(target, body, headers, timeout_seconds, transport):
    # A total deadline also bounds a peer that continually trickles bytes.
    async with asyncio.timeout(timeout_seconds):
        async with httpx.AsyncClient(
            transport=transport, trust_env=False, follow_redirects=False
        ) as client:
            async with client.stream(
                "POST",
                target.endpoint,
                json=body,
                headers=headers,
                timeout=timeout_seconds,
            ) as response:
                response.raise_for_status()
                raw = bytearray()
                async for chunk in response.aiter_bytes():
                    raw.extend(chunk)
                    if len(raw) > 1_000_000:
                        raise ValueError("oversized-response")
                return json.loads(raw)


def preflight(plan: TrialPlan, targets: list[TrialTarget]):
    if {t.candidate_id for t in targets} != set(plan.candidate_ids) or len(targets) != len(
        plan.candidate_ids
    ):
        raise ValueError("Configure exactly the selected candidates once")
    if any(t.currency != plan.currency for t in targets):
        raise ValueError("Costs in different currencies cannot share a budget")
    if len({(t.endpoint, t.model, t.protocol) for t in targets}) != len(targets):
        raise ValueError("The same API endpoint and model cannot stand in for multiple candidates")
    bounds = []
    for target in targets:
        for sample in plan.samples:
            body = request_body(plan, target, sample)
            input_bound = len(json.dumps(body, ensure_ascii=False).encode()) + 4096
            bounds.append(
                (
                    input_bound * target.input_per_million
                    + plan.maximum_output_tokens * target.output_per_million
                )
                / 1e6
            )
    return {
        "mode": "preview",
        "researchId": plan.research_id,
        "planDigest": digest(plan.model_dump(by_alias=True)),
        "requests": len(bounds),
        "maximumEstimatedCost": sum(bounds),
        "currency": plan.currency,
        "fitsDeclaredEstimateLimit": sum(bounds) <= plan.maximum_estimated_cost,
        "rateBasis": "local-user-declared-rates-not-an-invoice",
        "requiredKeyEnvs": [t.key_env for t in targets],
        "targets": [
            {
                "candidateId": t.candidate_id,
                "model": t.model,
                "endpoint": t.endpoint,
                "protocol": t.protocol,
            }
            for t in targets
        ],
        "networkCalls": 0,
    }


def run_trial(plan, targets, output_dir: Path, *, accept_data_transfer=False, transport=None):
    if not accept_data_transfer:
        raise ValueError("Explicit data-transfer and paid-request consent is required")
    preview = preflight(plan, targets)
    if not preview["fitsDeclaredEstimateLimit"]:
        raise ValueError("Preflight exceeds the declared estimated cost ceiling; no request sent")
    keys = {t.candidate_id: os.environ.get(t.key_env, "") for t in targets}
    if not all(keys.values()):
        raise ValueError("Required key environment variable is missing; no request sent")
    # Never resume an uncertain request or overwrite an earlier receipt.
    output_dir.mkdir(parents=True, exist_ok=False, mode=0o700)
    start = time.monotonic()
    started = datetime.now(UTC).isoformat()
    receipt = {
        "format": "ai-radar-api-trial-receipt-v1",
        "researchId": plan.research_id,
        "planDigest": preview["planDigest"],
        "startedAt": started,
        "sampleCount": len(plan.samples),
        "minimumSuccessfulSamples": plan.minimum_successful_samples,
        "scope": f"{plan.grader}; batch {preview['planDigest']}",
        "configuration": digest(
            {
                "instruction": plan.instruction,
                "grader": plan.grader,
                "maximumOutputTokens": plan.maximum_output_tokens,
            }
        ),
        "currency": plan.currency,
        "rateBasis": preview["rateBasis"],
        "results": [],
        "status": "running",
        "requestsSent": 0,
        "estimatedCost": 0.0,
        "kind": "private-api-trial-not-product-ranking",
        "plan": plan.model_dump(by_alias=True),
    }

    def save():
        temp = output_dir / "receipt.tmp"
        content = json.dumps(receipt, ensure_ascii=False, indent=2)
        # Windows scanners can briefly hold a just-written destination open.
        # Retry only this local atomic save, never the paid supplier request.
        for attempt in range(5):
            try:
                with temp.open("w", encoding="utf-8") as handle:
                    handle.write(content)
                    handle.flush()
                    os.fsync(handle.fileno())
                temp.replace(output_dir / "receipt.json")
                break
            except PermissionError:
                if attempt == 4:
                    raise
                time.sleep(0.025 * (2**attempt))

    save()
    halted = False
    try:
        for target in targets:
            result = {
                "candidateId": target.candidate_id,
                "requestedModel": target.model,
                "endpointOrigin": f"https://{urlsplit(target.endpoint).hostname}",
                "samples": [],
                "status": "not-run",
                "successfulSamples": 0,
            }
            receipt["results"].append(result)
            for sample in plan.samples:
                if halted or time.monotonic() - start >= plan.maximum_seconds:
                    halted = True
                    result["status"] = "blocked"
                    break
                body = request_body(plan, target, sample)
                bound = len(json.dumps(body, ensure_ascii=False).encode()) + 4096
                reserved = (
                    bound * target.input_per_million
                    + plan.maximum_output_tokens * target.output_per_million
                ) / 1e6
                if receipt["estimatedCost"] + reserved > plan.maximum_estimated_cost:
                    halted = True
                    result["status"] = "blocked"
                    break
                headers = {"Content-Type": "application/json"}
                if target.protocol == "messages":
                    headers.update(
                        {
                            "x-api-key": keys[target.candidate_id],
                            "anthropic-version": "2023-06-01",
                        }
                    )
                else:
                    headers["Authorization"] = "Bearer " + keys[target.candidate_id]
                entry = {
                    "sampleId": sample.id,
                    "requestDigest": digest(body),
                    "status": "request-in-flight",
                    "reservedEstimate": reserved,
                }
                result["samples"].append(entry)
                receipt["requestsSent"] += 1
                receipt["estimatedCost"] += reserved
                save()  # Durable before forwarding; a crash is never silently retried.
                call_start = time.monotonic()
                try:
                    remaining = plan.maximum_seconds - (call_start - start)
                    payload = asyncio.run(
                        fetch_payload(
                            target, body, headers, max(0.01, min(30, remaining)), transport
                        )
                    )
                    output, used_input, used_output = response_result(payload, target)
                    if used_input > bound or used_output > plan.maximum_output_tokens:
                        raise ValueError("usage-exceeds-declared-bound")
                    cost = (
                        used_input * target.input_per_million
                        + used_output * target.output_per_million
                    ) / 1e6
                    receipt["estimatedCost"] += cost - reserved
                    passed = grade(output, sample.expected, plan.grader)
                    entry.update(
                        status="passed" if passed else "failed",
                        output=output,
                        inputTokens=used_input,
                        outputTokens=used_output,
                        estimatedCost=cost,
                    )
                    result["successfulSamples"] += int(passed)
                except (httpx.HTTPError, ValueError, TypeError, KeyError, TimeoutError) as error:
                    # No response body, credentials, arbitrary provider exception
                    # text or proxy URL is copied into logs.
                    known = {
                        "response-model-mismatch",
                        "incomplete-or-unsupported-stop",
                        "unsupported-content",
                        "cache-cost-not-covered-by-declared-rates",
                        "unsupported-choices",
                        "missing-output",
                        "missing-or-invalid-usage",
                        "usage-exceeds-declared-bound",
                        "oversized-response",
                    }
                    reason = (
                        "http-status-" + str(error.response.status_code)
                        if isinstance(error, httpx.HTTPStatusError)
                        else "request-timeout"
                        if isinstance(error, (httpx.TimeoutException, TimeoutError))
                        else str(error)
                        if isinstance(error, ValueError) and str(error) in known
                        else "transport-or-response-contract-failed"
                    )
                    entry.update(status="execution-error", reason=reason)
                    halted = True
                    result["status"] = "blocked"
                entry["latencyMs"] = round((time.monotonic() - call_start) * 1000, 3)
                save()
                if halted:
                    break
            if not halted:
                result["status"] = "complete"
            latencies = sorted(row["latencyMs"] for row in result["samples"] if "latencyMs" in row)
            if latencies:
                result["p50Ms"] = latencies[math.ceil(0.5 * len(latencies)) - 1]
                result["p95Ms"] = latencies[math.ceil(0.95 * len(latencies)) - 1]
            save()
        receipt["status"] = "blocked" if halted else "complete"
    finally:
        recorded = {row["candidateId"] for row in receipt["results"]}
        for target in targets:
            if target.candidate_id not in recorded:
                receipt["results"].append(
                    {
                        "candidateId": target.candidate_id,
                        "requestedModel": target.model,
                        "endpointOrigin": f"https://{urlsplit(target.endpoint).hostname}",
                        "samples": [],
                        "status": "not-run",
                        "successfulSamples": 0,
                    }
                )
        receipt["completedAt"] = datetime.now(UTC).isoformat()
        if receipt["status"] == "running":
            receipt["status"] = "interrupted"
        save()
    return receipt


def main():
    parser = argparse.ArgumentParser(
        description="Local opt-in API trial; default is no-call preview"
    )
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--targets", type=Path)
    parser.add_argument("--setup-targets", action="store_true")
    parser.add_argument("--prompt-for-keys", action="store_true")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--accept-data-transfer", action="store_true")
    args = parser.parse_args()
    plan = TrialPlan.model_validate_json(args.plan.read_text("utf-8"))
    target_file = args.targets or args.plan.with_suffix(".targets.json")
    if args.setup_targets:
        configured = []
        for index, candidate_id in enumerate(plan.candidate_ids, 1):
            print(f"Configure {candidate_id}; no API key will be written to disk.")
            configured.append(
                TrialTarget.model_validate(
                    {
                        "candidateId": candidate_id,
                        "model": input("Exact API model id: ").strip(),
                        "endpoint": input("Full HTTPS API endpoint: ").strip(),
                        "protocol": input("Protocol (messages / chat-completions): ").strip(),
                        "keyEnv": input(
                            f"Key environment variable (default AI_RADAR_TRIAL_KEY_{index}): "
                        ).strip()
                        or f"AI_RADAR_TRIAL_KEY_{index}",
                        "inputPerMillion": float(
                            input(f"Input rate per million ({plan.currency}): ")
                        ),
                        "outputPerMillion": float(
                            input(f"Output rate per million ({plan.currency}): ")
                        ),
                        "currency": plan.currency,
                    }
                ).model_dump(by_alias=True)
            )
        with target_file.open("x", encoding="utf-8") as out:
            json.dump(configured, out, ensure_ascii=False, indent=2)
    targets = [TrialTarget.model_validate(t) for t in json.loads(target_file.read_text("utf-8"))]
    if not args.execute:
        print(json.dumps(preflight(plan, targets), ensure_ascii=False, indent=2))
        return
    if args.output is None:
        parser.error("--execute requires a new --output directory")
    temporary_keys = []
    try:
        if args.prompt_for_keys:
            if not args.accept_data_transfer:
                parser.error("--prompt-for-keys requires explicit --accept-data-transfer")
            if not sys.stdin.isatty():
                parser.error(
                    "Hidden key entry requires an interactive terminal; otherwise use key environment variables"
                )
            from getpass import getpass

            for target in targets:
                if not os.environ.get(target.key_env):
                    os.environ[target.key_env] = getpass(
                        f"Local secret for {target.key_env} (not saved): "
                    )
                    temporary_keys.append(target.key_env)
        result = run_trial(
            plan, targets, args.output, accept_data_transfer=args.accept_data_transfer
        )
    finally:
        for name in temporary_keys:
            os.environ.pop(name, None)
    print(
        json.dumps(
            {
                "status": result["status"],
                "requestsSent": result["requestsSent"],
                "receipt": str(args.output / "receipt.json"),
            }
        )
    )


if __name__ == "__main__":
    try:
        main()
    except (ValidationError, ValueError, OSError):
        print(
            "Trial stopped. Check file paths, endpoint, model, environment names, samples and limits. No automatic retry; preserve any existing receipt.",
            file=sys.stderr,
        )
        raise SystemExit(2) from None
