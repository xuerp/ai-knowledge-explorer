"""Persist the public knowledge catalog.

Revision ID: 20260729_0007
Revises: 20260729_0006
Create Date: 2026-07-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260729_0007"
down_revision: str | None = "20260729_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "knowledge_entities",
        sa.Column("id", sa.String(length=128), nullable=False),
        sa.Column("entity_type", sa.String(length=32), nullable=False),
        sa.Column("slug", sa.String(length=255), nullable=False),
        sa.Column("family_id", sa.String(length=128), nullable=True),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["family_id"], ["knowledge_entities.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_knowledge_entities_entity_type", "knowledge_entities", ["entity_type"])
    op.create_index("ix_knowledge_entities_family_id", "knowledge_entities", ["family_id"])
    op.create_index("ix_knowledge_entities_slug", "knowledge_entities", ["slug"], unique=True)

    op.create_table(
        "knowledge_relations",
        sa.Column("id", sa.String(length=128), nullable=False),
        sa.Column("from_id", sa.String(length=128), nullable=False),
        sa.Column("to_id", sa.String(length=128), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["from_id"], ["knowledge_entities.id"]),
        sa.ForeignKeyConstraint(["to_id"], ["knowledge_entities.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_knowledge_relations_from_id", "knowledge_relations", ["from_id"])
    op.create_index("ix_knowledge_relations_kind", "knowledge_relations", ["kind"])
    op.create_index("ix_knowledge_relations_to_id", "knowledge_relations", ["to_id"])

    op.create_table(
        "knowledge_timeline",
        sa.Column("id", sa.String(length=128), nullable=False),
        sa.Column("entity_id", sa.String(length=128), nullable=False),
        sa.Column("event_date", sa.String(length=10), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["entity_id"], ["knowledge_entities.id"]),
        sa.PrimaryKeyConstraint("id", "entity_id"),
    )
    op.create_index("ix_knowledge_timeline_entity_id", "knowledge_timeline", ["entity_id"])
    op.create_index("ix_knowledge_timeline_event_date", "knowledge_timeline", ["event_date"])


def downgrade() -> None:
    op.drop_index("ix_knowledge_timeline_event_date", table_name="knowledge_timeline")
    op.drop_index("ix_knowledge_timeline_entity_id", table_name="knowledge_timeline")
    op.drop_table("knowledge_timeline")
    op.drop_index("ix_knowledge_relations_to_id", table_name="knowledge_relations")
    op.drop_index("ix_knowledge_relations_kind", table_name="knowledge_relations")
    op.drop_index("ix_knowledge_relations_from_id", table_name="knowledge_relations")
    op.drop_table("knowledge_relations")
    op.drop_index("ix_knowledge_entities_slug", table_name="knowledge_entities")
    op.drop_index("ix_knowledge_entities_family_id", table_name="knowledge_entities")
    op.drop_index("ix_knowledge_entities_entity_type", table_name="knowledge_entities")
    op.drop_table("knowledge_entities")
