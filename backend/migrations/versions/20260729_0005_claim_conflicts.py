"""Add structured conflict references to review jobs.

Revision ID: 20260729_0005
Revises: 20260729_0004
Create Date: 2026-07-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260729_0005"
down_revision: str | None = "20260729_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "review_jobs",
        sa.Column(
            "conflict_ids_json",
            sa.Text(),
            server_default="[]",
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("review_jobs", "conflict_ids_json")
