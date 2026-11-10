"""Invalidate every session after account administration changes."""

import sqlalchemy as sa
from alembic import op

revision = "20261110_0030"
down_revision = "20261023_0029"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "users", sa.Column("session_version", sa.Integer(), nullable=False, server_default="0")
    )


def downgrade():
    # Old JWTs must not become valid again when the version check disappears.
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM users WHERE session_version > 0")):
        raise RuntimeError("Account session revocations prevent a safe downgrade.")
    op.drop_column("users", "session_version")
