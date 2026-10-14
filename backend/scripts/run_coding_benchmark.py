"""Pure coding-evaluation budget and response contracts.

Historical account-specific execution, consent transcripts, supplier credentials
and receipts are not distributed. Importing this module makes no network call.
"""

import copy
import hashlib
import json
import os
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from urllib.request import HTTPRedirectHandler

ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / "artifacts/decision-coding-benchmark"
MODEL = "claude-opus-5-5"
NODE = os.environ.get("AI_RADAR_NODE", "node")
CLI = Path(os.environ.get("AI_RADAR_CODING_CLI", "claude"))
SOURCE_FILES = (
    "src/domain/decision-reading.ts",
    "src/domain/decision-workflow.ts",
    "src/domain/decision-presentation.ts",
    "src/domain/decision-report-html.ts",
    "backend/data/decision_scenarios.v1.json",
)
TASKS = ("01-fix", "02-feature", "03-refactor")


def now():
    return datetime.now(UTC).isoformat()


def write_json(filename, value):
    filename.parent.mkdir(parents=True, exist_ok=True)
    filename.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class Budget:
    """Reserve before forwarding; never release an unaccounted request."""

    def __init__(self, per_task_limit=None, maximum_usd=Decimal(6), maximum_output_tokens=4096):
        self.spent = Decimal(0)
        self.task_spent = Decimal(0)
        self.per_task_limit = per_task_limit
        self.maximum_usd = maximum_usd
        if maximum_output_tokens not in (4096, 8192, 16384, 32768):
            raise ValueError("Unsupported authorized output maximum")
        self.maximum_output_tokens = maximum_output_tokens
        self.task = None
        self.halted = False
        self.requests = []
        self.request_limit = None
        self.previous_request_count = 0
        self.diagnostic_output_override = False

    def begin(self, task):
        if self.halted:
            raise ValueError("Budget gateway is stopped")
        self.task, self.task_spent = task, Decimal(0)

    def reserve(self, body):
        if self.halted:
            raise ValueError("Prior failure; no retry")
        if (
            self.request_limit is not None
            and len(self.requests) - self.previous_request_count >= self.request_limit
        ):
            self.halted = True
            raise ValueError("Diagnostic request allowance used; stop before forwarding")
        if body.get("model") != MODEL:
            self.halted = True
            raise ValueError("Unapproved model")
        for name in ("thinking", "output_config"):
            if body.get(name) is not None and not isinstance(body[name], dict):
                self.halted = True
                raise ValueError("Invalid reasoning configuration")
        body["max_tokens"] = (
            self.maximum_output_tokens
            if self.diagnostic_output_override
            else min(
                int(body.get("max_tokens", self.maximum_output_tokens)), self.maximum_output_tokens
            )
        )
        if body["max_tokens"] <= 0:
            self.halted = True
            raise ValueError("Invalid output limit")
        encoded = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()
        # A deliberately loose UTF-8 byte/token upper bound plus protocol headroom.
        input_bound = len(encoded) + 2048
        reservation = (Decimal(input_bound) * 12 + Decimal(body["max_tokens"]) * 20) / 1_000_000
        if (self.maximum_usd is not None and self.spent + reservation > self.maximum_usd) or (
            self.per_task_limit is not None and self.task_spent + reservation > self.per_task_limit
        ):
            self.halted = True
            raise ValueError("Insufficient reserved budget; request not sent")
        self.spent += reservation
        self.task_spent += reservation
        record = {
            "task": self.task,
            "startedAt": now(),
            "requestModel": MODEL,
            "requestSha256": hashlib.sha256(encoded).hexdigest(),
            "inputTokenUpperBound": input_bound,
            "maximumOutputTokens": body["max_tokens"],
            "reservedUsd": str(reservation),
            "sent": False,
            "thinkingType": (body.get("thinking") or {}).get("type"),
            "outputEffort": (body.get("output_config") or {}).get("effort"),
        }
        self.requests.append(record)
        return encoded, record

    def settle(self, record, usage, returned_model):
        if returned_model != MODEL:
            raise ValueError("Response model differs from request")
        names = (
            "input_tokens",
            "output_tokens",
            "cache_read_input_tokens",
            "cache_creation_input_tokens",
        )
        if any(type(usage.get(name, 0)) is not int or usage.get(name, 0) < 0 for name in names):
            raise ValueError("Invalid usage")
        if "input_tokens" not in usage or "output_tokens" not in usage:
            raise ValueError("Missing usage")
        inputs = sum(usage.get(name, 0) for name in names if name != "output_tokens")
        outputs = usage["output_tokens"]
        if inputs > record["inputTokenUpperBound"] or outputs > record["maximumOutputTokens"]:
            raise ValueError("Usage exceeds request bounds")
        charged_guard = (Decimal(inputs) * 12 + Decimal(outputs) * 20) / 1_000_000
        reserved = Decimal(record["reservedUsd"])
        if charged_guard > reserved:
            raise ValueError("Usage exceeds reservation")
        self.spent -= reserved - charged_guard
        self.task_spent -= reserved - charged_guard
        record.update(
            usage=usage,
            responseModel=returned_model,
            guardCostUsd=str(charged_guard),
            supplierBilledCostUsd=None,
            settled=True,
            endedAt=now(),
        )

    def view(self):
        return {
            "maximumUsd": float(self.maximum_usd) if self.maximum_usd is not None else None,
            "perTaskMaximumUsd": str(self.per_task_limit) if self.per_task_limit else None,
            "guardAccountedOrReservedUsd": str(self.spent),
            "supplierBilledCostUsd": None,
            "supplierBillingVerified": False,
            "halted": self.halted,
            "requests": self.requests,
            "rates": {"allInputAndCacheUpperUsdPerMillion": 12, "outputUsdPerMillion": 20},
            "rateBasis": [
                "https://platform.claude.com/docs/en/models/opus-5-5/overview",
                "https://www.ccsub.net/docs/pricing",
            ],
            "rateBoundary": "Conservative published-rate envelope, not a provider-side invoice cap",
        }


