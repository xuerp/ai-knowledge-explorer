"""Create the review gate and publication history.

Revision ID: 20260729_0001
Revises:
Create Date: 2026-07-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260729_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "review_jobs",
        sa.Column("id", sa.String(length=128), nullable=False),
        sa.Column("entity_id", sa.String(length=128), nullable=True),
        sa.Column("claim_id", sa.String(length=128), nullable=False),
        sa.Column("claim_json", sa.Text(), nullable=False),
        sa.Column("evidence_ids_json", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_reason", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_review_jobs_claim_id", "review_jobs", ["claim_id"])
    op.create_index("ix_review_jobs_status", "review_jobs", ["status"])
    op.create_table(
        "publication_history",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("review_job_id", sa.String(length=128), nullable=False),
        sa.Column("claim_id", sa.String(length=128), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor", sa.String(length=128), nullable=False),
        sa.ForeignKeyConstraint(["review_job_id"], ["review_jobs.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_publication_history_review_job_id",
        "publication_history",
        ["review_job_id"],
    )
    op.create_index(
        "ix_publication_history_claim_id",
        "publication_history",
        ["claim_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_publication_history_claim_id", table_name="publication_history")
    op.drop_index("ix_publication_history_review_job_id", table_name="publication_history")
    op.drop_table("publication_history")
    op.drop_index("ix_review_jobs_status", table_name="review_jobs")
    op.drop_index("ix_review_jobs_claim_id", table_name="review_jobs")
    op.drop_table("review_jobs")
