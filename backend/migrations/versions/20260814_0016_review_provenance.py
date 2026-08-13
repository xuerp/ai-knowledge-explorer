"""记录审核决定的执行者，区分人工核验与自动批准。

Revision ID: 20260814_0016
Revises: 20260812_0015
Create Date: 2026-08-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260814_0016"
down_revision: str | None = "20260812_0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "review_jobs",
        sa.Column("reviewed_by", sa.String(length=128), nullable=True),
    )
    op.execute(
        "UPDATE review_jobs SET reviewed_by = ("
        "SELECT publication_history.actor FROM publication_history "
        "WHERE publication_history.review_job_id = review_jobs.id "
        "ORDER BY publication_history.id DESC LIMIT 1"
        ") WHERE reviewed_at IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_column("review_jobs", "reviewed_by")
