"""Synthetic transport fixtures, never evidence about real supplier performance."""

import json

import httpx
import pytest

from app.decision_trial_runner import TrialPlan, TrialTarget, grade, preflight, run_trial


def plan(**changes):
    return TrialPlan.model_validate(
        {
            "researchId": "synthetic-research",
            "candidateIds": ["a", "b"],
            "task": "Extract the supplied integer",
            "instruction": "Return the integer as JSON",
            "samples": [
                {"id": "one", "input": "1", "expected": 1},
                {"id": "two", "input": "2", "expected": 2},
            ],
            "minimumSuccessfulSamples": 2,
            "maximumEstimatedCost": 1,
            "currency": "USD",
            **changes,
        }
    )


def targets():
    return [
        TrialTarget.model_validate(
            {
                "candidateId": candidate,
                "model": f"fixture-{candidate}",
                "endpoint": "https://supplier.example/"
                + ("messages" if candidate == "a" else "chat/completions"),
                "protocol": "messages" if candidate == "a" else "chat-completions",
                "keyEnv": "SYNTHETIC_TEST_KEY",
                "inputPerMillion": 1,
                "outputPerMillion": 2,
                "currency": "USD",
            }
        )
        for candidate in ("a", "b")
    ]


def payload(body):
    output = body["messages"][-1]["content"]
    if body["model"] == "fixture-a":
        return {
            "model": body["model"],
            "stop_reason": "end_turn",
            "content": [{"type": "text", "text": output}],
            "usage": {"input_tokens": 10, "output_tokens": 2},
        }
    return {
        "model": body["model"],
        "choices": [{"finish_reason": "stop", "message": {"content": output}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 2},
    }


def test_same_samples_across_two_protocols_and_receipt_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv("SYNTHETIC_TEST_KEY", "not-a-real-key")
    calls = []

    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        assert "expected" not in request.content.decode()
        return httpx.Response(200, json=payload(body))

    output = tmp_path / "run"
    result = run_trial(
        plan(), targets(), output, accept_data_transfer=True, transport=httpx.MockTransport(handler)
    )
    assert result["status"] == "complete" and result["requestsSent"] == 4
    assert [row["successfulSamples"] for row in result["results"]] == [2, 2]
    assert [c["messages"][-1]["content"] for c in calls] == ["1", "2", "1", "2"]
    receipt = json.loads((output / "receipt.json").read_text("utf-8"))
    assert receipt == result and receipt["plan"]["samples"][0]["expected"] == 1
    assert "not-a-real-key" not in (output / "receipt.json").read_text("utf-8")
    assert result["rateBasis"] == "local-user-declared-rates-not-an-invoice"
    with pytest.raises(FileExistsError):
        run_trial(plan(), targets(), output, accept_data_transfer=True)


def test_preview_and_rejected_consent_budget_or_missing_keys_make_no_request(tmp_path, monkeypatch):
    assert preflight(plan(), targets())["networkCalls"] == 0
    with pytest.raises(ValueError, match="consent"):
        run_trial(plan(), targets(), tmp_path / "no-consent")
    with pytest.raises(ValueError, match="ceiling"):
        run_trial(
            plan(maximumEstimatedCost=0.00001),
            targets(),
            tmp_path / "too-expensive",
            accept_data_transfer=True,
        )
    monkeypatch.delenv("SYNTHETIC_TEST_KEY", raising=False)
    with pytest.raises(ValueError, match="missing"):
        run_trial(plan(), targets(), tmp_path / "no-key", accept_data_transfer=True)
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize(
    "fault",
    [
        "truncated",
        "wrong-model",
        "missing-usage",
        "cache-usage",
        "http-error",
        "redirect",
        "non-json",
        "extra-output",
        "bad-type",
    ],
)
def test_provider_failures_stop_without_retry_and_leave_honest_receipt(
    tmp_path, monkeypatch, fault
):
    monkeypatch.setenv("SYNTHETIC_TEST_KEY", "not-a-real-key")
    calls = []

    def handler(request):
        calls.append(request.url)
        body = json.loads(request.content)
        response = payload(body)
        if fault == "http-error":
            return httpx.Response(500, text="sensitive arbitrary provider error")
        if fault == "redirect":
            return httpx.Response(307, headers={"location": "https://other.example/leak"})
        if fault == "non-json":
            return httpx.Response(200, text="invalid")
        if fault == "truncated":
            response["stop_reason"] = "max_tokens"
        if fault == "wrong-model":
            response["model"] = "some-other-version"
        if fault == "missing-usage":
            response["usage"] = {}
        if fault == "cache-usage":
            response["usage"]["cache_creation_input_tokens"] = 1
        if fault == "extra-output":
            response["usage"]["output_tokens"] = 99999
        if fault == "bad-type":
            response["content"] = "not a content list"
        return httpx.Response(200, json=response)

    result = run_trial(
        plan(),
        targets(),
        tmp_path / fault,
        accept_data_transfer=True,
        transport=httpx.MockTransport(handler),
    )
    assert result["status"] == "blocked" and len(calls) == 1
    assert result["results"][0]["samples"][0]["status"] == "execution-error"
    assert result["results"][1]["status"] == "blocked"
    assert "sensitive arbitrary provider error" not in json.dumps(result)
    assert result["estimatedCost"] > 0  # Unaccounted requests keep their reservation.


def test_quality_failures_are_measured_failures_and_do_not_abort_the_batch(tmp_path, monkeypatch):
    monkeypatch.setenv("SYNTHETIC_TEST_KEY", "not-a-real-key")

    def handler(request):
        data = payload(json.loads(request.content))
        if "content" in data:
            data["content"][0]["text"] = "0"
        return httpx.Response(200, json=data)

    result = run_trial(
        plan(),
        targets(),
        tmp_path / "quality",
        accept_data_transfer=True,
        transport=httpx.MockTransport(handler),
    )
    assert result["status"] == "complete" and result["requestsSent"] == 4
    assert [r["successfulSamples"] for r in result["results"]] == [0, 2]


def test_exact_grading_and_configuration_guards():
    assert grade('{"a":1,"b":null}', {"b": None, "a": 1}, "json-exact")
    assert not grade("true", 1, "json-exact")
    assert not grade('{"a":1,"extra":2}', {"a": 1}, "json-exact")
    with pytest.raises(ValueError):
        plan(minimumSuccessfulSamples=3)
    with pytest.raises(ValueError):
        plan(candidateIds=["a", "a"])
    with pytest.raises(ValueError):
        preflight(plan(), targets()[:1])
    invalid = targets()[0].model_dump(by_alias=True)
    for url in (
        "http://bad.example/messages",
        "https://user:secret@bad.example/x",
        "https://bad.example/x?key=secret",
        "https://localhost/x",
    ):
        with pytest.raises(ValueError):
            TrialTarget.model_validate({**invalid, "endpoint": url})


def test_transient_windows_save_lock_retries_disk_only(tmp_path, monkeypatch):
    from pathlib import Path

    monkeypatch.setenv("SYNTHETIC_TEST_KEY", "not-a-real-key")
    original = Path.replace
    failures = []

    def replace(path, target):
        if path.name == "receipt.tmp" and not failures:
            failures.append(True)
            raise PermissionError("Synthetic Windows destination sharing lock")
        return original(path, target)

    monkeypatch.setattr(Path, "replace", replace)
    calls = []

    def handler(request):
        calls.append(True)
        return httpx.Response(200, json=payload(json.loads(request.content)))

    result = run_trial(
        plan(),
        targets(),
        tmp_path / "transient-lock",
        accept_data_transfer=True,
        transport=httpx.MockTransport(handler),
    )
    assert result["status"] == "complete" and len(calls) == 4 and len(failures) == 1


def test_interruption_preserves_unstarted_candidates_without_retry(tmp_path, monkeypatch):
    monkeypatch.setenv("SYNTHETIC_TEST_KEY", "not-a-real-key")

    def handler(request):
        raise KeyboardInterrupt()

    with pytest.raises(KeyboardInterrupt):
        run_trial(
            plan(),
            targets(),
            tmp_path / "interrupted",
            accept_data_transfer=True,
            transport=httpx.MockTransport(handler),
        )
    receipt = json.loads((tmp_path / "interrupted/receipt.json").read_text("utf-8"))
    assert receipt["status"] == "interrupted"
    assert len(receipt["results"]) == 2 and receipt["requestsSent"] == 1
    assert receipt["results"][1]["status"] == "not-run"
