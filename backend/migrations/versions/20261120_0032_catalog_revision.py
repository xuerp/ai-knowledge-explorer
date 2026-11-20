"""Track public catalog changes transactionally across workers."""

import sqlalchemy as sa
from alembic import op

from app.catalog_revision import CATALOG_TABLES, install_revision_triggers

revision = "20261120_0032"
down_revision = "20261119_0031"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "catalog_revision",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
    )
    install_revision_triggers(op.get_bind())


def downgrade():
    connection = op.get_bind()
    for table in CATALOG_TABLES:
        if connection.dialect.name == "sqlite":
            for action in ("insert", "update", "delete"):
                connection.execute(sa.text(f"DROP TRIGGER catalog_revision_{table}_{action}"))
        else:
            connection.execute(sa.text(f"DROP TRIGGER catalog_revision_{table} ON {table}"))
    if connection.dialect.name != "sqlite":
        connection.execute(sa.text("DROP FUNCTION bump_catalog_revision()"))
    op.drop_table("catalog_revision")
