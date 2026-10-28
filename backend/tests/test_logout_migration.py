"""Exercise the logout migration without loading application environment settings."""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_logout_migration_preserves_active_revocations_on_rollback():
    path = Path(__file__).parents[1] / "migrations/versions/20261023_0029_revoked_access_tokens.py"
    spec = importlib.util.spec_from_file_location("logout_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        connection.execute(
            sa.text(
                "INSERT INTO revoked_access_tokens VALUES (:fingerprint, '2999-01-01 00:00:00')"
            ),
            {"fingerprint": "a" * 64},
        )
        with pytest.raises(RuntimeError, match="must expire"):
            migration.downgrade()
        assert connection.scalar(sa.text("SELECT count(*) FROM revoked_access_tokens")) == 1
        connection.execute(sa.text("UPDATE revoked_access_tokens SET expires_at = '2000-01-01'"))
        migration.downgrade()
        assert "revoked_access_tokens" not in sa.inspect(connection).get_table_names()
        migration.upgrade()
        assert "revoked_access_tokens" in sa.inspect(connection).get_table_names()
