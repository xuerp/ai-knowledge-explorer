"""Local reservation controls: no credentials, subprocesses or provider requests."""

import importlib.util
import json
from decimal import Decimal
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "coding_benchmark_runner", Path(__file__).parents[1] / "scripts/run_coding_benchmark.py"
)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def request():
    return {
        "model": runner.MODEL,
        "max_tokens": 8000,
        "messages": [{"role": "user", "content": "Fix code"}],
    }


def test_reservation_precedes_forwarding_and_output_is_bounded():
    ledger = runner.Budget()
    ledger.begin("fix")
    encoded, record = ledger.reserve(request())
    assert json.loads(encoded)["max_tokens"] == 4096
    assert ledger.spent == Decimal(record["reservedUsd"])
    assert not record["sent"]


def test_missing_usage_or_wrong_model_never_releases_reserved_money():
    ledger = runner.Budget()
    ledger.begin("fix")
    _, record = ledger.reserve(request())
    before = ledger.spent
    with pytest.raises(ValueError, match="Missing usage"):
        ledger.settle(record, {}, runner.MODEL)
    with pytest.raises(ValueError, match="differs"):
        ledger.settle(record, {"input_tokens": 10, "output_tokens": 20}, "other")
    assert ledger.spent == before


def test_output_or_input_beyond_contract_never_releases_reservation():
    ledger = runner.Budget()
    ledger.begin("fix")
    _, record = ledger.reserve(request())
    for usage in [
        {"input_tokens": 0, "output_tokens": 4097},
        {"input_tokens": record["inputTokenUpperBound"] + 1, "output_tokens": 0},
        {"input_tokens": True, "output_tokens": 0},
    ]:
        with pytest.raises(ValueError):
            ledger.settle(record, usage, runner.MODEL)
    assert ledger.spent == Decimal(record["reservedUsd"])


def test_budget_blocks_before_sending_and_stays_stopped():
    ledger = runner.Budget(per_task_limit=Decimal(2))
    ledger.begin("fix")
    ledger.task_spent = Decimal("1.99")
    with pytest.raises(ValueError, match="not sent"):
        ledger.reserve(request())
    assert ledger.halted and ledger.requests == []
    with pytest.raises(ValueError, match="no retry"):
        ledger.reserve(request())


def test_user_total_budget_is_not_silently_split_into_three_caps():
    ledger = runner.Budget()
    ledger.begin("fix")
    ledger.task_spent = ledger.spent = Decimal("1.99")
    _, record = ledger.reserve(request())
    assert ledger.spent > 2
    assert not ledger.halted and not record["sent"]
    assert ledger.view()["perTaskMaximumUsd"] is None


def test_global_budget_survives_new_task_and_cached_input_is_counted():
    ledger = runner.Budget()
    ledger.begin("fix")
    _, record = ledger.reserve(request())
    ledger.settle(
        record,
        {
            "input_tokens": 100,
            "output_tokens": 50,
            "cache_read_input_tokens": 200,
            "cache_creation_input_tokens": 300,
        },
        runner.MODEL,
    )
    assert ledger.spent == Decimal("0.0082")
    ledger.begin("feature")
    assert ledger.task_spent == 0 and ledger.spent == Decimal("0.0082")
    ledger.spent = Decimal("5.99")
    with pytest.raises(ValueError, match="not sent"):
        ledger.reserve(request())


def test_stream_usage_merges_final_output_without_double_counting():
    stream = "\n".join(
        "data: " + json.dumps(event)
        for event in [
            {
                "type": "message_start",
                "message": {
                    "model": runner.MODEL,
                    "usage": {"input_tokens": 100, "output_tokens": 0},
                },
            },
            {"type": "message_delta", "usage": {"output_tokens": 30}},
            {"type": "message_delta", "usage": {"output_tokens": 40}},
        ]
    )
    usage, model = runner.parse_response(stream.encode(), "text/event-stream")
    assert usage == {"input_tokens": 100, "output_tokens": 40}
    assert model == runner.MODEL


