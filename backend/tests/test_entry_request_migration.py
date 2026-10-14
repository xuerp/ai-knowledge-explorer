from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.database import EntryRequestRecord


def test_entry_request_migration_matches_orm_and_can_roll_back(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[1]
    database_url = f"sqlite:///{(tmp_path / 'migration.db').as_posix()}"
    monkeypatch.setenv("AI_RADAR_DATABASE_URL", database_url)
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "migrations"))
    command.upgrade(config, "20261002_0024")
    engine = create_engine(database_url)
    assert {column["name"] for column in inspect(engine).get_columns("entry_requests")} == set(
        EntryRequestRecord.__table__.columns.keys()
    )
    with engine.connect() as connection:
        assert connection.scalar(text("select version_num from alembic_version")) == "20261002_0024"
    engine.dispose()
    command.downgrade(config, "20260905_0023")
    engine = create_engine(database_url)
    assert "entry_requests" not in inspect(engine).get_table_names()
    engine.dispose()
