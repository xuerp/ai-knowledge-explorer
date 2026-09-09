"""Add versioned RAG claim embeddings.

Revision ID: 20260831_0021
Revises: 20260831_0020
Create Date: 2026-08-31
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260831_0021"
down_revision: str | None = "20260831_0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "rag_claim_embeddings",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("claim_id", sa.String(length=128), nullable=False),
        sa.Column("embedding_provider", sa.String(length=64), nullable=False),
        sa.Column("embedding_model", sa.String(length=255), nullable=False),
        sa.Column("embedding_version", sa.String(length=255), nullable=False),
        sa.Column("embedding_dimension", sa.Integer(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("vector_json", sa.Text(), nullable=False),
        sa.Column("embedded_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "embedding_dimension > 0",
            name="ck_rag_claim_embeddings_positive_dimension",
        ),
        sa.ForeignKeyConstraint(
            ["claim_id"],
            ["rag_claim_documents.claim_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "claim_id",
            "embedding_provider",
            "embedding_model",
            "embedding_version",
            name="uq_rag_claim_embedding_version",
        ),
    )
    op.create_index(
        "ix_rag_claim_embeddings_model_version",
        "rag_claim_embeddings",
        ["embedding_provider", "embedding_model", "embedding_version"],
    )
    op.create_index(
        "ix_rag_claim_embeddings_content_hash",
        "rag_claim_embeddings",
        ["content_hash"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_rag_claim_embeddings_content_hash",
        table_name="rag_claim_embeddings",
    )
    op.drop_index(
        "ix_rag_claim_embeddings_model_version",
        table_name="rag_claim_embeddings",
    )
    op.drop_table("rag_claim_embeddings")