def continuation_budget(previous, maximum_usd=Decimal(6)):
    """Only a local reservation stop with fully accounted responses is resumable."""
    if previous.get("stopReason") != "Insufficient reserved budget; request not sent":
        raise ValueError("Do not resume provider failures or unknown charges")
    return settled_budget(previous, maximum_usd=maximum_usd)


def settled_budget(previous, maximum_usd=Decimal(6), maximum_output_tokens=4096):
    records = previous.get("budget", {}).get("requests", [])
    if not records or any(not row.get("settled") or row.get("uncertainCharge") for row in records):
        raise ValueError("Unaccounted previous charge; stop")
    ledger = Budget(maximum_usd=maximum_usd, maximum_output_tokens=maximum_output_tokens)
    for row in records:
        if row.get("responseModel") != MODEL:
            raise ValueError("Previous model mismatch")
        usage = row["usage"]
        inputs = sum(
            usage.get(key, 0)
            for key in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
        )
        cost = (Decimal(inputs) * 12 + Decimal(usage["output_tokens"]) * 20) / 1_000_000
        if cost != Decimal(row["guardCostUsd"]):
            raise ValueError("Prior cost ledger changed")
        ledger.spent += cost
    if ledger.spent != Decimal(previous["budget"]["guardAccountedOrReservedUsd"]) or (
        maximum_usd is not None and ledger.spent >= maximum_usd
    ):
        raise ValueError("Prior total changed or budget exhausted")
    ledger.requests = copy.deepcopy(records)
    return ledger


def explicit_output_release_budget(previous):
    if previous.get("stopReason") != "Incomplete provider output; stop before client continuation":
        raise ValueError("Output release does not authorize a provider-failure retry")
    records = previous.get("budget", {}).get("requests", [])
    if (
        not records
        or records[-1].get("responseStopReason") != "max_tokens"
        or records[-1].get("maximumOutputTokens") != 4096
    ):
        raise ValueError("Unexpected output-release checkpoint")
    return settled_budget(previous, maximum_usd=None, maximum_output_tokens=8192)


