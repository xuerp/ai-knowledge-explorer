"""Add worker observability and bounded retry metadata.

Revision ID: 20260809_0012
Revises: 20260809_0011
Create Date: 2026-08-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260809_0012"
down_revision: str | None = "20260809_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "sources",
        sa.Column("consecutive_failures", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column("sources", sa.Column("last_fetch_error", sa.Text(), nullable=True))
    op.create_index(
        "ix_sources_automatic_due",
        "sources",
        ["active", "fetch_enabled", "next_fetch_at"],
    )

    op.add_column(
        "email_outbox",
        sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "email_outbox",
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "email_outbox",
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_email_outbox_delivery_due",
        "email_outbox",
        ["status", "next_attempt_at", "created_at"],
    )
    op.create_index(
        "ix_ingestion_runs_started_at",
        "ingestion_runs",
        ["started_at"],
    )

    op.create_table(
        "automation_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("worker_id", sa.String(length=128), nullable=False),
        sa.Column("trigger", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("result_json", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_automation_runs_worker_id", "automation_runs", ["worker_id"])
    op.create_index("ix_automation_runs_status", "automation_runs", ["status"])
    op.create_index("ix_automation_runs_started_at", "automation_runs", ["started_at"])

    op.create_table(
        "worker_status",
        sa.Column("worker_id", sa.String(length=128), nullable=False),
        sa.Column("state", sa.String(length=32), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("next_cycle_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_cycle_id", sa.String(length=36), nullable=True),
        sa.Column("last_cycle_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_cycle_finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_cycle_status", sa.String(length=32), nullable=True),
        sa.Column("consecutive_failures", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("worker_id"),
    )
    op.create_index("ix_worker_status_heartbeat_at", "worker_status", ["heartbeat_at"])


def downgrade() -> None:
    op.drop_index("ix_worker_status_heartbeat_at", table_name="worker_status")
    op.drop_table("worker_status")
    op.drop_index("ix_automation_runs_started_at", table_name="automation_runs")
    op.drop_index("ix_automation_runs_status", table_name="automation_runs")
    op.drop_index("ix_automation_runs_worker_id", table_name="automation_runs")
    op.drop_table("automation_runs")
    op.drop_index("ix_ingestion_runs_started_at", table_name="ingestion_runs")
    op.drop_index("ix_email_outbox_delivery_due", table_name="email_outbox")
    op.drop_column("email_outbox", "next_attempt_at")
    op.drop_column("email_outbox", "last_attempt_at")
    op.drop_column("email_outbox", "attempt_count")
    op.drop_index("ix_sources_automatic_due", table_name="sources")
    op.drop_column("sources", "last_fetch_error")
    op.drop_column("sources", "consecutive_failures")
