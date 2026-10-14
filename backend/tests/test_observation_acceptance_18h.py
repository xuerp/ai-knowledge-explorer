"""Synthetic boundary tests only; never evidence of real observation success."""

import json
from datetime import timedelta

import pytest

from scripts.audit_observation_18h import OWNED_PROCESSES, START, WORKER_ID, assess


def evidence():
    deadline = START + timedelta(hours=16)
    now = deadline + timedelta(seconds=5)
    receipt = {
        "startedAt": START.isoformat(),
        "stopAfter": deadline.isoformat(),
        "workerId": WORKER_ID,
        "durationSeconds": 57600,
        "scheduledAcceptanceEligible": True,
        "kind": "observation",
        "paidExtractionEnabled": False,
        "emailDeliveryEnabled": False,
        "status": "stopped-at-deadline",
        "deadlineReached": True,
        "terminationRequested": True,
        "stoppedAt": (deadline + timedelta(seconds=1)).isoformat(),
    }
    runs = []
    for i in range(32):
        started = START + timedelta(minutes=30 * i, seconds=1)
        runs.append(
            {
                "id": str(i),
                "worker_id": WORKER_ID,
                "trigger": "scheduled",
                "status": "succeeded",
                "started_at": started.isoformat(),
                "finished_at": (started + timedelta(seconds=2)).isoformat(),
                "error": None,
                "result_json": json.dumps(
                    {
                        "ingestion": {"failed": 0},
                        "emailDelivery": {"configured": False, "attempted": 0, "sent": 0},
                        "schedule": {
                            "missedIntervalsBeforeCycle": 0,
                            "catchUpRunsIssued": 0,
                            "actualCycleAt": started.isoformat(),
                        },
                    }
                ),
            }
        )
    processes = {
        "callerVisibilityVerified": True,
        "queriedAt": now.isoformat(),
        "checks": [{"pid": pid, "ownedIdentityLive": False} for pid in OWNED_PROCESSES],
    }
    return receipt, runs, processes, now


def test_complete_synthetic_evidence_and_manual_runs_excluded():
    receipt, runs, processes, now = evidence()
    runs.append({**runs[0], "id": "manual", "trigger": "manual"})
    result = assess(receipt, runs, processes, now, ["ok"])
    assert result["continuous16h32WindowAcceptance"] is True
    assert result["manualRunsExcluded"] == 1
    assert result["wholeGoalComplete"] is False


@pytest.mark.parametrize(
    "problem",
    [
        "missed",
        "duplicate",
        "unfinished",
        "actual-failure",
        "catchup",
        "email",
        "still-live",
        "visibility-unknown",
        "stale-inventory",
        "receipt-still-running",
        "integrity-failure",
        "outside-window",
        "future-finished",
        "missing-cycle-result",
        "utc-start-mismatch",
        "finish-before-start",
    ],
)
def test_incomplete_or_faulted_evidence_cannot_pass(problem):
    receipt, runs, processes, now = evidence()
    integrity = ["ok"]
    if problem == "missed":
        runs.pop()
    elif problem == "duplicate":
        runs.append({**runs[0], "id": "duplicate"})
    elif problem == "unfinished":
        runs[0]["finished_at"] = None
    elif problem == "actual-failure":
        runs[0]["status"] = "failed"
        runs[0]["error"] = "actual failure"
    elif problem in {"catchup", "email"}:
        result = json.loads(runs[0]["result_json"])
        if problem == "catchup":
            result["schedule"]["catchUpRunsIssued"] = 1
        else:
            result["emailDelivery"]["attempted"] = 1
        runs[0]["result_json"] = json.dumps(result)
    elif problem == "still-live":
        processes["checks"][0]["ownedIdentityLive"] = True
    elif problem == "visibility-unknown":
        processes["callerVisibilityVerified"] = False
    elif problem == "stale-inventory":
        processes["queriedAt"] = (now - timedelta(seconds=31)).isoformat()
    elif problem == "receipt-still-running":
        receipt["status"] = "running"
    elif problem == "integrity-failure":
        integrity = ["corrupt"]
    elif problem == "outside-window":
        runs.append(
            {
                **runs[-1],
                "id": "extra",
                "started_at": (now - timedelta(seconds=1)).isoformat(),
                "finished_at": now.isoformat(),
            }
        )
    elif problem == "future-finished":
        runs[-1]["finished_at"] = (now + timedelta(seconds=1)).isoformat()
    elif problem == "missing-cycle-result":
        runs[-1]["result_json"] = "{}"
    elif problem == "utc-start-mismatch":
        result = json.loads(runs[0]["result_json"])
        result["schedule"]["actualCycleAt"] = (START + timedelta(hours=8)).isoformat()
        runs[0]["result_json"] = json.dumps(result)
    elif problem == "finish-before-start":
        runs[0]["finished_at"] = START.isoformat()
    result = assess(receipt, runs, processes, now, integrity)
    assert result["continuous16h32WindowAcceptance"] is False
    assert result["status"] == "not-accepted"


def test_early_check_is_pending_and_never_accepts_future_runs():
    receipt, runs, processes, now = evidence()
    now -= timedelta(hours=1)
    processes["queriedAt"] = now.isoformat()
    result = assess(receipt, runs, processes, now, ["ok"])
    assert result["status"] == "pending"
    assert result["continuous16h32WindowAcceptance"] is False
    assert result["cycleIssues"]


def test_sqlite_naive_utc_storage_is_verified_against_offset_bearing_cycle_json():
    receipt, runs, processes, now = evidence()
    for run in runs:
        run["started_at"] = run["started_at"].removesuffix("+00:00")
        run["finished_at"] = run["finished_at"].removesuffix("+00:00")
    assert assess(receipt, runs, processes, now, ["ok"])["continuous16h32WindowAcceptance"] is True


@pytest.mark.parametrize(
    "problem",
    ["different-worker", "mixed-workers", "extended-deadline", "drill", "paid", "naive-receipt"],
)
def test_wrong_identity_or_scope_is_rejected(problem):
    receipt, runs, processes, now = evidence()
    if problem == "different-worker":
        receipt["workerId"] = "replacement-worker"
    elif problem == "mixed-workers":
        runs[0]["worker_id"] = "earlier-failed-worker"
    elif problem == "extended-deadline":
        receipt["stopAfter"] = now.isoformat()
    elif problem == "drill":
        receipt["scheduledAcceptanceEligible"] = False
    elif problem == "paid":
        receipt["paidExtractionEnabled"] = True
    elif problem == "naive-receipt":
        receipt["startedAt"] = receipt["startedAt"].removesuffix("+00:00")
    with pytest.raises(ValueError):
        assess(receipt, runs, processes, now, ["ok"])
