from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import BinaryIO

from alembic.config import Config
from alembic.script import ScriptDirectory

IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
CONTAINER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
SUMMARY_SQL = """
SELECT
  (SELECT version_num FROM alembic_version),
  (SELECT count(*) FROM users),
  (SELECT count(*) FROM knowledge_entities),
  (SELECT count(*) FROM publication_history),
  (SELECT count(*) FROM sources);
""".strip()


@dataclass(frozen=True, slots=True)
class DatabaseSummary:
    migration_head: str
    users: int
    knowledge_entities: int
    publications: int
    sources: int


def validate_identifier(value: str, label: str) -> str:
    if not IDENTIFIER_PATTERN.fullmatch(value):
        raise ValueError(f"{label} 只能包含字母、数字和下划线，且长度不能超过 63。")
    return value


def validate_container_name(value: str) -> str:
    if not CONTAINER_PATTERN.fullmatch(value):
        raise ValueError("容器名称格式不安全。")
    return value


def parse_summary(output: str) -> DatabaseSummary:
    values = output.strip().split("|")
    if len(values) != 5 or not values[0]:
        raise RuntimeError("无法读取数据库迁移版本与核心表计数。")
    try:
        counts = [int(value) for value in values[1:]]
    except ValueError as error:
        raise RuntimeError("数据库核心表计数不是有效整数。") from error
    return DatabaseSummary(values[0], *counts)


def assert_matching_summaries(
    source: DatabaseSummary,
    restored: DatabaseSummary,
    expected_head: str,
) -> None:
    if source.migration_head != expected_head:
        raise RuntimeError(
            f"源数据库迁移版本为 {source.migration_head}，仓库 head 为 {expected_head}。"
        )
    if restored != source:
        raise RuntimeError("恢复数据库的迁移版本或核心表计数与源数据库不一致。")


def repository_migration_head(alembic_ini: Path) -> str:
    config = Config(str(alembic_ini))
    config.set_main_option("script_location", str(alembic_ini.parent / "migrations"))
    script = ScriptDirectory.from_config(config)
    heads = script.get_heads()
    if len(heads) != 1:
        raise RuntimeError(f"仓库必须只有一个迁移 head，当前数量为 {len(heads)}。")
    return heads[0]


class DockerPostgres:
    def __init__(self, docker: str, container: str, user: str) -> None:
        self.docker = docker
        self.container = validate_container_name(container)
        self.user = validate_identifier(user, "数据库用户")

    def _run(
        self,
        command: Sequence[str],
        *,
        stdin: BinaryIO | None = None,
        stdout: BinaryIO | int | None = None,
        capture_output: bool = False,
    ) -> subprocess.CompletedProcess[str] | subprocess.CompletedProcess[bytes]:
        return subprocess.run(
            [self.docker, "exec", "-i", self.container, *command],
            check=True,
            stdin=stdin,
            stdout=stdout,
            capture_output=capture_output,
            text=capture_output,
        )

    def summary(self, database: str) -> DatabaseSummary:
        database = validate_identifier(database, "数据库名称")
        result = self._run(
            ["psql", "-U", self.user, "-d", database, "-At", "-F", "|", "-c", SUMMARY_SQL],
            capture_output=True,
        )
        return parse_summary(result.stdout)

    def dump(self, database: str, destination: BinaryIO) -> None:
        database = validate_identifier(database, "数据库名称")
        self._run(
            [
                "pg_dump",
                "-U",
                self.user,
                "-d",
                database,
                "--format=custom",
                "--no-owner",
                "--no-privileges",
            ],
            stdout=destination,
        )

    def create_database(self, database: str) -> None:
        database = validate_identifier(database, "恢复数据库名称")
        self._run(["createdb", "-U", self.user, "--template=template0", database])

    def restore(self, database: str, source: BinaryIO) -> None:
        database = validate_identifier(database, "恢复数据库名称")
        self._run(
            [
                "pg_restore",
                "-U",
                self.user,
                "-d",
                database,
                "--no-owner",
                "--no-privileges",
                "--exit-on-error",
            ],
            stdin=source,
        )

    def drop_database(self, database: str) -> None:
        database = validate_identifier(database, "恢复数据库名称")
        self._run(["dropdb", "-U", self.user, "--if-exists", "--force", database])


def default_output_path(now: datetime | None = None) -> Path:
    current = now or datetime.now(UTC)
    filename = current.strftime("ai-radar-%Y%m%dT%H%M%SZ.dump")
    return Path("../backups") / filename


def file_sha256(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def run_backup_drill(
    postgres: DockerPostgres,
    *,
    source_database: str,
    output_path: Path,
    expected_head: str,
    overwrite: bool = False,
) -> dict[str, object]:
    source_database = validate_identifier(source_database, "源数据库名称")
    output_path = output_path.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    checksum_path = output_path.with_suffix(f"{output_path.suffix}.sha256")
    if not overwrite:
        for candidate in (output_path, checksum_path):
            if candidate.exists():
                raise FileExistsError(f"备份文件已存在：{candidate}")

    partial_path = output_path.with_name(f"{output_path.name}.partial-{os.getpid()}")
    restore_database = validate_identifier(
        f"ai_radar_restore_{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}_{os.getpid()}",
        "恢复数据库名称",
    )
    source_summary = postgres.summary(source_database)
    restore_created = False
    try:
        with partial_path.open("xb") as destination:
            postgres.dump(source_database, destination)
        partial_path.chmod(0o600)
        if overwrite:
            if checksum_path.exists():
                checksum_path.unlink()
            os.replace(partial_path, output_path)
        else:
            partial_path.rename(output_path)
        digest = file_sha256(output_path)

        postgres.create_database(restore_database)
        restore_created = True
        with output_path.open("rb") as source:
            postgres.restore(restore_database, source)
        restored_summary = postgres.summary(restore_database)
        assert_matching_summaries(source_summary, restored_summary, expected_head)
        checksum_path.write_text(f"{digest}  {output_path.name}\n", encoding="ascii")
        checksum_path.chmod(0o600)
        return {
            "ok": True,
            "backupPath": str(output_path),
            "backupBytes": output_path.stat().st_size,
            "checksumPath": str(checksum_path),
            "sha256": digest,
            "migrationHead": expected_head,
            "source": asdict(source_summary),
            "restored": asdict(restored_summary),
        }
    finally:
        if restore_created:
            postgres.drop_database(restore_database)
        if partial_path.exists():
            partial_path.unlink()


def main() -> None:
    parser = argparse.ArgumentParser(description="创建 PostgreSQL 备份并在隔离数据库中恢复验证。")
    parser.add_argument("--container", default="ai-radar-postgres-1")
    parser.add_argument("--database", default="ai_radar")
    parser.add_argument("--user", default="ai_radar")
    parser.add_argument("--docker", default="docker")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    docker = shutil.which(args.docker)
    if docker is None:
        parser.error(f"找不到 Docker CLI：{args.docker}")
    alembic_ini = Path(__file__).resolve().parents[1] / "alembic.ini"
    result = run_backup_drill(
        DockerPostgres(docker, args.container, args.user),
        source_database=args.database,
        output_path=args.output or default_output_path(),
        expected_head=repository_migration_head(alembic_ini),
        overwrite=args.overwrite,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
