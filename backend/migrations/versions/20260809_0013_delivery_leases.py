"""Add fencing leases for source collection and email delivery.

Revision ID: 20260809_0013
Revises: 20260809_0012
Create Date: 2026-08-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260809_0013"
down_revision: str | None = "20260809_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("sources", sa.Column("fetch_lease_token", sa.String(length=36), nullable=True))
    op.add_column(
        "sources",
        sa.Column("fetch_lease_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_sources_fetch_lease_expires_at",
        "sources",
        ["fetch_lease_expires_at"],
    )

    op.add_column(
        "email_outbox",
        sa.Column("delivery_lease_token", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "email_outbox",
        sa.Column("delivery_lease_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_email_outbox_lease_expires_at",
        "email_outbox",
        ["delivery_lease_expires_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_email_outbox_lease_expires_at", table_name="email_outbox")
    op.drop_column("email_outbox", "delivery_lease_expires_at")
    op.drop_column("email_outbox", "delivery_lease_token")
    op.drop_index("ix_sources_fetch_lease_expires_at", table_name="sources")
    op.drop_column("sources", "fetch_lease_expires_at")
    op.drop_column("sources", "fetch_lease_token")
