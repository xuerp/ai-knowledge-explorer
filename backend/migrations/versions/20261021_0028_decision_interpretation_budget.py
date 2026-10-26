"""Persistent, non-renewing authorization budgets for task interpretation."""

import sqlalchemy as sa
from alembic import op

revision = "20261021_0028"
down_revision = "20261015_0027"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "decision_interpretation_budgets",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("profile_sha256", sa.String(64), nullable=False),
        sa.Column("limit_calls", sa.Integer(), nullable=False),
        sa.Column("used_calls", sa.Integer(), nullable=False),
        sa.Column("known_tokens", sa.Integer(), nullable=False),
        sa.Column("unknown_usage_calls", sa.Integer(), nullable=False),
        sa.Column("blocked", sa.Boolean(), nullable=False),
        sa.Column("active_attempt_id", sa.String(36), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "used_calls >= 0 AND used_calls <= limit_calls", name="ck_decision_budget_calls"
        ),
    )


def downgrade():
    if op.get_bind().scalar(
        sa.text("SELECT count(*) FROM decision_interpretation_budgets WHERE used_calls > 0")
    ):
        raise RuntimeError("Spent interpretation budgets must be preserved during rollback.")
    op.drop_table("decision_interpretation_budgets")
