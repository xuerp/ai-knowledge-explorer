from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .database import (
    AuditLogRecord,
    AutomationRunRecord,
    DocumentSnapshotRecord,
    EmailOutboxRecord,
    SourceRecord,
    WorkerStatusRecord,
)
from .extraction import extraction_audit_is_current
from .schemas import (
    AutomationRunView,
    OperationsDiagnostics,
    OperationsQueueSummary,
    WorkerStatusView,
)


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class OperationsService:
    def __init__(
        self,
        stale_after_seconds: int = 180,
        extraction_retry_minutes: int = 360,
    ):
        self.stale_after_seconds = max(30, stale_after_seconds)
        self.extraction_retry_minutes = max(1, extraction_retry_minutes)

    def register_worker(
        self,
        session: Session,
        worker_id: str,
        *,
        now: datetime | None = None,
    ) -> WorkerStatusRecord:
        current = now or datetime.now(UTC)
        worker = session.get(WorkerStatusRecord, worker_id)
        if (
            worker is not None
            and worker.state != "stopped"
            and (_utc(current) - _utc(worker.heartbeat_at)).total_seconds()
            <= self.stale_after_seconds
        ):
            raise RuntimeError(f"Worker {worker_id} already has a fresh heartbeat.")
        interrupted = session.scalars(
            select(AutomationRunRecord).where(
                AutomationRunRecord.worker_id == worker_id,
                AutomationRunRecord.status == "running",
            )
        ).all()
        for run in interrupted:
            run.status = "failed"
            run.finished_at = current
            run.error = "Worker restarted before the cycle completed."

        if worker is None:
            worker = WorkerStatusRecord(
                worker_id=worker_id,
                state="starting",
                started_at=current,
                heartbeat_at=current,
            )
            session.add(worker)
        else:
            worker.state = "starting"
            worker.started_at = current
            worker.heartbeat_at = current
            worker.next_cycle_at = current
            if interrupted:
                latest = max(interrupted, key=lambda row: row.started_at)
                worker.last_cycle_id = latest.id
                worker.last_cycle_finished_at = current
                worker.last_cycle_status = "failed"
                worker.consecutive_failures += 1
                worker.last_error = latest.error
        session.commit()
        return worker

    def start_cycle(
        self,
        session: Session,
        worker_id: str,
        trigger: str,
        *,
        now: datetime | None = None,
    ) -> str:
        current = now or datetime.now(UTC)
        run = AutomationRunRecord(
            id=str(uuid4()),
            worker_id=worker_id,
            trigger=trigger,
            status="running",
            started_at=current,
        )
        session.add(run)
        worker = self._worker(session, worker_id, current)
        worker.state = "running"
        worker.heartbeat_at = current
        worker.next_cycle_at = None
        worker.last_cycle_id = run.id
        worker.last_cycle_started_at = current
        worker.last_cycle_finished_at = None
        worker.last_cycle_status = "running"
        session.commit()
        return run.id

    def start_ephemeral_cycle(
        self,
        session: Session,
        worker_id: str,
        trigger: str,
        *,
        now: datetime | None = None,
        active_after_seconds: int | None = None,
    ) -> str:
        current = now or datetime.now(UTC)
        active_window = active_after_seconds or self.stale_after_seconds
        worker = session.get(WorkerStatusRecord, worker_id)
        if (
            worker is not None
            and worker.state in {"starting", "running"}
            and (_utc(current) - _utc(worker.heartbeat_at)).total_seconds() <= active_window
        ):
            raise RuntimeError(f"Worker {worker_id} already has an active cycle.")

        interrupted = session.scalars(
            select(AutomationRunRecord).where(
                AutomationRunRecord.worker_id == worker_id,
                AutomationRunRecord.status == "running",
            )
        ).all()
        for previous in interrupted:
            previous.status = "failed"
            previous.finished_at = current
            previous.error = "The previous ephemeral cycle ended without completing."

        run = AutomationRunRecord(
            id=str(uuid4()),
            worker_id=worker_id,
            trigger=trigger,
            status="running",
            started_at=current,
        )
        session.add(run)
        worker = self._worker(session, worker_id, current)
        worker.state = "running"
        worker.started_at = current
        worker.heartbeat_at = current
        worker.next_cycle_at = None
        worker.last_cycle_id = run.id
        worker.last_cycle_started_at = current
        worker.last_cycle_finished_at = None
        worker.last_cycle_status = "running"
        if interrupted:
            worker.consecutive_failures += len(interrupted)
            worker.last_error = interrupted[-1].error
        session.commit()
        return run.id

    def complete_cycle(
        self,
        session: Session,
        worker_id: str,
        run_id: str,
        result: dict[str, object],
        *,
        now: datetime | None = None,
        next_cycle_at: datetime | None = None,
    ) -> str:
        current = now or datetime.now(UTC)
        status = self._result_status(result)
        run = session.get(AutomationRunRecord, run_id)
        if run is None:
            raise RuntimeError(f"Automation run {run_id} does not exist.")
        run.status = status
        run.finished_at = current
        run.result_json = json.dumps(result, ensure_ascii=False)
        run.error = self._result_error(result)
        if status == "partial" and run.error is None:
            run.error = "One or more automatic tasks reported failed items."

        worker = self._worker(session, worker_id, current)
        worker.state = "idle"
        worker.heartbeat_at = current
        worker.next_cycle_at = next_cycle_at
        worker.last_cycle_id = run.id
        worker.last_cycle_started_at = run.started_at
        worker.last_cycle_finished_at = current
        worker.last_cycle_status = status
        worker.consecutive_failures = (
            0 if status == "succeeded" else worker.consecutive_failures + 1
        )
        worker.last_error = run.error
        session.commit()
        return status

    def fail_cycle(
        self,
        session: Session,
        worker_id: str,
        run_id: str,
        error: BaseException,
        *,
        now: datetime | None = None,
        next_cycle_at: datetime | None = None,
    ) -> None:
        current = now or datetime.now(UTC)
        message = str(error)[:2000] or error.__class__.__name__
        run = session.get(AutomationRunRecord, run_id)
        if run is not None:
            run.status = "failed"
            run.finished_at = current
            run.error = message
        worker = self._worker(session, worker_id, current)
        worker.state = "failed"
        worker.heartbeat_at = current
        worker.next_cycle_at = next_cycle_at
        worker.last_cycle_id = run_id
        worker.last_cycle_finished_at = current
        worker.last_cycle_status = "failed"
        worker.consecutive_failures += 1
        worker.last_error = message
        session.commit()

    def heartbeat(
        self,
        session: Session,
        worker_id: str,
        *,
        state: str,
        now: datetime | None = None,
        next_cycle_at: datetime | None = None,
    ) -> None:
        current = now or datetime.now(UTC)
        worker = self._worker(session, worker_id, current)
        worker.state = state
        worker.heartbeat_at = current
        worker.next_cycle_at = next_cycle_at
        session.commit()

    def diagnostics(
        self,
        session: Session,
        worker_id: str,
        *,
        now: datetime | None = None,
        run_limit: int = 20,
    ) -> OperationsDiagnostics:
        current = now or datetime.now(UTC)
        worker = self._observed_worker(session, worker_id)
        worker_view = self._worker_view(worker, current) if worker else None
        if worker_view is None:
            heartbeat_status = "missing"
        elif (
            worker_view.heartbeat_age_seconds > self.stale_after_seconds
            or worker_view.state == "stopped"
        ):
            heartbeat_status = "stale"
        else:
            heartbeat_status = "healthy"

        runs = session.scalars(
            select(AutomationRunRecord)
            .order_by(AutomationRunRecord.started_at.desc())
            .limit(run_limit)
        ).all()
        automatic_sources = self._count(
            session,
            select(func.count())
            .select_from(SourceRecord)
            .where(
                SourceRecord.active.is_(True),
                SourceRecord.fetch_enabled.is_(True),
            ),
        )
        sources_due = self._count(
            session,
            select(func.count())
            .select_from(SourceRecord)
            .where(
                SourceRecord.active.is_(True),
                SourceRecord.fetch_enabled.is_(True),
                or_(SourceRecord.next_fetch_at.is_(None), SourceRecord.next_fetch_at <= current),
            ),
        )
        sources_retrying = self._count(
            session,
            select(func.count())
            .select_from(SourceRecord)
            .where(
                SourceRecord.active.is_(True),
                SourceRecord.fetch_enabled.is_(True),
                SourceRecord.consecutive_failures > 0,
            ),
        )
        extraction_ready, extraction_retrying = self._extraction_counts(session, current)
        return OperationsDiagnostics(
            generated_at=current,
            heartbeat_status=heartbeat_status,
            stale_after_seconds=self.stale_after_seconds,
            worker=worker_view,
            recent_runs=[self._run_view(row) for row in runs],
            queues=OperationsQueueSummary(
                automatic_sources=automatic_sources,
                sources_due=sources_due,
                sources_retrying=sources_retrying,
                extraction_ready=extraction_ready,
                extraction_retrying=extraction_retrying,
                email_queued=self._email_count(session, "queued"),
                email_retrying=self._email_count(session, "retrying"),
                email_sending=self._email_count(session, "sending"),
                email_failed=self._email_count(session, "failed"),
            ),
        )

    def is_worker_healthy(
        self,
        session: Session,
        worker_id: str,
        *,
        now: datetime | None = None,
    ) -> bool:
        current = now or datetime.now(UTC)
        worker = self._observed_worker(session, worker_id)
        if worker is None or worker.state == "stopped":
            return False
        heartbeat_age = (_utc(current) - _utc(worker.heartbeat_at)).total_seconds()
        return 0 <= heartbeat_age <= self.stale_after_seconds

    @staticmethod
    def _observed_worker(
        session: Session,
        worker_id: str,
    ) -> WorkerStatusRecord | None:
        """返回逻辑 worker 名称下最近活跃的运行实例。"""
        return session.scalars(
            select(WorkerStatusRecord)
            .where(
                or_(
                    WorkerStatusRecord.worker_id == worker_id,
                    WorkerStatusRecord.worker_id.startswith(f"{worker_id}-"),
                )
            )
            .order_by(WorkerStatusRecord.heartbeat_at.desc())
            .limit(1)
        ).first()

    @staticmethod
    def _count(session: Session, statement: object) -> int:
        return int(session.scalar(statement) or 0)  # type: ignore[arg-type]

    def _email_count(self, session: Session, status: str) -> int:
        return self._count(
            session,
            select(func.count())
            .select_from(EmailOutboxRecord)
            .where(EmailOutboxRecord.status == status),
        )

    def _extraction_counts(
        self,
        session: Session,
        current: datetime,
    ) -> tuple[int, int]:
        snapshots = session.scalars(
            select(DocumentSnapshotRecord)
            .join(SourceRecord, SourceRecord.id == DocumentSnapshotRecord.source_id)
            .where(
                SourceRecord.active.is_(True),
            )
            .order_by(
                DocumentSnapshotRecord.observed_at.desc(),
                DocumentSnapshotRecord.id.desc(),
            )
        ).all()
        seen_sources: set[str] = set()
        latest_snapshot_ids: list[str] = []
        for snapshot in snapshots:
            if snapshot.source_id in seen_sources:
                continue
            seen_sources.add(snapshot.source_id)
            latest_snapshot_ids.append(snapshot.id)
        if not latest_snapshot_ids:
            return 0, 0

        extraction_runs = session.scalars(
            select(AuditLogRecord).where(
                AuditLogRecord.action == "extraction.run",
                AuditLogRecord.target_type == "document_snapshot",
                AuditLogRecord.target_id.in_(latest_snapshot_ids),
            )
        ).all()
        extracted_snapshot_ids = {
            row.target_id for row in extraction_runs if extraction_audit_is_current(row.detail_json)
        }
        retry_after = current - timedelta(minutes=self.extraction_retry_minutes)
        recent_failures = session.scalars(
            select(AuditLogRecord).where(
                AuditLogRecord.action == "extraction.failed",
                AuditLogRecord.target_type == "document_snapshot",
                AuditLogRecord.target_id.in_(latest_snapshot_ids),
                AuditLogRecord.created_at >= retry_after,
            )
        ).all()
        cooling_down_snapshot_ids = {
            row.target_id for row in recent_failures if extraction_audit_is_current(row.detail_json)
        }
        ready = 0
        retrying = 0
        for snapshot_id in latest_snapshot_ids:
            if snapshot_id in extracted_snapshot_ids:
                continue
            if snapshot_id in cooling_down_snapshot_ids:
                retrying += 1
            else:
                ready += 1
        return ready, retrying

    @staticmethod
    def _worker(
        session: Session,
        worker_id: str,
        current: datetime,
    ) -> WorkerStatusRecord:
        worker = session.get(WorkerStatusRecord, worker_id)
        if worker is None:
            worker = WorkerStatusRecord(
                worker_id=worker_id,
                state="starting",
                started_at=current,
                heartbeat_at=current,
            )
            session.add(worker)
        return worker

    @staticmethod
    def _result_status(result: dict[str, object]) -> str:
        ingestion = result.get("ingestion")
        delivery = result.get("emailDelivery")
        if result.get("errors"):
            return "partial"
        if isinstance(ingestion, dict) and int(ingestion.get("failed", 0)) > 0:
            return "partial"
        if isinstance(delivery, dict) and int(delivery.get("failed", 0)) > 0:
            return "partial"
        return "succeeded"

    @staticmethod
    def _result_error(result: dict[str, object]) -> str | None:
        errors = result.get("errors")
        if isinstance(errors, dict) and errors:
            return "; ".join(f"{key}: {value}" for key, value in errors.items())[:2000]
        delivery = result.get("emailDelivery")
        if isinstance(delivery, dict) and delivery.get("error"):
            return str(delivery["error"])[:2000]
        return None

    @staticmethod
    def _worker_view(row: WorkerStatusRecord, current: datetime) -> WorkerStatusView:
        age = max(0, int((_utc(current) - _utc(row.heartbeat_at)).total_seconds()))
        return WorkerStatusView(
            worker_id=row.worker_id,
            state=row.state,
            started_at=row.started_at,
            heartbeat_at=row.heartbeat_at,
            heartbeat_age_seconds=age,
            next_cycle_at=row.next_cycle_at,
            last_cycle_id=row.last_cycle_id,
            last_cycle_started_at=row.last_cycle_started_at,
            last_cycle_finished_at=row.last_cycle_finished_at,
            last_cycle_status=row.last_cycle_status,
            consecutive_failures=row.consecutive_failures,
            last_error=row.last_error,
        )

    @staticmethod
    def _run_view(row: AutomationRunRecord) -> AutomationRunView:
        duration_ms = None
        if row.finished_at:
            duration_ms = max(
                0,
                int((_utc(row.finished_at) - _utc(row.started_at)).total_seconds() * 1000),
            )
        result: dict[str, object] | None = None
        if row.result_json:
            try:
                decoded = json.loads(row.result_json)
            except (json.JSONDecodeError, TypeError):
                decoded = None
            if isinstance(decoded, dict):
                result = decoded
        return AutomationRunView(
            id=row.id,
            worker_id=row.worker_id,
            trigger=row.trigger,
            status=row.status,
            started_at=row.started_at,
            finished_at=row.finished_at,
            duration_ms=duration_ms,
            result=result,
            error=row.error,
        )
