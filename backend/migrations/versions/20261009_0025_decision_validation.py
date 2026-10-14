"""Private decision validation notes, separate from research and public facts."""

import sqlalchemy as sa
from alembic import op

revision = "20261009_0025"
down_revision = "20261002_0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "decision_validations" not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            "decision_validations",
            sa.Column(
                "research_id", sa.String(36), sa.ForeignKey("research_records.id"), primary_key=True
            ),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("items_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_decision_validations_user_id", "decision_validations", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_decision_validations_user_id", table_name="decision_validations")
    op.drop_table("decision_validations")
