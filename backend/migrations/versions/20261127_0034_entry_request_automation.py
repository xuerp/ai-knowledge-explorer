"""Record the automatic handling of entry requests: kind, attempts and outcome."""

import sqlalchemy as sa
from alembic import op

revision = "20261127_0034"
down_revision = "20261126_0033"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("entry_requests") as batch:
        batch.add_column(sa.Column("auto_state", sa.String(32), nullable=True))
        batch.add_column(sa.Column("auto_detail", sa.Text(), nullable=True))
        batch.add_column(
            sa.Column("auto_attempts", sa.Integer(), nullable=False, server_default="0")
        )
        batch.add_column(sa.Column("auto_attempted_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("candidate_ids_json", sa.Text(), nullable=True))


def downgrade():
    with op.batch_alter_table("entry_requests") as batch:
        for name in (
            "candidate_ids_json",
            "auto_attempted_at",
            "auto_attempts",
            "auto_detail",
            "auto_state",
        ):
            batch.drop_column(name)
