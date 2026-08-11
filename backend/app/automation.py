from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from threading import Lock

from sqlalchemy import text
from sqlalchemy.engine import Engine

AUTOMATION_LOCK_NAME = "ai-radar-automation-cycle"
_sqlite_lock = Lock()


class AutomationCycleBusyError(RuntimeError):
    pass


@contextmanager
def automation_cycle_lock(engine: Engine) -> Iterator[None]:
    if engine.dialect.name == "postgresql":
        with engine.connect() as lock_connection:
            acquired = bool(
                lock_connection.scalar(
                    text("SELECT pg_try_advisory_lock(hashtext(:lock_name))"),
                    {"lock_name": AUTOMATION_LOCK_NAME},
                )
            )
            if not acquired:
                raise AutomationCycleBusyError("Another automation cycle is already running.")
            try:
                yield
            finally:
                lock_connection.execute(
                    text("SELECT pg_advisory_unlock(hashtext(:lock_name))"),
                    {"lock_name": AUTOMATION_LOCK_NAME},
                )
        return

    if not _sqlite_lock.acquire(blocking=False):
        raise AutomationCycleBusyError("Another automation cycle is already running.")
    try:
        yield
    finally:
        _sqlite_lock.release()
