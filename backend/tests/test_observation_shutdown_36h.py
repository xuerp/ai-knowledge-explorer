import os
import subprocess
import sys
from datetime import UTC, datetime, timedelta

import pytest

from scripts.observe_official_36h import supervise_worker


class Child:
    def __init__(self, *, finished=False, ignore_termination=False):
        self.returncode = 0 if finished else None
        self.ignore_termination = ignore_termination
        self.actions = []

    def poll(self):
        return self.returncode

    def terminate(self):
        self.actions.append("terminate")
        if not self.ignore_termination:
            self.returncode = 1

    def kill(self):
        self.actions.append("kill")
        self.returncode = -9

    def wait(self, timeout):
        self.actions.append(("wait", timeout))
        if self.returncode is None:
            raise subprocess.TimeoutExpired("owned-child", timeout)
        return self.returncode


def test_resume_after_deadline_stops_child_without_extending_observation():
    start = datetime(2026, 10, 7, tzinfo=UTC)
    current = start
    waits = []
    notices = []
    child = Child()

    def simulated_resume(seconds):
        nonlocal current
        waits.append(seconds)
        current = start + timedelta(hours=17)

    result = supervise_worker(
        child,
        start + timedelta(hours=16),
        now=lambda: current,
        sleep=simulated_resume,
        deadline_notice=lambda: notices.append(current),
    )
    assert waits == [0.5]
    assert notices == [current]
    assert child.actions == ["terminate", ("wait", 5)]
    assert result["deadlineReached"] is True
    assert result["status"] == "stopped-at-deadline"


def test_deadline_terminates_blocked_child_then_kills_with_bounded_waits():
    end = datetime(2026, 10, 7, tzinfo=UTC)
    child = Child(ignore_termination=True)
    result = supervise_worker(
        child, end, now=lambda: end, sleep=lambda _: pytest.fail("Cannot wait beyond deadline")
    )
    assert child.actions == ["terminate", ("wait", 5), "kill", ("wait", 2)]
    assert result["killRequired"] is True
    assert result["returnCode"] == -9


def test_early_worker_exit_is_reported_without_restart_or_termination():
    end = datetime(2026, 10, 7, tzinfo=UTC)
    child = Child(finished=True)
    result = supervise_worker(
        child,
        end,
        now=lambda: end - timedelta(seconds=1),
        sleep=lambda _: pytest.fail("Cannot restart finished child"),
    )
    assert result["status"] == "exited-before-deadline"
    assert result["deadlineReached"] is False
    assert result["terminationRequested"] is False
    assert child.actions == []


def test_timezone_is_required_for_observation_deadline():
    with pytest.raises(ValueError, match="timezone"):
        supervise_worker(Child(), datetime(2026, 10, 7, tzinfo=UTC).replace(tzinfo=None))


def test_real_child_blocked_in_sleep_is_stopped_at_wall_deadline():
    child = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(60)"],
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    try:
        start = datetime.now(UTC)
        result = supervise_worker(child, start + timedelta(seconds=0.2))
        assert result["status"] == "stopped-at-deadline"
        assert result["terminationRequested"] is True
        assert child.poll() is not None
        assert (datetime.now(UTC) - start).total_seconds() < 7
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=2)


def test_short_observation_without_drill_is_rejected_before_database_copy(monkeypatch):
    from scripts.observe_official_36h import main

    monkeypatch.setattr(sys, "argv", ["observe", "--duration-seconds", "6"])
    with pytest.raises(SystemExit) as error:
        main()
    assert error.value.code == 2
