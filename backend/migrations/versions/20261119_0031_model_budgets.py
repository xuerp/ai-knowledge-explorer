"""Durable bounded model generation spending and receipts."""

import sqlalchemy as sa
from alembic import op

revision = "20261119_0031"
down_revision = "20261110_0030"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "model_budgets",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("profile_sha256", sa.String(64), nullable=False),
        sa.Column("limit_units", sa.Integer(), nullable=False),
        sa.Column("charged_units", sa.Integer(), nullable=False),
        sa.Column("used_calls", sa.Integer(), nullable=False),
        sa.Column("blocked", sa.Boolean(), nullable=False),
        sa.Column("active_attempt_id", sa.String(36)),
        sa.CheckConstraint(
            "charged_units >= 0 AND charged_units <= limit_units", name="ck_model_budget_amount"
        ),
    )
    op.create_table(
        "model_calls",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("budget_id", sa.String(64), sa.ForeignKey("model_budgets.id"), nullable=False),
        sa.Column("user_id", sa.String(128), nullable=False),
        sa.Column("purpose", sa.String(32), nullable=False),
        sa.Column("reserved_units", sa.Integer(), nullable=False),
        sa.Column("charged_units", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(32), nullable=False),
        sa.Column("receipt_json", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_model_calls_account_day", "model_calls", ["budget_id", "user_id", "created_at"]
    )


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM model_calls")):
        raise RuntimeError("Retain model billing receipts; use a forward application rollback.")
    op.drop_table("model_calls")
    op.drop_table("model_budgets")
