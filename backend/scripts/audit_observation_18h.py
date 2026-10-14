"""Pure observation acceptance contract with explicitly synthetic default identities.

No host inventory, historical process IDs, local database path or receipt is
included. This module does not start collection or certify an actual run.
"""

import json
from datetime import UTC, datetime, timedelta

from .reconcile_36h_windows import reconcile

WORKER_ID = "synthetic-observation-contract"
START = datetime(2026, 1, 1, tzinfo=UTC)
OWNED_PROCESSES = {
    1001: (1000, "2026-01-01T00:00:00+00:00"),
    1002: (1001, "2026-01-01T00:00:00+00:00"),
    1003: (1002, "2026-01-01T00:00:00+00:00"),
    1004: (1003, "2026-01-01T00:00:00+00:00"),
}


def utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise ValueError("Evidence timestamps must include UTC offsets.")
    return parsed.astimezone(UTC)


def database_utc(value: str) -> datetime:
    """SQLite strips offsets from this worker's datetime.now(UTC) columns.

    Cross-check the started value against the offset-bearing schedule JSON.
    Do not apply this storage convention to supervisor or process evidence.
    """
    parsed = datetime.fromisoformat(value)
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def assess(
    receipt: dict, runs: list[dict], processes: dict, now: datetime, integrity: list[str]
) -> dict:
    """Assess actual records without filling missing windows or changing them."""
    if utc(receipt["startedAt"]) != START or utc(receipt["stopAfter"]) != START + timedelta(
        hours=16
    ):
        raise ValueError("The original start/deadline changed.")
    if receipt["workerId"] != WORKER_ID or receipt["durationSeconds"] != 57600:
        raise ValueError("Wrong observation identity/duration.")
    if not receipt["scheduledAcceptanceEligible"] or receipt["kind"] != "observation":
        raise ValueError("Shutdown drills cannot pass scheduled acceptance.")
    if receipt["paidExtractionEnabled"] or receipt["emailDeliveryEnabled"]:
        raise ValueError("Unexpected external side-effect configuration.")
    if any(run["worker_id"] != WORKER_ID for run in runs):
        raise ValueError("Mixed workers cannot form one continuous observation.")
    deadline = START + timedelta(hours=16)
    windows = reconcile(START, runs, now)
    scheduled = [run for run in runs if run["trigger"] == "scheduled"]
    outside = [
        run["id"] for run in scheduled if not START <= database_utc(run["started_at"]) < deadline
    ]
    unfinished = [run["id"] for run in scheduled if not run["finished_at"]]
    issues = []
    for run in scheduled:
        try:
            result = json.loads(run["result_json"])
            schedule = result["schedule"]
            if utc(schedule["actualCycleAt"]) != database_utc(run["started_at"]):
                issues.append(
                    {"runId": run["id"], "issue": "SQL start differs from UTC cycle JSON"}
                )
            if schedule["missedIntervalsBeforeCycle"] or schedule["catchUpRunsIssued"]:
                issues.append({"runId": run["id"], "issue": "missed interval or catch-up"})
            email = result["emailDelivery"]
            if email["configured"] or email["attempted"] or email["sent"]:
                issues.append({"runId": run["id"], "issue": "unexpected email execution"})
            if run["error"] or result["ingestion"]["failed"]:
                issues.append({"runId": run["id"], "issue": "actual recorded failure"})
        except (TypeError, ValueError, KeyError):
            issues.append({"runId": run["id"], "issue": "missing or invalid cycle result"})
        if database_utc(run["started_at"]) > now or (
            run["finished_at"] and database_utc(run["finished_at"]) > now
        ):
            issues.append({"runId": run["id"], "issue": "future actual timestamps"})
        if run["finished_at"] and database_utc(run["finished_at"]) < database_utc(
            run["started_at"]
        ):
            issues.append({"runId": run["id"], "issue": "finish precedes start"})
    counts = {}
    for window in windows:
        counts[window["state"]] = counts.get(window["state"], 0) + 1
    identity_checks = processes["checks"]
    inventory_complete = (
        processes.get("callerVisibilityVerified") is True
        and {check["pid"] for check in identity_checks} == set(OWNED_PROCESSES)
        and len(identity_checks) == 4
    )
    inventory_complete = (
        inventory_complete and 0 <= (now - utc(processes["queriedAt"])).total_seconds() <= 30
    )
    original_exited = inventory_complete and all(
        not check["ownedIdentityLive"] for check in identity_checks
    )
    terminal = (
        receipt.get("status") == "stopped-at-deadline" and receipt.get("deadlineReached") is True
    )
    terminal = (
        terminal and receipt.get("terminationRequested") is True and bool(receipt.get("stoppedAt"))
    )
    if terminal:
        terminal = deadline <= utc(receipt["stoppedAt"]) <= now
    checks = {
        "elapsed16Hours": now >= deadline,
        "sqliteIntegrityOk": integrity == ["ok"],
        "all32ActualWindowsSucceeded": counts == {"succeeded": 32},
        "exactly32ScheduledRuns": len(scheduled) == 32,
        "noOutsideWindowRuns": not outside,
        "allScheduledRunsFinished": not unfinished,
        "cycleResultAuditPassed": not issues,
        "freshProcessInventoryComplete": inventory_complete,
        "allOriginalProcessIdentitiesExited": original_exited,
        "supervisorActualDeadlineStopVerified": bool(terminal),
    }
    return {
        "checkedAt": now.isoformat(),
        "status": "verified"
        if all(checks.values())
        else "pending"
        if now < deadline
        else "not-accepted",
        "checks": checks,
        "continuous16h32WindowAcceptance": all(checks.values()),
        "windowStateCounts": counts,
        "windows": windows,
        "outsideWindowRunIds": outside,
        "unfinishedRunIds": unfinished,
        "cycleIssues": issues,
        "manualRunsExcluded": len(runs) - len(scheduled),
        "processInventory": processes,
        "databaseIntegrity": integrity,
        "wholeGoalComplete": False,
        "paidCalls": 0,
        "databaseWrites": False,
        "processMutations": False,
        "failedObservationsCombined": False,
    }
