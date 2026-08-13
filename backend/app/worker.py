from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy.orm import Session

from .config import Settings
from .database import Database
from .email_delivery import EmailDeliveryService
from .engagement import EngagementService
from .fetching import SafeHttpFetcher
from .ingestion import IngestionService
from .operations import OperationsService
from .scheduler import IngestionScheduler


def handle_shutdown_signal(_signum: int, _frame: object) -> None:
    raise KeyboardInterrupt


def resolve_worker_id(settings: Settings) -> str:
    instance_id = next(
        (
            os.getenv(key, "").strip()
            for key in (
                "AI_RADAR_WORKER_INSTANCE_ID",
                "RENDER_INSTANCE_ID",
                "HOSTNAME",
            )
            if os.getenv(key, "").strip()
        ),
        "",
    )
    if not instance_id:
        return settings.worker_id
    return f"{settings.worker_id}-{instance_id}"[:128]


def run_cycle(
    session: Session,
    scheduler: IngestionScheduler,
    engagement: EngagementService,
    email_delivery: EmailDeliveryService,
    *,
    digest_timezone: str,
    now: datetime | None = None,
    heartbeat: Callable[[], None] | None = None,
) -> dict[str, object]:
    current = now or datetime.now(UTC)
    errors: dict[str, str] = {}
    try:
        ingestion_result = scheduler.run_due(session, now=current, progress=heartbeat)
        ingestion: dict[str, object] = ingestion_result.model_dump(by_alias=True)
    except Exception as error:  # noqa: BLE001 - keep later automatic tasks running
        session.rollback()
        ingestion = {"due": 0, "succeeded": 0, "unchanged": 0, "failed": 0}
        errors["ingestion"] = str(error)[:500]
    if heartbeat:
        heartbeat()

    try:
        digest_result = engagement.queue_daily_digests(
            session,
            now=current,
            timezone_name=digest_timezone,
            due_only=True,
        )
        digests: dict[str, object] = digest_result.model_dump(by_alias=True)
    except Exception as error:  # noqa: BLE001 - email delivery can still make progress
        session.rollback()
        digests = {"recipients": 0, "messagesQueued": 0}
        errors["digests"] = str(error)[:500]
    if heartbeat:
        heartbeat()

    delivery: dict[str, object] = {
        "configured": email_delivery.enabled,
        "attempted": 0,
        "sent": 0,
        "failed": 0,
    }
    if email_delivery.enabled:
        try:
            result = email_delivery.send_queued(session, now=current, progress=heartbeat)
            delivery.update(result.model_dump())
        except Exception as error:  # noqa: BLE001 - keep scheduled collection alive
            session.rollback()
            delivery["error"] = str(error)[:500]
            errors["emailDelivery"] = str(error)[:500]
    if heartbeat:
        heartbeat()
    result: dict[str, object] = {
        "ingestion": ingestion,
        "digests": digests,
        "emailDelivery": delivery,
    }
    if errors:
        result["errors"] = errors
    return result


def wait_with_heartbeats(
    database: Database,
    operations: OperationsService,
    worker_id: str,
    *,
    wait_seconds: int,
    heartbeat_seconds: int,
    next_cycle_at: datetime,
    state: str,
) -> None:
    deadline = time.monotonic() + wait_seconds
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return
        time.sleep(min(heartbeat_seconds, remaining))
        with database.session() as session:
            operations.heartbeat(
                session,
                worker_id,
                state=state,
                next_cycle_at=next_cycle_at,
            )


