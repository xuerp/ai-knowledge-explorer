from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text


def test_user_version_migration_preserves_accounts_and_blocks_unsafe_rollback(
    tmp_path, monkeypatch
):
    backend = Path(__file__).parents[1]
    config = Config(str(backend / "alembic.ini"))
    config.set_main_option("script_location", str(backend / "migrations"))
    url = "sqlite:///" + (tmp_path / "migrate.db").as_posix()
    monkeypatch.setenv("AI_RADAR_DATABASE_URL", url)
    config.set_main_option("sqlalchemy.url", url)
    command.upgrade(config, "20261023_0029")
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id,email,password_hash,role,active,daily_digest_enabled,digest_hour,created_at) VALUES ('kept','kept@example.com','hash','admin',1,0,'08:00',CURRENT_TIMESTAMP)"
            )
        )
    command.upgrade(config, "head")
    with engine.connect() as connection:
        assert connection.execute(text("SELECT id,email,session_version FROM users")).one() == (
            "kept",
            "kept@example.com",
            0,
        )
    assert "session_version" in {column["name"] for column in inspect(engine).get_columns("users")}
    with engine.begin() as connection:
        connection.execute(text("UPDATE users SET session_version=1"))
    with pytest.raises(RuntimeError, match="revocations"):
        command.downgrade(config, "20261023_0029")
    engine.dispose()
