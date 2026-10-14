"""Persist visitor entry requests separately from published knowledge."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261002_0024"
down_revision: str | None = "20260905_0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade():
    op.create_table(
        "entry_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("entity_type", sa.String(32), nullable=False),
        sa.Column("source_url", sa.String(2048), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", sa.String(128), nullable=True),
        sa.Column("reviewer_note", sa.Text(), nullable=True),
        sa.Column("entity_id", sa.String(128), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
    )
    op.create_index("ix_entry_requests_status", "entry_requests", ["status"])


def downgrade():
    op.drop_index("ix_entry_requests_status", table_name="entry_requests")
    op.drop_table("entry_requests")
