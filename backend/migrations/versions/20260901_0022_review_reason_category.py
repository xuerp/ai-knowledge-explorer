"""Add structured review rejection reason category.

Revision ID: 20260901_0022
Revises: 20260831_0021
Create Date: 2026-09-01
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260901_0022"
down_revision: str | None = "20260831_0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "review_jobs",
        sa.Column("reason_category", sa.String(length=32), nullable=True),
    )
    op.create_index(
        "ix_review_jobs_reason_category",
        "review_jobs",
        ["reason_category"],
    )


def downgrade() -> None:
    op.drop_index("ix_review_jobs_reason_category", table_name="review_jobs")
    op.drop_column("review_jobs", "reason_category")
