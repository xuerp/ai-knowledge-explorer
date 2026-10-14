import importlib.util
import json
import sqlite3
import sys
from datetime import UTC, datetime
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "windows", Path(__file__).resolve().parents[1] / "scripts/reconcile_36h_windows.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_manual_runs_and_future_windows_do_not_prove_scheduled_success():
    start = datetime(2026, 10, 6, tzinfo=UTC)
    runs = [{"trigger": "manual", "started_at": start.isoformat(), "status": "succeeded"}]
    results = module.reconcile(start, runs, start.replace(hour=1), windows=3)
    assert [r["state"] for r in results] == ["missed", "missed", "not-yet-due"]


def test_offset_time_and_duplicate_scheduled_runs_are_accounted():
    start = datetime(2026, 10, 6, tzinfo=UTC)
    run = {"trigger": "scheduled", "started_at": "2026-10-06T08:10:00+08:00", "status": "failed"}
    assert module.reconcile(start, [run], start.replace(hour=1), windows=1)[0]["state"] == "failed"
    assert (
        module.reconcile(start, [run, run], start.replace(hour=1), windows=1)[0]["state"]
        == "duplicate"
    )


def test_cli_reads_selected_database_and_excludes_other_observer_instances(tmp_path, monkeypatch):
    database = tmp_path / "isolated.db"
    output = tmp_path / "windows.json"
    with sqlite3.connect(database) as connection:
        connection.execute(
            "create table automation_runs (id text, worker_id text, trigger text, status text, started_at text, finished_at text, result_json text, error text)"
        )
        connection.executemany(
            "insert into automation_runs values (?,?,?,?,?,?,?,?)",
            [
                (
                    "actual",
                    "current-observer",
                    "scheduled",
                    "succeeded",
                    "2026-10-06T00:10:00+00:00",
                    "2026-10-06T00:10:01+00:00",
                    "{}",
                    None,
                ),
                (
                    "older",
                    "interrupted-observer",
                    "scheduled",
                    "succeeded",
                    "2026-10-06T00:15:00+00:00",
                    "2026-10-06T00:15:01+00:00",
                    "{}",
                    None,
                ),
                (
                    "manual",
                    "current-observer",
                    "manual",
                    "succeeded",
                    "2026-10-06T00:20:00+00:00",
                    "2026-10-06T00:20:01+00:00",
                    "{}",
                    None,
                ),
            ],
        )
    monkeypatch.setattr(module, "ROOT", tmp_path)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "reconcile",
            "--start",
            "2026-10-06T00:00:00+00:00",
            "--database",
            str(database),
            "--worker-id",
            "current-observer",
            "--output",
            str(output),
        ],
    )
    module.main()
    report = json.loads(output.read_text("utf-8"))
    assert report["windows"][0]["state"] == "succeeded"
    assert [run["id"] for run in report["windows"][0]["runs"]] == ["actual"]
    assert report["manualRunsExcluded"] == 1
    assert len(report["windows"]) == 32
    assert not report["all32WindowsSucceeded"]
