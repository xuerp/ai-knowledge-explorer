from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.automation import AutomationCycleBusyError, automation_cycle_lock
from app.database import Database
from app.operations import OperationsService


def test_worker_heartbeat_cycle_history_and_stale_detection(tmp_path: Path):
    database = Database(f"sqlite:///{(tmp_path / 'operations.db').as_posix()}")
    database.create_all()
    service = OperationsService(stale_after_seconds=120)
    started = datetime(2026, 8, 9, 1, 0, tzinfo=UTC)

    with database.session() as session:
        service.register_worker(session, "scheduler", now=started)
        run_id = service.start_cycle(
            session,
            "scheduler",
            "scheduled",
            now=started + timedelta(seconds=1),
        )
        status = service.complete_cycle(
            session,
            "scheduler",
            run_id,
            {
                "ingestion": {"due": 2, "succeeded": 1, "unchanged": 0, "failed": 1},
                "digests": {"recipients": 0, "messagesQueued": 0},
                "emailDelivery": {
                    "configured": False,
                    "attempted": 0,
                    "sent": 0,
                    "failed": 0,
                },
            },
            now=started + timedelta(seconds=3),
            next_cycle_at=started + timedelta(minutes=15),
        )
        assert status == "partial"

        healthy = service.diagnostics(
            session,
            "scheduler",
            now=started + timedelta(seconds=30),
        )
        assert healthy.heartbeat_status == "healthy"
        assert healthy.worker is not None
        assert healthy.worker.last_cycle_status == "partial"
        assert healthy.worker.consecutive_failures == 1
        assert "failed items" in (healthy.worker.last_error or "")
        assert healthy.worker.next_cycle_at is not None
        assert healthy.worker.next_cycle_at.replace(tzinfo=UTC) == started + timedelta(minutes=15)
        assert healthy.recent_runs[0].duration_ms == 2000
        assert healthy.recent_runs[0].result is not None
        ingestion = healthy.recent_runs[0].result["ingestion"]
        assert isinstance(ingestion, dict)
        assert ingestion["failed"] == 1

        stale = service.diagnostics(
            session,
            "scheduler",
            now=started + timedelta(seconds=124),
        )
        assert stale.heartbeat_status == "stale"
        assert (
            service.is_worker_healthy(
                session,
                "scheduler",
                now=started + timedelta(seconds=124),
            )
            is False
        )

    database.dispose()


def test_worker_restart_marks_interrupted_cycle_failed(tmp_path: Path):
    database = Database(f"sqlite:///{(tmp_path / 'restart.db').as_posix()}")
    database.create_all()
    service = OperationsService()
    started = datetime(2026, 8, 9, 2, 0, tzinfo=UTC)

    with database.session() as session:
        service.register_worker(session, "scheduler", now=started)
        run_id = service.start_cycle(
            session,
            "scheduler",
            "scheduled",
            now=started + timedelta(seconds=1),
        )
        with pytest.raises(RuntimeError, match="fresh heartbeat"):
            service.register_worker(session, "scheduler", now=started + timedelta(minutes=1))
        service.register_worker(session, "scheduler", now=started + timedelta(minutes=4))
        diagnostics = service.diagnostics(
            session,
            "scheduler",
            now=started + timedelta(minutes=4),
        )
        assert diagnostics.recent_runs[0].id == run_id
        assert diagnostics.recent_runs[0].status == "failed"
        assert "restarted" in (diagnostics.recent_runs[0].error or "")
        assert diagnostics.worker is not None
        assert diagnostics.worker.consecutive_failures == 1

    database.dispose()


def test_ephemeral_cycle_has_an_independent_active_lease(tmp_path: Path):
    database = Database(f"sqlite:///{(tmp_path / 'ephemeral.db').as_posix()}")
    database.create_all()
    service = OperationsService(stale_after_seconds=3900)
    started = datetime(2026, 8, 11, 1, 0, tzinfo=UTC)

    with database.session() as session:
        first_run = service.start_ephemeral_cycle(
            session,
            "scheduler",
            "scheduled",
            now=started,
            active_after_seconds=900,
        )
        with pytest.raises(RuntimeError, match="active cycle"):
            service.start_ephemeral_cycle(
                session,
                "scheduler",
                "scheduled",
                now=started + timedelta(minutes=10),
                active_after_seconds=900,
            )

        second_run = service.start_ephemeral_cycle(
            session,
            "scheduler",
            "scheduled",
            now=started + timedelta(minutes=16),
            active_after_seconds=900,
        )
        diagnostics = service.diagnostics(
            session,
            "scheduler",
            now=started + timedelta(minutes=16),
        )
        assert diagnostics.recent_runs[0].id == second_run
        assert diagnostics.recent_runs[0].status == "running"
        interrupted = next(run for run in diagnostics.recent_runs if run.id == first_run)
        assert interrupted.status == "failed"
        assert "without completing" in (interrupted.error or "")

    database.dispose()


def test_automation_cycle_lock_rejects_concurrent_local_cycle(tmp_path: Path):
    database = Database(f"sqlite:///{(tmp_path / 'cycle-lock.db').as_posix()}")
    with (
        automation_cycle_lock(database.engine),
        pytest.raises(AutomationCycleBusyError, match="already running"),
        automation_cycle_lock(database.engine),
    ):
        pytest.fail("并发周期不应获得锁")
    database.dispose()
