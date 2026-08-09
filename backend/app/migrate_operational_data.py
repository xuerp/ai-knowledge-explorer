from __future__ import annotations

import argparse
import os
from collections.abc import Sequence

from sqlalchemy import MetaData, Table, create_engine, insert, select

from .database import Base

OPERATIONAL_TABLES: Sequence[str] = (
    "users",
    "follows",
    "notifications",
    "research_records",
    "email_outbox",
)


def copy_operational_data(source_url: str, target_url: str) -> dict[str, int]:
    """Copy user-owned state without replacing any existing target rows."""
    if source_url == target_url:
        raise ValueError("Source and target database URLs must be different.")

    source_engine = create_engine(source_url, future=True)
    target_engine = create_engine(target_url, future=True)
    copied: dict[str, int] = {}
    try:
        with source_engine.connect() as source, target_engine.begin() as target:
            for table_name in OPERATIONAL_TABLES:
                target_table = Base.metadata.tables[table_name]
                source_table = Table(table_name, MetaData(), autoload_with=source)
                primary_key = tuple(target_table.primary_key.columns)
                rows = source.execute(select(source_table)).mappings().all()
                count = 0
                for row in rows:
                    predicate = [column == row[column.name] for column in primary_key]
                    exists = target.execute(select(*primary_key).where(*predicate).limit(1)).first()
                    if exists:
                        continue
                    values = {
                        key: value for key, value in row.items() if key in target_table.columns
                    }
                    target.execute(insert(target_table).values(**values))
                    count += 1
                copied[table_name] = count
    finally:
        source_engine.dispose()
        target_engine.dispose()
    return copied


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Copy users, follows, notifications, research and outbox rows safely.",
    )
    parser.add_argument("--source-url", required=True)
    parser.add_argument(
        "--target-url",
        default=os.getenv("AI_RADAR_DATABASE_URL"),
        help="Defaults to AI_RADAR_DATABASE_URL.",
    )
    args = parser.parse_args()
    if not args.target_url:
        parser.error("Set --target-url or AI_RADAR_DATABASE_URL.")

    copied = copy_operational_data(args.source_url, args.target_url)
    print("Operational data migration completed:")
    for table_name, count in copied.items():
        print(f"- {table_name}: {count} copied")


if __name__ == "__main__":
    main()
