"""Add normalized entity aliases.

Revision ID: 20260831_0020
Revises: 20260824_0019
Create Date: 2026-08-31
"""

from __future__ import annotations

import json
import unicodedata
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260831_0020"
down_revision: str | None = "20260824_0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _alias_key(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold().replace("_", " ")
    return " ".join(normalized.split())


def upgrade() -> None:
    op.create_table(
        "entity_alias",
        sa.Column("entity_id", sa.String(length=128), nullable=False),
        sa.Column("alias_key", sa.String(length=255), nullable=False),
        sa.Column("alias", sa.String(length=255), nullable=False),
        sa.Column("alias_type", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(["entity_id"], ["knowledge_entities.id"]),
        sa.PrimaryKeyConstraint("entity_id", "alias_key"),
    )
    op.create_index("ix_entity_alias_alias_key", "entity_alias", ["alias_key"])
    op.create_index("ix_entity_alias_alias_type", "entity_alias", ["alias_type"])

    connection = op.get_bind()
    alias_table = sa.table(
        "entity_alias",
        sa.column("entity_id", sa.String()),
        sa.column("alias_key", sa.String()),
        sa.column("alias", sa.String()),
        sa.column("alias_type", sa.String()),
    )
    rows = connection.execute(sa.text("SELECT id, payload_json FROM knowledge_entities")).all()
    aliases = []
    for entity_id, payload_json in rows:
        try:
            values = json.loads(payload_json).get("aliases") or []
        except (TypeError, json.JSONDecodeError):
            values = []
        seen: set[str] = set()
        for value in values:
            alias = str(value).strip()
            alias_key = _alias_key(alias)
            if not alias_key or alias_key in seen:
                continue
            seen.add(alias_key)
            aliases.append(
                {
                    "entity_id": entity_id,
                    "alias_key": alias_key,
                    "alias": alias,
                    "alias_type": "other",
                }
            )
    if aliases:
        op.bulk_insert(alias_table, aliases)


def downgrade() -> None:
    op.drop_index("ix_entity_alias_alias_type", table_name="entity_alias")
    op.drop_index("ix_entity_alias_alias_key", table_name="entity_alias")
    op.drop_table("entity_alias")
