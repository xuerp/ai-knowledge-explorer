from __future__ import annotations

import argparse
import json
import time
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from .config import Settings
from .database import Database
from .email_delivery import EmailDeliveryService
from .engagement import EngagementService
from .fetching import SafeHttpFetcher
from .ingestion import IngestionService
from .scheduler import IngestionScheduler


def run_cycle(
    session: Session,
    scheduler: IngestionScheduler,
    engagement: EngagementService,
    email_delivery: EmailDeliveryService,
    *,
    digest_timezone: str,
    now: datetime | None = None,
) -> dict[str, object]:
    current = now or datetime.now(UTC)
    ingestion = scheduler.run_due(session, now=current)
    digests = engagement.queue_daily_digests(
        session,
        now=current,
        timezone_name=digest_timezone,
        due_only=True,
    )
    delivery: dict[str, object] = {
        "configured": email_delivery.enabled,
        "attempted": 0,
        "sent": 0,
        "failed": 0,
    }
    if email_delivery.enabled:
        try:
            result = email_delivery.send_queued(session)
            delivery.update(result.model_dump())
        except Exception as error:  # noqa: BLE001 - keep scheduled collection alive
            delivery["error"] = str(error)[:500]
    return {
        "ingestion": ingestion.model_dump(by_alias=True),
        "digests": digests.model_dump(by_alias=True),
        "emailDelivery": delivery,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run due AI Radar source ingestion jobs.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--once", action="store_true", help="Run one due cycle and exit.")
    mode.add_argument(
        "--interval-seconds",
        type=int,
        help="Keep running and check due sources at this interval (minimum 60).",
    )
    args = parser.parse_args()
    if args.interval_seconds is not None and args.interval_seconds < 60:
        parser.error("--interval-seconds must be at least 60.")

    settings = Settings.from_env()
    database = Database(settings.database_url)
    database.create_all()
    scheduler = IngestionScheduler(
        SafeHttpFetcher(settings.fetch_allowed_hosts, settings.fetch_max_bytes),
        IngestionService(),
    )
    engagement = EngagementService()
    email_delivery = EmailDeliveryService(
        settings.smtp_host,
        settings.smtp_port,
        settings.smtp_username,
        settings.smtp_password,
        settings.smtp_from,
        settings.smtp_starttls,
    )
    try:
        while True:
            with database.session() as session:
                result = run_cycle(
                    session,
                    scheduler,
                    engagement,
                    email_delivery,
                    digest_timezone=settings.digest_timezone,
                )
                print(json.dumps(result), flush=True)
            if args.once:
                break
            time.sleep(args.interval_seconds)
    except KeyboardInterrupt:
        pass
    finally:
        database.dispose()


if __name__ == "__main__":
    main()