def test_response_outline_distinguishes_thinking_from_incomplete_tool_input_without_storing_content():
    secret = "private-source-secret"
    events = [
        {"type": "content_block_start", "content_block": {"type": "thinking", "thinking": ""}},
        {"type": "content_block_delta", "delta": {"thinking": secret}},
        {"type": "content_block_stop"},
        {"type": "content_block_start", "content_block": {"type": "tool_use", "name": secret}},
        {"type": "content_block_delta", "delta": {"partial_json": '{"file":"' + secret}},
        {"type": "message_delta", "delta": {"stop_reason": "max_tokens"}},
    ]
    raw = "\n".join("data: " + json.dumps(event) for event in events).encode()
    outline = runner.response_outline(raw, "text/event-stream")
    assert outline["blockCounts"] == {"thinking": 1, "text": 0, "tool_use": 1, "other": 0}
    assert outline["thinkingCharacters"] == len(secret)
    assert outline["toolInputCharacters"] == len('{"file":"' + secret)
    assert outline["blockStops"] == 1 and not outline["messageStopSeen"]
    assert secret not in json.dumps(outline)


@pytest.mark.parametrize("stream", [True, False])
def test_response_outline_recognizes_completed_text_without_saving_it(stream):
    block = {"type": "text", "text": "private answer"}
    payload = {"content": [block], "stop_reason": "end_turn"}
    raw = json.dumps(payload).encode()
    if stream:
        raw = "\n".join(
            "data: " + json.dumps(event)
            for event in [
                {"type": "content_block_start", "content_block": block},
                {"type": "content_block_stop"},
                {"type": "message_stop"},
            ]
        ).encode()
    outline = runner.response_outline(raw, "text/event-stream" if stream else "application/json")
    assert outline["blockCounts"]["text"] == 1
    assert outline["textCharacters"] == len(block["text"])
    assert outline["messageStopSeen"]
    assert block["text"] not in json.dumps(outline)


@pytest.mark.parametrize("stream", [False, True])
def test_explicit_truncation_is_charged_once_and_blocks_client_continuation(stream):
    ledger = runner.Budget()
    ledger.begin("02-feature")
    _, record = ledger.reserve(request())
    usage = {"input_tokens": 100, "output_tokens": 50}
    body = {"model": runner.MODEL, "usage": usage, "stop_reason": "max_tokens"}
    if stream:
        raw = (
            "data: "
            + json.dumps(
                {"type": "message_start", "message": {"model": runner.MODEL, "usage": usage}}
            )
            + "\n\ndata: "
            + json.dumps({"type": "message_delta", "delta": {"stop_reason": "max_tokens"}})
        ).encode()
    else:
        raw = json.dumps(body).encode()
    content_type = "text/event-stream" if stream else "application/json"
    parsed_usage, model = runner.parse_response(raw, content_type)
    ledger.settle(record, parsed_usage, model)
    before = ledger.spent
    assert runner.stop_on_incomplete_output(
        ledger, record, runner.response_stop_reason(raw, content_type)
    )
    assert record["settled"] and not record.get("uncertainCharge")
    assert record["responseStopReason"] == "max_tokens"
    with pytest.raises(ValueError, match="Prior failure; no retry"):
        ledger.reserve(request())
    assert ledger.spent == before and len(ledger.requests) == 1


@pytest.mark.parametrize("reason", ["tool_use", "end_turn", None])
def test_normal_agent_turns_do_not_invent_a_truncation_failure(reason):
    ledger = runner.Budget()
    record = {}
    assert runner.stop_on_incomplete_output(ledger, record, reason) is None
    assert not ledger.halted
    assert record["responseStopReason"] == reason


