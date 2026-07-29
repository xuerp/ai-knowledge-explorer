from __future__ import annotations

import argparse
import json

from .config import Settings
from .database import Database
from .fetching import SafeHttpFetcher
from .ingestion import IngestionService
from .scheduler import IngestionScheduler


def main() -> None:
    parser = argparse.ArgumentParser(description="Run due AI Radar source ingestion jobs.")
    parser.add_argument("--once", action="store_true", help="Run one due cycle and exit.")
    args = parser.parse_args()
    if not args.once:
        parser.error("Only --once is supported; use a cloud scheduler for recurring execution.")

    settings = Settings.from_env()
    database = Database(settings.database_url)
    database.create_all()
    scheduler = IngestionScheduler(
        SafeHttpFetcher(settings.fetch_allowed_hosts, settings.fetch_max_bytes),
        IngestionService(),
    )
    try:
        with database.session() as session:
            result = scheduler.run_due(session)
            print(json.dumps(result.model_dump(by_alias=True)))
    finally:
        database.dispose()


if __name__ == "__main__":
    main()
