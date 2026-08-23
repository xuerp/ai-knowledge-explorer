"""增加可信 RAG 全文检索投影与研究诊断字段。

Revision ID: 20260824_0019
Revises: 20260823_0018
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260824_0019"
down_revision: str | None = "20260823_0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "research_records",
        sa.Column("citations_json", sa.Text(), server_default="[]", nullable=False),
    )
    op.add_column(
        "research_records",
        sa.Column("retrieval_mode", sa.String(length=32), server_default="lexical", nullable=False),
    )
    op.add_column(
        "research_records",
        sa.Column("answer_mode", sa.String(length=32), server_default="extractive", nullable=False),
    )
    op.add_column(
        "research_records",
        sa.Column("retrieval_diagnostics_json", sa.Text(), server_default="{}", nullable=False),
    )
    op.create_table(
        "rag_claim_documents",
        sa.Column("claim_id", sa.String(length=128), nullable=False),
        sa.Column("entity_id", sa.String(length=128), nullable=False),
        sa.Column("claim_json", sa.Text(), nullable=False),
        sa.Column("evidence_json", sa.Text(), nullable=False),
        sa.Column("search_text", sa.Text(), nullable=False),
        sa.Column(
            "lifecycle_status", sa.String(length=32), server_default="current", nullable=False
        ),
        sa.Column("valid_from", sa.String(length=32), nullable=True),
        sa.Column("valid_to", sa.String(length=32), nullable=True),
        sa.Column("source_published_at", sa.String(length=32), nullable=True),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("claim_id"),
    )
    op.create_index("ix_rag_claim_documents_entity_id", "rag_claim_documents", ["entity_id"])
    op.create_index(
        "ix_rag_claim_documents_lifecycle_status",
        "rag_claim_documents",
        ["lifecycle_status"],
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            "CREATE INDEX ix_rag_claim_documents_search_fts "
            "ON rag_claim_documents USING gin (to_tsvector('simple', search_text))"
        )


def downgrade() -> None:
    op.drop_table("rag_claim_documents")
    op.drop_column("research_records", "retrieval_diagnostics_json")
    op.drop_column("research_records", "answer_mode")
    op.drop_column("research_records", "retrieval_mode")
    op.drop_column("research_records", "citations_json")