def worker_health(settings: Settings) -> bool:
    database = Database(settings.database_url)
    operations = OperationsService(
        settings.worker_stale_seconds,
        settings.auto_extraction_retry_minutes,
    )
    worker_id = resolve_worker_id(settings)
    try:
        with database.session() as session:
            healthy = operations.is_worker_healthy(session, worker_id)
        print(json.dumps({"workerId": worker_id, "healthy": healthy}), flush=True)
        return healthy
    except Exception as error:  # noqa: BLE001 - a healthcheck must fail closed
        print(
            json.dumps({"workerId": worker_id, "healthy": False, "error": str(error)[:200]}),
            flush=True,
        )
        return False
    finally:
        database.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run due AI Radar source ingestion jobs.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--once", action="store_true", help="Run one due cycle and exit.")
    mode.add_argument(
        "--interval-seconds",
        type=int,
        help="Keep running and check due sources at this interval (minimum 60).",
    )
    mode.add_argument(
        "--healthcheck",
        action="store_true",
        help="Exit successfully when the configured worker heartbeat is fresh.",
    )
    args = parser.parse_args()
    if args.interval_seconds is not None and args.interval_seconds < 60:
        parser.error("--interval-seconds must be at least 60.")

    settings = Settings.from_env()
    if args.healthcheck:
        sys.exit(0 if worker_health(settings) else 1)
    if settings.worker_heartbeat_seconds < 5:
        parser.error("AI_RADAR_WORKER_HEARTBEAT_SECONDS must be at least 5.")
    if settings.worker_stale_seconds < settings.worker_heartbeat_seconds * 2:
        parser.error("AI_RADAR_WORKER_STALE_SECONDS must be at least twice the heartbeat interval.")

    database = Database(settings.database_url)
    if database.engine.dialect.name == "sqlite":
        database.create_all()
    scheduler = IngestionScheduler(
        SafeHttpFetcher(settings.fetch_allowed_hosts, settings.fetch_max_bytes),
        IngestionService(settings.fetch_allowed_hosts),
        retry_base_minutes=settings.fetch_retry_base_minutes,
        retry_max_minutes=settings.fetch_retry_max_minutes,
        lease_minutes=settings.fetch_lease_minutes,
    )
    engagement = EngagementService()
    email_delivery = EmailDeliveryService(
        settings.smtp_host,
        settings.smtp_port,
        settings.smtp_username,
        settings.smtp_password,
        settings.smtp_from,
        settings.smtp_starttls,
        max_attempts=settings.email_max_attempts,
        retry_base_seconds=settings.email_retry_base_seconds,
        lease_seconds=settings.email_lease_seconds,
    )
    operations = OperationsService(
        settings.worker_stale_seconds,
        settings.auto_extraction_retry_minutes,
    )
    worker_id = (
        resolve_worker_id(settings)
        if args.interval_seconds is not None
        else f"{settings.worker_id}-manual-{str(uuid4())[:8]}"
    )
    with database.session() as session:
        operations.register_worker(session, worker_id)
    signal.signal(signal.SIGTERM, handle_shutdown_signal)

    def cycle_heartbeat() -> None:
        with database.session() as heartbeat_session:
            operations.heartbeat(heartbeat_session, worker_id, state="running")

    try:
        while True:
            cycle_started = datetime.now(UTC)
            with database.session() as session:
                run_id = operations.start_cycle(
                    session,
                    worker_id,
                    "scheduled" if args.interval_seconds is not None else "manual",
                    now=cycle_started,
                )
            result: dict[str, object] | None = None
            cycle_error: Exception | None = None
            try:
                with database.session() as session:
                    result = run_cycle(
                        session,
                        scheduler,
                        engagement,
                        email_delivery,
                        digest_timezone=settings.digest_timezone,
                        now=cycle_started,
                        heartbeat=cycle_heartbeat,
                    )
            except Exception as error:  # noqa: BLE001 - persist failure before continuing
                cycle_error = error

            finished = datetime.now(UTC)
            next_cycle_at = (
                finished + timedelta(seconds=args.interval_seconds)
                if args.interval_seconds is not None
                else None
            )
            with database.session() as session:
                if cycle_error is not None:
                    operations.fail_cycle(
                        session,
                        worker_id,
                        run_id,
                        cycle_error,
                        now=finished,
                        next_cycle_at=next_cycle_at,
                    )
                    cycle_status = "failed"
                else:
                    cycle_status = operations.complete_cycle(
                        session,
                        worker_id,
                        run_id,
                        result or {},
                        now=finished,
                        next_cycle_at=next_cycle_at,
                    )
            print(
                json.dumps(
                    {
                        "cycleId": run_id,
                        "workerId": worker_id,
                        "status": cycle_status,
                        "result": result,
                        "error": str(cycle_error)[:500] if cycle_error else None,
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
            if args.once:
                break
            wait_with_heartbeats(
                database,
                operations,
                worker_id,
                wait_seconds=args.interval_seconds,
                heartbeat_seconds=settings.worker_heartbeat_seconds,
                next_cycle_at=next_cycle_at,
                state="failed" if cycle_error else "idle",
            )
    except KeyboardInterrupt:
        pass
    finally:
        try:
            with database.session() as session:
                operations.heartbeat(session, worker_id, state="stopped")
        except Exception as error:  # noqa: BLE001 - shutdown must still dispose the pool
            print(
                json.dumps({"workerId": worker_id, "shutdownHeartbeatError": str(error)[:200]}),
                file=sys.stderr,
                flush=True,
            )
        database.dispose()


if __name__ == "__main__":
    main()
