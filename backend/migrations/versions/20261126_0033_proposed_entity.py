"""Carry a proposed new model entity with its release candidate until review."""

import sqlalchemy as sa
from alembic import op

revision = "20261126_0033"
down_revision = "20261120_0032"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("review_jobs", sa.Column("proposed_entity_json", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("review_jobs", "proposed_entity_json")
