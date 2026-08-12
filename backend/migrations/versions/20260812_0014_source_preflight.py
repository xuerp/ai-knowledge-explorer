"""Persist source connection preflight results.

Revision ID: 20260812_0014
Revises: 20260809_0013
Create Date: 2026-08-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260812_0014"
down_revision: str | None = "20260809_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("sources", sa.Column("last_probe_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sources", sa.Column("last_probe_status", sa.String(length=16), nullable=True))
    op.add_column("sources", sa.Column("last_probe_error", sa.Text(), nullable=True))
    op.add_column(
        "sources",
        sa.Column("last_probe_content_type", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "sources",
        sa.Column("last_probe_readable_characters", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sources", "last_probe_readable_characters")
    op.drop_column("sources", "last_probe_content_type")
    op.drop_column("sources", "last_probe_error")
    op.drop_column("sources", "last_probe_status")
    op.drop_column("sources", "last_probe_at")
