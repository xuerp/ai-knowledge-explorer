from app.config import Settings, normalize_database_url


def test_render_postgres_url_uses_installed_psycopg_driver():
    assert normalize_database_url("postgresql://user:pass@db/ai_radar") == (
        "postgresql+psycopg://user:pass@db/ai_radar"
    )
    assert normalize_database_url("postgres://user:pass@db/ai_radar") == (
        "postgresql+psycopg://user:pass@db/ai_radar"
    )


def test_explicit_driver_and_sqlite_urls_are_unchanged():
    assert normalize_database_url("postgresql+psycopg://user:pass@db/ai_radar") == (
        "postgresql+psycopg://user:pass@db/ai_radar"
    )
    assert normalize_database_url("sqlite:///data/ai_radar.db") == ("sqlite:///data/ai_radar.db")


def test_settings_use_render_commit_without_exposing_other_runtime_configuration(monkeypatch):
    monkeypatch.delenv("AI_RADAR_BUILD_COMMIT", raising=False)
    monkeypatch.setenv("RENDER_GIT_COMMIT", "render-commit-123")
    monkeypatch.setenv("AI_RADAR_BUILT_AT", "2026-08-25T00:00:00Z")

    settings = Settings.from_env()

    assert settings.build_commit == "render-commit-123"
    assert settings.built_at == "2026-08-25T00:00:00Z"
