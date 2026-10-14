import json
import sqlite3
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app import worker
from app.config import Settings
from app.worker import build_parser, resolve_worker_id


def build_settings() -> Settings:
    return Settings(
        database_url="sqlite://",
        seed_snapshot_path=Path("unused.json"),
        admin_token=None,
        cors_origins=(),
        worker_id="scheduler-staging",
    )


def test_resolve_worker_id_keeps_local_logical_id(monkeypatch) -> None:
    monkeypatch.delenv("AI_RADAR_WORKER_INSTANCE_ID", raising=False)
    monkeypatch.delenv("RENDER_INSTANCE_ID", raising=False)
    monkeypatch.delenv("HOSTNAME", raising=False)

    assert resolve_worker_id(build_settings()) == "scheduler-staging"


def test_resolve_worker_id_adds_render_instance_id(monkeypatch) -> None:
    monkeypatch.delenv("AI_RADAR_WORKER_INSTANCE_ID", raising=False)
    monkeypatch.setenv("RENDER_INSTANCE_ID", "srv-instance-42")
    monkeypatch.setenv("HOSTNAME", "container-fallback")

    assert resolve_worker_id(build_settings()) == "scheduler-staging-srv-instance-42"


def test_resolve_worker_id_uses_explicit_instance_before_platform_values(monkeypatch) -> None:
    monkeypatch.setenv("AI_RADAR_WORKER_INSTANCE_ID", "worker-blue")
    monkeypatch.setenv("RENDER_INSTANCE_ID", "srv-instance-42")
    monkeypatch.setenv("HOSTNAME", "container-fallback")

    assert resolve_worker_id(build_settings()) == "scheduler-staging-worker-blue"


def test_resolve_worker_id_uses_container_hostname_as_fallback(monkeypatch) -> None:
    monkeypatch.delenv("AI_RADAR_WORKER_INSTANCE_ID", raising=False)
    monkeypatch.delenv("RENDER_INSTANCE_ID", raising=False)
    monkeypatch.setenv("HOSTNAME", "container-7f3a")

    assert resolve_worker_id(build_settings()) == "scheduler-staging-container-7f3a"


def test_worker_parser_supports_external_scheduled_cycle() -> None:
    args = build_parser().parse_args(["--scheduled-once", "--next-cycle-seconds", "1800"])

    assert args.scheduled_once is True
    assert args.once is False
    assert args.next_cycle_seconds == 1800


def test_worker_modes_remain_mutually_exclusive() -> None:
    with pytest.raises(SystemExit):
        build_parser().parse_args(["--once", "--scheduled-once"])


@pytest.mark.parametrize(
    ("started_minutes", "finished_minutes", "next_minutes"),
    [(0, 4, 30), (30, 34, 60), (0, 30, 30), (30, 30, 60), (550, 551, 570), (0, 70, 90)],
)
def test_interval_cadence_excludes_work_duration_and_skips_elapsed_slots(
    started_minutes, finished_minutes, next_minutes
) -> None:
    anchor = datetime(2026, 10, 8, tzinfo=UTC)
    assert worker.next_interval_cycle(
        anchor,
        anchor + timedelta(minutes=started_minutes),
        anchor + timedelta(minutes=finished_minutes),
        1800,
    ) == anchor + timedelta(minutes=next_minutes)


def test_interval_worker_resume_persists_real_cycles_without_catch_up(
    monkeypatch, tmp_path
) -> None:
    anchor = datetime(2026, 10, 8, tzinfo=UTC)

    class Clock(datetime):
        current = anchor

        @classmethod
        def now(cls, tz=None):
            return cls.current

    db = tmp_path / "worker.db"
    settings = replace(build_settings(), database_url=f"sqlite:///{db.as_posix()}")
    monkeypatch.setattr(worker.Settings, "from_env", lambda: settings)
    monkeypatch.setattr(worker, "datetime", Clock)
    monkeypatch.setattr(worker, "resolve_worker_id", lambda _settings: "cadence-test")
    monkeypatch.setattr(worker.signal, "signal", lambda *_args: None)
    monkeypatch.setattr(worker.sys, "argv", ["worker", "--interval-seconds", "1800"])
    cycles = []
    waits = []

    def fake_cycle(*_args, **kwargs):
        cycles.append(kwargs["now"])
        Clock.current += timedelta(minutes=4 if len(cycles) == 1 else 1)
        return {
            "ingestion": {"due": 0, "succeeded": 0, "unchanged": 0, "failed": 0},
            "digests": {"recipients": 0, "messagesQueued": 0},
            "emailDelivery": {"attempted": 0, "sent": 0, "failed": 0},
        }

    def fake_wait(*_args, **kwargs):
        waits.append(kwargs["next_cycle_at"])
        if len(waits) == 1:
            Clock.current = anchor + timedelta(minutes=550)
        else:
            raise KeyboardInterrupt

    monkeypatch.setattr(worker, "run_cycle", fake_cycle)
    monkeypatch.setattr(worker, "wait_with_heartbeats", fake_wait)
    worker.main()
    assert waits == [anchor + timedelta(minutes=30), anchor + timedelta(minutes=570)]
    with sqlite3.connect(db) as connection:
        rows = connection.execute(
            "select trigger,status,result_json from automation_runs order by started_at"
        ).fetchall()
    assert len(rows) == len(cycles) == 2
    assert all(row[:2] == ("scheduled", "succeeded") for row in rows)
    resumed = json.loads(rows[1][2])["schedule"]
    assert resumed["expectedCycleAt"] == (anchor + timedelta(minutes=30)).isoformat()
    assert resumed["actualCycleAt"] == (anchor + timedelta(minutes=550)).isoformat()
    assert resumed["latenessSeconds"] == 520 * 60
    assert resumed["missedIntervalsBeforeCycle"] == 17
    assert resumed["catchUpRunsIssued"] == 0


def test_heartbeat_wait_returns_after_wall_time_resume(monkeypatch) -> None:
    from contextlib import nullcontext

    anchor = datetime(2026, 10, 8, tzinfo=UTC)

    class Clock(datetime):
        current = anchor

        @classmethod
        def now(cls, tz=None):
            return cls.current

    class FakeDatabase:
        def session(self):
            return nullcontext(None)

    class FakeOperations:
        heartbeats = 0

        def heartbeat(self, *_args, **_kwargs):
            self.heartbeats += 1

    sleeps = []

    def resumed_sleep(seconds):
        sleeps.append(seconds)
        Clock.current = anchor + timedelta(hours=9)

    operations = FakeOperations()
    monkeypatch.setattr(worker, "datetime", Clock)
    monkeypatch.setattr(worker.time, "sleep", resumed_sleep)
    worker.wait_with_heartbeats(
        FakeDatabase(),
        operations,
        "cadence-test",
        heartbeat_seconds=30,
        next_cycle_at=anchor + timedelta(minutes=30),
        state="idle",
    )
    assert sleeps == [30]
    assert operations.heartbeats == 1
