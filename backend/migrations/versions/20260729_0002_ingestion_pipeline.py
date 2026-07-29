"""Add sources, document snapshots and ingestion runs.

Revision ID: 20260729_0002
Revises: 20260729_0001
Create Date: 2026-07-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260729_0002"
down_revision: str | None = "20260729_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("review_jobs", sa.Column("evidence_json", sa.Text(), nullable=True))
    op.create_table(
        "sources",
        sa.Column("id", sa.String(length=128), nullable=False),
        sa.Column("url", sa.String(length=2048), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("publisher", sa.String(length=255), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("url"),
    )
    op.create_table(
        "document_snapshots",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("source_id", sa.String(length=128), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("content_text", sa.Text(), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("previous_snapshot_id", sa.String(length=36), nullable=True),
        sa.ForeignKeyConstraint(["previous_snapshot_id"], ["document_snapshots.id"]),
        sa.ForeignKeyConstraint(["source_id"], ["sources.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_document_snapshots_content_hash",
        "document_snapshots",
        ["content_hash"],
    )
    op.create_index(
        "ix_document_snapshots_source_id",
        "document_snapshots",
        ["source_id"],
    )
    op.create_table(
        "ingestion_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("source_id", sa.String(length=128), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("change_type", sa.String(length=32), nullable=False),
        sa.Column("snapshot_id", sa.String(length=36), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["snapshot_id"], ["document_snapshots.id"]),
        sa.ForeignKeyConstraint(["source_id"], ["sources.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ingestion_runs_source_id", "ingestion_runs", ["source_id"])


def downgrade() -> None:
    op.drop_index("ix_ingestion_runs_source_id", table_name="ingestion_runs")
    op.drop_table("ingestion_runs")
    op.drop_index("ix_document_snapshots_source_id", table_name="document_snapshots")
    op.drop_index("ix_document_snapshots_content_hash", table_name="document_snapshots")
    op.drop_table("document_snapshots")
    op.drop_table("sources")
    op.drop_column("review_jobs", "evidence_json")