def diagnostic_release_budget(previous):
    """Human released the last stop for a bounded entry diagnosis, not a benchmark replay."""
    records = previous.get("budget", {}).get("requests", [])
    if (
        previous.get("stopReason") != "Incomplete provider output; stop before client continuation"
        or not records
        or records[-1].get("responseStopReason") != "max_tokens"
        or records[-1].get("maximumOutputTokens") != 8192
    ):
        raise ValueError("Unexpected diagnostic checkpoint")
    ledger = settled_budget(previous, maximum_usd=None, maximum_output_tokens=8192)
    ledger.request_limit = 3
    ledger.previous_request_count = len(ledger.requests)
    ledger.diagnostic_output_override = True
    return ledger


def continue_diagnostic_output(budget, record, reason):
    if (
        not budget.diagnostic_output_override
        or reason != "max_tokens"
        or (
            budget.request_limit is not None
            and len(budget.requests) - budget.previous_request_count >= budget.request_limit
        )
        or budget.maximum_output_tokens >= 32768
    ):
        return False
    record["responseStopReason"] = reason
    record["authorizedOutputContinuation"] = True
    budget.maximum_output_tokens *= 2
    record["nextMaximumOutputTokens"] = budget.maximum_output_tokens
    return True


def prepare_entry_diagnostic():
    folder = PACK / "tasks/entry-diagnostic"
    if folder.exists():
        raise ValueError("Entry diagnostic already prepared; preserve results, no retry")
    (folder / "src").mkdir(parents=True)
    (folder / "tests").mkdir()
    (folder / "AGENTS.md").write_text(
        "Only edit src/entry-probe.mjs. Do not read any parent, sibling, settings, evaluator, or credentials. No network, git, or subagents. Run only node --test tests/solution.test.mjs.\n",
        "utf-8",
    )
    (folder / "TASK.md").write_text(
        "Create src/entry-probe.mjs exporting function probe(value) that returns value + 1. Use the Edit tool with old_string empty to create the file. Then run node --test tests/solution.test.mjs. The tests are already provided and must not be edited. Reply DONE when they pass. No planning essay or other files.\n",
        "utf-8",
    )
    (folder / "tests/solution.test.mjs").write_text(
        "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { probe } from '../src/entry-probe.mjs';\ntest('entry delivers executable module', () => { assert.equal(probe(1), 2); assert.equal(probe(0), 1); assert.equal(probe(-1), 0); });\n",
        "utf-8",
    )
    return folder


def verified_entry_budget(previous):
    if (
        not previous.get("entryDiagnosticPassed")
        or previous.get("stopReason")
        or len(previous.get("tasks", [])) != 1
        or not previous["tasks"][0].get("taskAccepted")
        or previous["tasks"][0].get("task") != "entry-diagnostic"
        or not previous.get("originalSourceHashesUnchanged")
    ):
        raise ValueError("Entry diagnosis did not pass; do not run remaining tasks")
    ledger = settled_budget(previous, maximum_usd=None, maximum_output_tokens=8192)
    ledger.diagnostic_output_override = True
    return ledger


def remaining_tasks_budget(previous, assessment):
    """Advance to untouched tasks after an independent local harness correction."""
    tasks = previous.get("tasks", [])
    if (
        previous.get("stopReason") != "First failed task; remaining tasks not run"
        or len(tasks) != 1
        or tasks[0].get("task") != "01-fix"
        or tasks[0].get("clientResult", {}).get("subtype") != "error_max_turns"
        or not assessment.get("verified")
        or not assessment.get("scopePass")
        or not assessment.get("behavioral", {}).get("passed")
        or assessment.get("solutionTests", {}).get("exitCode") != 0
    ):
        raise ValueError("Not an independently accepted local harness/turn-limit case")
    return settled_budget(previous)


