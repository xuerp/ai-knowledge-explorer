"""Revoke individual access tokens, including short and pre-jti JWTs."""

import sqlalchemy as sa
from alembic import op

revision = "20261023_0029"
down_revision = "20261021_0028"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "revoked_access_tokens",
        sa.Column("fingerprint", sa.String(64), primary_key=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_revoked_access_tokens_expires_at", "revoked_access_tokens", ["expires_at"])


def downgrade():
    if op.get_bind().scalar(
        sa.text("SELECT count(*) FROM revoked_access_tokens WHERE expires_at > CURRENT_TIMESTAMP")
    ):
        raise RuntimeError("Active logout revocations must expire before downgrade.")
    op.drop_index("ix_revoked_access_tokens_expires_at", table_name="revoked_access_tokens")
    op.drop_table("revoked_access_tokens")
