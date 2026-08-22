"""Add resilient collection entrypoints and failure state.

Revision ID: 20260822_0017
Revises: 20260814_0016
Create Date: 2026-08-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260822_0017"
down_revision: str | None = "20260814_0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("sources", sa.Column("fetch_url", sa.String(length=2048), nullable=True))
    op.add_column(
        "sources",
        sa.Column("fallback_urls_json", sa.Text(), server_default="[]", nullable=False),
    )
    op.add_column(
        "sources",
        sa.Column("last_successful_fetch_url", sa.String(length=2048), nullable=True),
    )
    op.add_column("sources", sa.Column("failure_kind", sa.String(length=32), nullable=True))
    op.add_column(
        "sources",
        sa.Column("auto_paused_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sources", "auto_paused_at")
    op.drop_column("sources", "failure_kind")
    op.drop_column("sources", "last_successful_fetch_url")
    op.drop_column("sources", "fallback_urls_json")
    op.drop_column("sources", "fetch_url")