def parse_response(raw, content_type):
    usage, model = {}, None
    if "text/event-stream" in content_type:
        for line in raw.decode("utf-8").splitlines():
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload == "[DONE]":
                continue
            data = json.loads(payload)
            if data.get("type") == "error":
                raise ValueError("Provider stream error")
            message = data.get("message", {})
            model = message.get("model", model)
            usage.update(message.get("usage", {}))
            usage.update(data.get("usage", {}))
    else:
        data = json.loads(raw)
        usage, model = data.get("usage", {}), data.get("model")
    return usage, model


def response_stop_reason(raw, content_type):
    if "text/event-stream" not in content_type:
        return json.loads(raw).get("stop_reason")
    reason = None
    for line in raw.decode("utf-8").splitlines():
        if not line.startswith("data:") or line[5:].strip() == "[DONE]":
            continue
        payload = json.loads(line[5:].strip())
        reason = (
            payload.get("delta", {}).get("stop_reason")
            or payload.get("message", {}).get("stop_reason")
            or reason
        )
    return reason


def response_outline(raw, content_type):
    """Keep response structure and character counts, never generated text or tool inputs."""
    outline = {
        "blockCounts": {"thinking": 0, "text": 0, "tool_use": 0, "other": 0},
        "thinkingCharacters": 0,
        "textCharacters": 0,
        "toolInputCharacters": 0,
        "blockStops": 0,
        "messageStopSeen": False,
    }

    def block(value):
        if not isinstance(value, dict):
            outline["blockCounts"]["other"] += 1
            return
        kind = value.get("type")
        bucket = kind if isinstance(kind, str) and kind in outline["blockCounts"] else "other"
        outline["blockCounts"][bucket] += 1
        for field, counter in [("thinking", "thinkingCharacters"), ("text", "textCharacters")]:
            if isinstance(value.get(field), str):
                outline[counter] += len(value[field])
        if kind == "tool_use" and "input" in value:
            outline["toolInputCharacters"] += len(json.dumps(value["input"], ensure_ascii=False))

    if "text/event-stream" not in content_type:
        payload = json.loads(raw)
        for value in payload.get("content", []):
            block(value)
        outline["messageStopSeen"] = payload.get("stop_reason") is not None
        return outline
    for line in raw.decode("utf-8").splitlines():
        if not line.startswith("data:") or line[5:].strip() == "[DONE]":
            continue
        payload = json.loads(line[5:].strip())
        event = payload.get("type")
        if event == "content_block_start":
            block(payload.get("content_block"))
        elif event == "content_block_stop":
            outline["blockStops"] += 1
        elif event == "message_stop":
            outline["messageStopSeen"] = True
        elif event == "content_block_delta":
            delta = payload.get("delta", {})
            for field, counter in [
                ("thinking", "thinkingCharacters"),
                ("text", "textCharacters"),
                ("partial_json", "toolInputCharacters"),
            ]:
                if isinstance(delta.get(field), str):
                    outline[counter] += len(delta[field])
    return outline


def stop_on_incomplete_output(budget, record, reason):
    record["responseStopReason"] = reason
    if reason in {"max_tokens", "model_context_window_exceeded"}:
        budget.halted = True
        return "Incomplete provider output; stop before client continuation"
    return None


def stop_on_stream_contract_mismatch(budget, record, requested_stream, content_type):
    """Prevent the CLI's protocol fallback from becoming another paid request."""
    record["requestedStream"] = requested_stream is True
    record["responseContentType"] = content_type
    if requested_stream is True and "text/event-stream" not in content_type:
        budget.halted = True
        return "Stream contract mismatch; stop before client fallback"
    return None


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def run():
    raise SystemExit(
        "This distribution contains pure test contracts only; it does not connect an account or execute paid evaluations."
    )


if __name__ == "__main__":
    run()
