import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.automation import AutomationCycleBusyError, automation_cycle_lock
from app.database import (
    AuditLogRecord,
    AutomationRunRecord,
    Database,
    DocumentSnapshotRecord,
    SourceRecord,
)
from app.extraction import EXTRACTION_PIPELINE_VERSION
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


def test_diagnostics_ignores_malformed_historical_run_result(tmp_path: Path):
    database = Database(f"sqlite:///{(tmp_path / 'malformed-run.db').as_posix()}")
    database.create_all()
    service = OperationsService()
    started = datetime(2026, 8, 14, 2, 0, tzinfo=UTC)

    with database.session() as session:
        session.add(
            AutomationRunRecord(
                id="malformed-run",
                worker_id="scheduler",
                trigger="scheduled",
                status="failed",
                started_at=started,
                finished_at=started + timedelta(seconds=1),
                result_json="{not-json",
                error="Historical result payload was damaged.",
            )
        )
        session.commit()

        diagnostics = service.diagnostics(session, "scheduler", now=started + timedelta(seconds=2))

        assert diagnostics.recent_runs[0].id == "malformed-run"
        assert diagnostics.recent_runs[0].status == "failed"
        assert diagnostics.recent_runs[0].result is None
        assert diagnostics.recent_runs[0].error == "Historical result payload was damaged."

    database.dispose()


def test_operations_reports_ready_and_cooling_extraction_backlog(tmp_path: Path):
    database = Database(f"sqlite:///{(tmp_path / 'extraction-backlog.db').as_posix()}")
    database.create_all()
    service = OperationsService(extraction_retry_minutes=60)
    current = datetime(2026, 8, 13, 4, 0, tzinfo=UTC)

    with database.session() as session:
        for source_id in ("ready", "cooling", "extracted"):
            session.add(
                SourceRecord(
                    id=f"source-{source_id}",
                    url=f"https://example.com/{source_id}",
                    title=source_id,
                    publisher="Example",
                    active=True,
                    fetch_enabled=source_id != "ready",
                    fetch_interval_minutes=240,
                    consecutive_failures=0,
                    created_at=current - timedelta(days=1),
                )
            )
            session.add(
                DocumentSnapshotRecord(
                    id=f"snapshot-{source_id}",
                    source_id=f"source-{source_id}",
                    content_hash=source_id * 8,
                    content_text=f"{source_id} content",
                    observed_at=current - timedelta(minutes=5),
                )
            )
        session.add_all(
            [
                AuditLogRecord(
                    actor="automation@ai-radar.local",
                    action="extraction.failed",
                    target_type="document_snapshot",
                    target_id="snapshot-cooling",
                    detail_json=json.dumps({"pipelineVersion": EXTRACTION_PIPELINE_VERSION}),
                    created_at=current - timedelta(minutes=30),
                ),
                AuditLogRecord(
                    actor="automation@ai-radar.local",
                    action="extraction.failed",
                    target_type="document_snapshot",
                    target_id="snapshot-ready",
                    detail_json=json.dumps({"pipelineVersion": "retired-pipeline"}),
                    created_at=current - timedelta(minutes=10),
                ),
                AuditLogRecord(
                    actor="automation@ai-radar.local",
                    action="extraction.run",
                    target_type="document_snapshot",
                    target_id="snapshot-extracted",
                    detail_json=json.dumps({"pipelineVersion": EXTRACTION_PIPELINE_VERSION}),
                    created_at=current - timedelta(minutes=1),
                ),
            ]
        )
        session.commit()

        diagnostics = service.diagnostics(session, "scheduler", now=current)
        assert diagnostics.queues.extraction_ready == 1
        assert diagnostics.queues.extraction_retrying == 1

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


def test_diagnostics_resolves_latest_runtime_instance_for_logical_worker(tmp_path: Path):
    database = Database(f"sqlite:///{(tmp_path / 'runtime-instance.db').as_posix()}")
    database.create_all()
    service = OperationsService(stale_after_seconds=120)
    started = datetime(2026, 8, 9, 2, 0, tzinfo=UTC)

    with database.session() as session:
        service.register_worker(session, "scheduler", now=started)
        service.heartbeat(
            session,
            "scheduler",
            state="stopped",
            now=started + timedelta(seconds=5),
        )
        service.register_worker(
            session,
            "scheduler-render-instance-a",
            now=started + timedelta(seconds=10),
        )
        service.heartbeat(
            session,
            "scheduler-render-instance-a",
            state="idle",
            now=started + timedelta(seconds=20),
        )

        diagnostics = service.diagnostics(
            session,
            "scheduler",
            now=started + timedelta(seconds=30),
        )

        assert diagnostics.heartbeat_status == "healthy"
        assert diagnostics.worker is not None
        assert diagnostics.worker.worker_id == "scheduler-render-instance-a"
        assert service.is_worker_healthy(
            session,
            "scheduler",
            now=started + timedelta(seconds=30),
        )

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