@pytest.mark.parametrize(
    "stream,content_type,stopped",
    [
        (True, "application/json", True),
        (True, "text/event-stream; charset=utf-8", False),
        (False, "application/json", False),
    ],
)
def test_stream_contract_failure_keeps_settled_usage_and_blocks_paid_fallback(
    stream, content_type, stopped
):
    ledger = runner.Budget(maximum_usd=None)
    ledger.begin("02-feature")
    _, record = ledger.reserve(request())
    ledger.settle(record, {"input_tokens": 100, "output_tokens": 20}, runner.MODEL)
    cost = ledger.spent
    assert (
        bool(runner.stop_on_stream_contract_mismatch(ledger, record, stream, content_type))
        == stopped
    )
    assert record["settled"] and ledger.spent == cost
    assert not record.get("uncertainCharge")
    if stopped:
        with pytest.raises(ValueError, match="no retry"):
            ledger.reserve(request())


def test_provider_error_and_unapproved_model_are_fail_closed():
    with pytest.raises(ValueError, match="stream error"):
        runner.parse_response(b'data: {"type":"error"}\n', "text/event-stream")
    ledger = runner.Budget()
    ledger.begin("fix")
    with pytest.raises(ValueError, match="Unapproved model"):
        ledger.reserve({**request(), "model": "other"})
    assert ledger.halted and ledger.requests == []


def accounted_previous_run():
    ledger = runner.Budget(per_task_limit=Decimal(2))
    ledger.begin("01-fix")
    _, record = ledger.reserve(request())
    record["sent"] = True
    ledger.settle(record, {"input_tokens": 100, "output_tokens": 50}, runner.MODEL)
    ledger.halted = True
    return {"stopReason": "Insufficient reserved budget; request not sent", "budget": ledger.view()}


def test_explicit_budget_removal_keeps_costs_and_other_guards():
    ledger = runner.Budget(maximum_usd=None)
    ledger.begin("02-feature")
    ledger.spent = Decimal(7)
    body = {**request(), "thinking": {"type": "adaptive"}, "output_config": {"effort": "low"}}
    _, record = ledger.reserve(body)
    assert record["maximumOutputTokens"] == 4096
    assert record["thinkingType"] == "adaptive" and record["outputEffort"] == "low"
    ledger.settle(record, {"input_tokens": 100, "output_tokens": 50}, runner.MODEL)
    assert ledger.spent == Decimal("7.0022")
    assert ledger.view()["maximumUsd"] is None
    runner.stop_on_incomplete_output(ledger, record, "max_tokens")
    with pytest.raises(ValueError, match="no retry"):
        ledger.reserve(request())


def test_budget_removal_can_carry_settled_costs_above_old_cap():
    previous = accounted_previous_run()
    record = previous["budget"]["requests"][0]
    record["usage"]["input_tokens"] = 600000
    record["guardCostUsd"] = "7.201"
    previous["budget"]["guardAccountedOrReservedUsd"] = "7.201"
    before = json.dumps(previous, sort_keys=True)
    resumed = runner.continuation_budget(previous, maximum_usd=None)
    assert resumed.spent == Decimal("7.201") and resumed.maximum_usd is None
    assert json.dumps(previous, sort_keys=True) == before
    with pytest.raises(ValueError, match="budget exhausted"):
        runner.continuation_budget(previous)
    previous["budget"]["requests"][0]["uncertainCharge"] = True
    with pytest.raises(ValueError, match="Unaccounted"):
        runner.continuation_budget(previous, maximum_usd=None)


def test_budget_removal_does_not_release_provider_failure_or_invalid_config():
    previous = accounted_previous_run()
    previous["stopReason"] = "HTTPError"
    with pytest.raises(ValueError, match="provider failures"):
        runner.continuation_budget(previous, maximum_usd=None)
    ledger = runner.Budget(maximum_usd=None)
    with pytest.raises(ValueError, match="reasoning configuration"):
        ledger.reserve({**request(), "thinking": "adaptive"})
    assert ledger.halted and not ledger.requests


