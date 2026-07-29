"""Add secure source scheduling metadata.

Revision ID: 20260729_0004
Revises: 20260729_0003
Create Date: 2026-07-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260729_0004"
down_revision: str | None = "20260729_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "sources",
        sa.Column("fetch_enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        "sources",
        sa.Column(
            "fetch_interval_minutes",
            sa.Integer(),
            server_default="240",
            nullable=False,
        ),
    )
    op.add_column(
        "sources",
        sa.Column("next_fetch_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("sources", sa.Column("etag", sa.String(length=512), nullable=True))
    op.add_column(
        "sources",
        sa.Column("last_modified", sa.String(length=512), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sources", "last_modified")
    op.drop_column("sources", "etag")
    op.drop_column("sources", "next_fetch_at")
    op.drop_column("sources", "fetch_interval_minutes")
    op.drop_column("sources", "fetch_enabled")
