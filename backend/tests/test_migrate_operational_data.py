from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import create_engine, insert, select

from app.database import Base
from app.migrate_operational_data import copy_operational_data


def _url(path: Path) -> str:
    return f"sqlite:///{path.as_posix()}"


def test_copy_operational_data_is_additive_and_idempotent(tmp_path: Path):
    source_url = _url(tmp_path / "source.db")
    target_url = _url(tmp_path / "target.db")
    source_engine = create_engine(source_url)
    target_engine = create_engine(target_url)
    Base.metadata.create_all(source_engine)
    Base.metadata.create_all(target_engine)
    now = datetime.now(UTC)

    with source_engine.begin() as connection:
        connection.execute(
            insert(Base.metadata.tables["users"]),
            {
                "id": "user-1",
                "email": "owner@example.com",
                "password_hash": "preserved-password-hash",
                "role": "admin",
                "active": True,
                "daily_digest_enabled": False,
                "digest_hour": "08:00",
                "created_at": now,
            },
        )
        connection.execute(
            insert(Base.metadata.tables["follows"]),
            {
                "id": "follow-1",
                "user_id": "user-1",
                "entity_id": "e-codex",
                "intensity": "digest",
                "created_at": now,
            },
        )

    first = copy_operational_data(source_url, target_url)
    second = copy_operational_data(source_url, target_url)

    assert first["users"] == 1
    assert first["follows"] == 1
    assert second["users"] == 0
    assert second["follows"] == 0
    with target_engine.connect() as connection:
        user = connection.execute(select(Base.metadata.tables["users"])).mappings().one()
        follow = connection.execute(select(Base.metadata.tables["follows"])).mappings().one()
    assert user["password_hash"] == "preserved-password-hash"
    assert follow["entity_id"] == "e-codex"

    source_engine.dispose()
    target_engine.dispose()