def test_explicit_output_release_preserves_costs_and_only_changes_authorized_limit():
    previous = accounted_previous_run()
    previous["stopReason"] = "Incomplete provider output; stop before client continuation"
    previous["budget"]["requests"][-1]["responseStopReason"] = "max_tokens"
    before = json.dumps(previous, sort_keys=True)
    ledger = runner.explicit_output_release_budget(previous)
    ledger.begin("02-feature")
    _, record = ledger.reserve({**request(), "max_tokens": 32000})
    assert record["maximumOutputTokens"] == 8192 and ledger.maximum_usd is None
    assert json.dumps(previous, sort_keys=True) == before
    assert len(ledger.requests) == 2
    with pytest.raises(ValueError, match="bounds"):
        ledger.settle(record, {"input_tokens": 0, "output_tokens": 8193}, runner.MODEL)


def test_entry_diagnostic_preserves_history_and_stops_before_fourth_request():
    previous = accounted_previous_run()
    previous["stopReason"] = "Incomplete provider output; stop before client continuation"
    previous["budget"]["requests"][-1].update(
        responseStopReason="max_tokens", maximumOutputTokens=8192
    )
    before = json.dumps(previous, sort_keys=True)
    ledger = runner.diagnostic_release_budget(previous)
    ledger.begin("entry-diagnostic")
    for _ in range(3):
        _, record = ledger.reserve(request())
        ledger.settle(record, {"input_tokens": 10, "output_tokens": 20}, runner.MODEL)
    spent = ledger.spent
    with pytest.raises(ValueError, match="allowance used"):
        ledger.reserve(request())
    assert ledger.halted and ledger.spent == spent and len(ledger.requests) == 4
    assert json.dumps(previous, sort_keys=True) == before


def test_entry_diagnosis_rejects_different_failure_or_uncertain_charge():
    previous = accounted_previous_run()
    with pytest.raises(ValueError, match="checkpoint"):
        runner.diagnostic_release_budget(previous)
    previous["stopReason"] = "Incomplete provider output; stop before client continuation"
    previous["budget"]["requests"][-1].update(
        responseStopReason="max_tokens", maximumOutputTokens=8192, uncertainCharge=True
    )
    with pytest.raises(ValueError, match="Unaccounted"):
        runner.diagnostic_release_budget(previous)


def test_diagnostic_output_increases_only_within_authorized_request_allowance():
    ledger = runner.Budget(maximum_output_tokens=8192)
    ledger.request_limit = 3
    ledger.diagnostic_output_override = True
    ledger.begin("entry-diagnostic")
    for current_limit, next_limit in [(8192, 16384), (16384, 32768)]:
        encoded, record = ledger.reserve({**request(), "max_tokens": 4096})
        assert json.loads(encoded)["max_tokens"] == current_limit
        ledger.settle(record, {"input_tokens": 10, "output_tokens": current_limit}, runner.MODEL)
        assert runner.continue_diagnostic_output(ledger, record, "max_tokens")
        assert record["nextMaximumOutputTokens"] == next_limit and not ledger.halted
    _, record = ledger.reserve(request())
    assert not runner.continue_diagnostic_output(ledger, record, "max_tokens")
    assert not runner.continue_diagnostic_output(runner.Budget(), record, "max_tokens")
    assert not runner.continue_diagnostic_output(ledger, record, "tool_use")


def test_remaining_tasks_require_passed_entry_and_preserve_its_accounted_requests():
    previous = accounted_previous_run()
    with pytest.raises(ValueError, match="did not pass"):
        runner.verified_entry_budget(previous)
    previous.update(
        stopReason=None,
        entryDiagnosticPassed=True,
        originalSourceHashesUnchanged=True,
        tasks=[{"task": "entry-diagnostic", "taskAccepted": True}],
    )
    before = json.dumps(previous, sort_keys=True)
    ledger = runner.verified_entry_budget(previous)
    assert ledger.maximum_usd is None and ledger.diagnostic_output_override
    assert json.dumps(previous, sort_keys=True) == before
    ledger.begin("02-feature")
    _, record = ledger.reserve(request())
    assert runner.continue_diagnostic_output(ledger, record, "max_tokens")
    previous["stopReason"] = "HTTPError"
    with pytest.raises(ValueError, match="did not pass"):
        runner.verified_entry_budget(previous)


