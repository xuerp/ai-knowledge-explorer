from datetime import UTC, datetime

import pytest

from app.backup_drill import (
    DatabaseSummary,
    assert_matching_summaries,
    default_output_path,
    file_sha256,
    parse_summary,
    run_backup_drill,
    validate_container_name,
    validate_identifier,
)


def test_parse_summary_reads_migration_and_core_counts() -> None:
    assert parse_summary("20260809_0013|2|49|4|30\n") == DatabaseSummary(
        migration_head="20260809_0013",
        users=2,
        knowledge_entities=49,
        publications=4,
        sources=30,
    )


def test_matching_summary_requires_repository_head_and_equal_counts() -> None:
    summary = parse_summary("20260809_0013|2|49|4|30")
    assert_matching_summaries(summary, summary, "20260809_0013")

    with pytest.raises(RuntimeError, match="核心表计数"):
        assert_matching_summaries(
            summary,
            parse_summary("20260809_0013|2|48|4|30"),
            "20260809_0013",
        )


@pytest.mark.parametrize("value", ["ai-radar", "ai_radar;DROP", "", "a" * 64])
def test_database_identifiers_reject_unsafe_values(value: str) -> None:
    with pytest.raises(ValueError):
        validate_identifier(value, "数据库名称")


def test_container_names_allow_compose_names_but_reject_shell_syntax() -> None:
    assert validate_container_name("ai-radar-postgres-1") == "ai-radar-postgres-1"
    with pytest.raises(ValueError):
        validate_container_name("ai-radar-postgres-1;whoami")


def test_default_output_path_uses_utc_timestamp() -> None:
    output = default_output_path(datetime(2026, 8, 9, 10, 11, 12, tzinfo=UTC))

    assert output.as_posix() == "../backups/ai-radar-20260809T101112Z.dump"


def test_file_sha256_hashes_backup_bytes(tmp_path) -> None:
    backup = tmp_path / "backup.dump"
    backup.write_bytes(b"AI Radar backup")

    assert file_sha256(backup) == "1f097a3fc6a46712e658a1f3245f675c13eb6bde8bddfc580bb3b119209a9e5b"


def test_failed_restore_check_does_not_create_verification_checksum(tmp_path) -> None:
    source_summary = parse_summary("20260809_0013|1|49|0|30")
    restored_summary = parse_summary("20260809_0013|1|48|0|30")

    class FakePostgres:
        def __init__(self) -> None:
            self.summaries = iter([source_summary, restored_summary])
            self.dropped = False

        def summary(self, _database: str) -> DatabaseSummary:
            return next(self.summaries)

        def dump(self, _database: str, destination) -> None:
            destination.write(b"backup")

        def create_database(self, _database: str) -> None:
            return None

        def restore(self, _database: str, _source) -> None:
            return None

        def drop_database(self, _database: str) -> None:
            self.dropped = True

    postgres = FakePostgres()
    output = tmp_path / "backup.dump"
    with pytest.raises(RuntimeError, match="核心表计数"):
        run_backup_drill(
            postgres,  # type: ignore[arg-type]
            source_database="ai_radar",
            output_path=output,
            expected_head="20260809_0013",
        )

    assert output.exists()
    assert not output.with_suffix(".dump.sha256").exists()
    assert postgres.dropped is True
