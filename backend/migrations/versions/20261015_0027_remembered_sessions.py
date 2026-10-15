"""Opt-in, revocable remembered logins; no passwords or raw tokens stored."""

import sqlalchemy as sa
from alembic import op

revision = "20261015_0027"
down_revision = "20261013_0026"
branch_labels = None
depends_on = None


def upgrade():
    if "remembered_sessions" not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            "remembered_sessions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_remembered_sessions_user_id", "remembered_sessions", ["user_id"])


def downgrade():
    op.drop_index("ix_remembered_sessions_user_id", table_name="remembered_sessions")
    op.drop_table("remembered_sessions")
