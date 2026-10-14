import importlib.util
import sqlite3
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "recover_entries", Path(__file__).resolve().parents[1] / "scripts/recover_entry_requests.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_recovery_preserves_selected_requests_is_idempotent_and_never_overwrites(tmp_path):
    source, target, backup = [tmp_path / name for name in ["preview.db", "main.db", "backup.db"]]
    for path in [source, target]:
        with sqlite3.connect(path) as db:
            db.execute(
                "CREATE TABLE entry_requests (id TEXT PRIMARY KEY, name TEXT, status TEXT, version INTEGER)"
            )
    with sqlite3.connect(source) as db:
        db.executemany(
            "INSERT INTO entry_requests VALUES (?,?,?,?)",
            [("one", "WorkBuddy", "pending", 1), ("two", "Test-only request", "pending", 1)],
        )
    assert module.recover(source, target, ["one"], backup) == 1
    assert module.recover(source, target, ["one"], backup) == 0
    with sqlite3.connect(target) as db:
        assert db.execute("SELECT * FROM entry_requests").fetchall() == [
            ("one", "WorkBuddy", "pending", 1)
        ]
        db.execute("UPDATE entry_requests SET status='resolved',version=2 WHERE id='one'")
    with pytest.raises(ValueError, match="never overwrites"):
        module.recover(source, target, ["one"], backup)
    with sqlite3.connect(backup) as db:
        assert db.execute("SELECT * FROM entry_requests").fetchall() == []
