from pathlib import Path

from app.config import Settings
from app.worker import resolve_worker_id


def build_settings() -> Settings:
    return Settings(
        database_url="sqlite://",
        seed_snapshot_path=Path("unused.json"),
        admin_token=None,
        cors_origins=(),
        worker_id="scheduler-staging",
    )


def test_resolve_worker_id_keeps_local_logical_id(monkeypatch) -> None:
    monkeypatch.delenv("RENDER_INSTANCE_ID", raising=False)

    assert resolve_worker_id(build_settings()) == "scheduler-staging"


def test_resolve_worker_id_adds_render_instance_id(monkeypatch) -> None:
    monkeypatch.setenv("RENDER_INSTANCE_ID", "srv-instance-42")

    assert resolve_worker_id(build_settings()) == "scheduler-staging-srv-instance-42"
