"""Recover explicitly selected requests from an older local preview database."""

import argparse
import sqlite3
from pathlib import Path


def recover(source: Path, target: Path, request_ids: list[str], backup: Path) -> int:
    if source.resolve() == target.resolve() or not source.is_file() or not target.is_file():
        raise ValueError("Choose two existing, different databases.")
    with sqlite3.connect(f"file:{source.resolve().as_posix()}?mode=ro", uri=True) as old:
        old.row_factory = sqlite3.Row
        rows = [old.execute("SELECT * FROM entry_requests WHERE id=?", (key,)).fetchone() for key in request_ids]
    if any(row is None for row in rows):
        raise ValueError("A selected request does not exist in the source database.")
    with sqlite3.connect(target) as current:
        current.row_factory = sqlite3.Row
        missing = []
        for row in rows:
            existing = current.execute("SELECT * FROM entry_requests WHERE id=?", (row["id"],)).fetchone()
            if existing and dict(existing) != dict(row):
                raise ValueError("An existing request differs; recovery never overwrites reviewed records.")
            if not existing:
                missing.append(row)
        if not missing:
            return 0
        backup.parent.mkdir(parents=True, exist_ok=True)
        if backup.exists():
            raise ValueError("Backup path must be new.")
        with sqlite3.connect(backup) as saved:
            current.backup(saved)
        columns = list(missing[0].keys())
        marks = ",".join("?" for _ in columns)
        current.executemany(
            f"INSERT INTO entry_requests ({','.join(columns)}) VALUES ({marks})",
            [tuple(row[column] for column in columns) for row in missing],
        )
        current.commit()
        return len(missing)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--backup", type=Path, required=True)
    parser.add_argument("--request-id", action="append", required=True)
    args = parser.parse_args()
    print(f"Recovered {recover(args.source, args.target, args.request_id, args.backup)} selected requests; original IDs and statuses retained.")
