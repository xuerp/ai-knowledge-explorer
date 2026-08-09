from dataclasses import replace
from datetime import UTC, datetime

from app.production_readiness import (
    ProductionReadinessInputs,
    build_production_readiness,
)


def _ready_inputs() -> ProductionReadinessInputs:
    return ProductionReadinessInputs(
        environment="production",
        data_mode="live",
        database_dialect="postgresql",
        schema_revision="20260809_0013",
        expected_schema_revision="20260809_0013",
        jwt_enabled=True,
        legacy_admin_token_enabled=False,
        cors_origins=("https://radar.example.com",),
        extraction_configured=True,
        smtp_configured=True,
        fetch_allowed_hosts=3,
        automatic_sources=2,
        quality_ready=True,
        heartbeat_status="healthy",
    )


def test_production_readiness_can_clear_all_automated_checks():
    generated_at = datetime(2026, 8, 9, 8, 0, tzinfo=UTC)
    report = build_production_readiness(_ready_inputs(), now=generated_at)

    assert report.generated_at == generated_at
    assert report.automated_ready is True
    assert report.blocking_count == 0
    assert report.warning_count == 0
    assert all(check.status == "ready" for check in report.checks)
    assert {check.code for check in report.manual_checks} == {
        "public_https",
        "backup_restore",
        "external_monitoring",
        "provider_limits",
    }
    assert all(check.status == "manual" for check in report.manual_checks)


def test_production_readiness_separates_blockers_and_warnings():
    report = build_production_readiness(
        replace(
            _ready_inputs(),
            environment="development",
            heartbeat_status="stale",
            legacy_admin_token_enabled=True,
        )
    )
    statuses = {check.code: check.status for check in report.checks}

    assert report.automated_ready is False
    assert report.blocking_count == 2
    assert report.warning_count == 1
    assert statuses["runtime_environment"] == "blocked"
    assert statuses["worker_heartbeat"] == "blocked"
    assert statuses["legacy_admin_token"] == "warning"
