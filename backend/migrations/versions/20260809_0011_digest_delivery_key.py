"""Add an idempotency key for scheduled digest delivery.

Revision ID: 20260809_0011
Revises: 20260731_0010
Create Date: 2026-08-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260809_0011"
down_revision: str | None = "20260731_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "email_outbox",
        sa.Column("delivery_key", sa.String(length=160), nullable=True),
    )
    op.create_index(
        "ix_email_outbox_delivery_key",
        "email_outbox",
        ["delivery_key"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_email_outbox_delivery_key", table_name="email_outbox")
    op.drop_column("email_outbox", "delivery_key")
