from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

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
