import pytest

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


def test_relation_backfill_requires_an_explicit_batch_and_hard_caps_requests():
    common = {
        "database_url": "sqlite:///test.db",
        "seed_snapshot_path": Settings.from_env().seed_snapshot_path,
        "admin_token": None,
        "cors_origins": (),
    }

    with pytest.raises(ValueError, match="BATCH_ID"):
        Settings(**common, relation_backfill_max_snapshots=1)
    with pytest.raises(ValueError, match="between 0 and 10"):
        Settings(
            **common,
            relation_backfill_batch_id="too-large",
            relation_backfill_max_snapshots=11,
        )


def test_retrieval_mode_and_cloudflare_embedding_settings_are_explicit(monkeypatch):
    monkeypatch.setenv("AI_RADAR_RETRIEVAL_MODE", "hybrid")
    monkeypatch.setenv("AI_RADAR_EMBEDDING_PROVIDER", "cloudflare")
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "account-id")
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "secret-token")

    settings = Settings.from_env()

    assert settings.retrieval_mode == "hybrid"
    assert settings.embedding_provider == "cloudflare"
    assert settings.embedding_model == "@cf/baai/bge-m3"
    assert settings.embedding_dimension == 1024
    assert settings.cloudflare_account_id == "account-id"
    assert settings.cloudflare_api_token == "secret-token"


def test_invalid_retrieval_mode_is_rejected(monkeypatch):
    monkeypatch.setenv("AI_RADAR_RETRIEVAL_MODE", "bm25")

    with pytest.raises(ValueError, match="RETRIEVAL_MODE"):
        Settings.from_env()