def test_output_release_refuses_new_supplier_failure_wrong_checkpoint_and_unknown_charges():
    previous = accounted_previous_run()
    with pytest.raises(ValueError, match="provider-failure"):
        runner.explicit_output_release_budget(previous)
    previous["stopReason"] = "Incomplete provider output; stop before client continuation"
    with pytest.raises(ValueError, match="checkpoint"):
        runner.explicit_output_release_budget(previous)
    previous["budget"]["requests"][-1].update(responseStopReason="max_tokens", uncertainCharge=True)
    with pytest.raises(ValueError, match="Unaccounted"):
        runner.explicit_output_release_budget(previous)


def test_explicit_continuation_carries_prior_costs_without_mutating_receipt():
    previous = accounted_previous_run()
    before = json.dumps(previous, sort_keys=True)
    resumed = runner.continuation_budget(previous)
    assert resumed.spent == Decimal(previous["budget"]["guardAccountedOrReservedUsd"])
    assert resumed.per_task_limit is None
    resumed.begin("01-fix")
    resumed.reserve(request())
    assert len(resumed.requests) == 2
    assert json.dumps(previous, sort_keys=True) == before


def test_continuation_refuses_provider_failure_unsettled_charge_and_changed_ledger():
    previous = accounted_previous_run()
    previous["stopReason"] = "HTTPError"
    with pytest.raises(ValueError, match="provider failures"):
        runner.continuation_budget(previous)
    previous = accounted_previous_run()
    previous["budget"]["requests"][0]["settled"] = False
    with pytest.raises(ValueError, match="Unaccounted"):
        runner.continuation_budget(previous)
    previous = accounted_previous_run()
    previous["budget"]["guardAccountedOrReservedUsd"] = "0"
    with pytest.raises(ValueError, match="total changed"):
        runner.continuation_budget(previous)


def test_untouched_remaining_tasks_carry_all_costs_after_fair_local_acceptance():
    previous = accounted_previous_run()
    previous.update(
        stopReason="First failed task; remaining tasks not run",
        tasks=[{"task": "01-fix", "clientResult": {"subtype": "error_max_turns"}}],
    )
    assessment = {
        "verified": True,
        "scopePass": True,
        "behavioral": {"passed": True},
        "solutionTests": {"exitCode": 0},
    }
    before = json.dumps(previous, sort_keys=True)
    budget = runner.remaining_tasks_budget(previous, assessment)
    budget.begin("02-feature")
    assert budget.spent == Decimal(previous["budget"]["guardAccountedOrReservedUsd"])
    assert len(budget.requests) == 1
    assert json.dumps(previous, sort_keys=True) == before


def test_remaining_tasks_refuse_unaccepted_code_provider_failure_or_unknown_charge():
    previous = accounted_previous_run()
    previous.update(
        stopReason="First failed task; remaining tasks not run",
        tasks=[{"task": "01-fix", "clientResult": {"subtype": "error_max_turns"}}],
    )
    assessment = {
        "verified": True,
        "scopePass": True,
        "behavioral": {"passed": True},
        "solutionTests": {"exitCode": 0},
    }
    with pytest.raises(ValueError, match="independently accepted"):
        runner.remaining_tasks_budget(previous, {**assessment, "verified": False})
    previous["tasks"][0]["clientResult"]["subtype"] = "error_during_execution"
    with pytest.raises(ValueError, match="independently accepted"):
        runner.remaining_tasks_budget(previous, assessment)
    previous["tasks"][0]["clientResult"]["subtype"] = "error_max_turns"
    previous["budget"]["requests"][0]["uncertainCharge"] = True
    with pytest.raises(ValueError, match="Unaccounted"):
        runner.remaining_tasks_budget(previous, assessment)
