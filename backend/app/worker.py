from __future__ import annotations

import argparse
import json
import time

from .config import Settings
from .database import Database
from .fetching import SafeHttpFetcher
from .ingestion import IngestionService
from .scheduler import IngestionScheduler


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
    try:
        while True:
            with database.session() as session:
                result = scheduler.run_due(session)
                print(json.dumps(result.model_dump(by_alias=True)), flush=True)
            if args.once:
                break
            time.sleep(args.interval_seconds)
    except KeyboardInterrupt:
        pass
    finally:
        database.dispose()


if __name__ == "__main__":
    main()
