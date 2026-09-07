"""Persist structured decision inputs and outputs.

Revision ID: 20260905_0023
Revises: 20260901_0022
Create Date: 2026-09-05
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260905_0023"
down_revision: str | None = "20260901_0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "research_records",
        sa.Column("decision_context_json", sa.Text(), nullable=False, server_default="null"),
    )
    op.add_column(
        "research_records",
        sa.Column("decision_json", sa.Text(), nullable=False, server_default="null"),
    )


def downgrade() -> None:
    op.drop_column("research_records", "decision_json")
    op.drop_column("research_records", "decision_context_json")
