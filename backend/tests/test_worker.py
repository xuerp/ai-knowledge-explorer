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
    monkeypatch.delenv("AI_RADAR_WORKER_INSTANCE_ID", raising=False)
    monkeypatch.delenv("RENDER_INSTANCE_ID", raising=False)
    monkeypatch.delenv("HOSTNAME", raising=False)

    assert resolve_worker_id(build_settings()) == "scheduler-staging"


def test_resolve_worker_id_adds_render_instance_id(monkeypatch) -> None:
    monkeypatch.delenv("AI_RADAR_WORKER_INSTANCE_ID", raising=False)
    monkeypatch.setenv("RENDER_INSTANCE_ID", "srv-instance-42")
    monkeypatch.setenv("HOSTNAME", "container-fallback")

    assert resolve_worker_id(build_settings()) == "scheduler-staging-srv-instance-42"


def test_resolve_worker_id_uses_explicit_instance_before_platform_values(monkeypatch) -> None:
    monkeypatch.setenv("AI_RADAR_WORKER_INSTANCE_ID", "worker-blue")
    monkeypatch.setenv("RENDER_INSTANCE_ID", "srv-instance-42")
    monkeypatch.setenv("HOSTNAME", "container-fallback")

    assert resolve_worker_id(build_settings()) == "scheduler-staging-worker-blue"


def test_resolve_worker_id_uses_container_hostname_as_fallback(monkeypatch) -> None:
    monkeypatch.delenv("AI_RADAR_WORKER_INSTANCE_ID", raising=False)
    monkeypatch.delenv("RENDER_INSTANCE_ID", raising=False)
    monkeypatch.setenv("HOSTNAME", "container-7f3a")

    assert resolve_worker_id(build_settings()) == "scheduler-staging-container-7f3a"
