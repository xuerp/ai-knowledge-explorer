from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.database import EntryRequestRecord

AUTOMATION_COLUMNS = {
    "auto_state",
    "auto_detail",
    "auto_attempts",
    "auto_attempted_at",
    "candidate_ids_json",
}


def test_entry_request_migration_matches_orm_and_can_roll_back(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[1]
    database_url = f"sqlite:///{(tmp_path / 'migration.db').as_posix()}"
    monkeypatch.setenv("AI_RADAR_DATABASE_URL", database_url)
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "migrations"))
    command.upgrade(config, "20261002_0024")
    engine = create_engine(database_url)
    # 0034 later adds the automation columns; 0024 created everything else.
    assert {column["name"] for column in inspect(engine).get_columns("entry_requests")} == set(
        EntryRequestRecord.__table__.columns.keys()
    ) - AUTOMATION_COLUMNS
    with engine.connect() as connection:
        assert connection.scalar(text("select version_num from alembic_version")) == "20261002_0024"
    engine.dispose()
    command.downgrade(config, "20260905_0023")
    engine = create_engine(database_url)
    assert "entry_requests" not in inspect(engine).get_table_names()
    engine.dispose()


def test_entry_request_automation_migration_matches_orm_and_rolls_back(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[1]
    database_url = f"sqlite:///{(tmp_path / 'automation.db').as_posix()}"
    monkeypatch.setenv("AI_RADAR_DATABASE_URL", database_url)
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "migrations"))
    command.upgrade(config, "20261127_0034")
    engine = create_engine(database_url)
    assert {column["name"] for column in inspect(engine).get_columns("entry_requests")} == set(
        EntryRequestRecord.__table__.columns.keys()
    )
    engine.dispose()
    command.downgrade(config, "20261126_0033")
    engine = create_engine(database_url)
    columns = {column["name"] for column in inspect(engine).get_columns("entry_requests")}
    assert not columns & AUTOMATION_COLUMNS
    engine.dispose()
