"""增加事实生命周期、证据合并和替代事实所需的审核元数据。

Revision ID: 20260823_0018
Revises: 20260822_0017
Create Date: 2026-08-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260823_0018"
down_revision: str | None = "20260822_0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "review_jobs",
        sa.Column(
            "lifecycle_status", sa.String(length=32), server_default="current", nullable=False
        ),
    )
    op.add_column(
        "review_jobs",
        sa.Column("publication_action", sa.String(length=32), server_default="new", nullable=False),
    )
    op.add_column(
        "review_jobs", sa.Column("target_review_job_id", sa.String(length=128), nullable=True)
    )
    op.add_column("review_jobs", sa.Column("target_claim_id", sa.String(length=128), nullable=True))
    op.add_column(
        "review_jobs", sa.Column("superseded_by_claim_id", sa.String(length=128), nullable=True)
    )
    op.add_column(
        "review_jobs",
        sa.Column("decision_idempotency_key", sa.String(length=128), nullable=True),
    )
    op.create_index("ix_review_jobs_lifecycle_status", "review_jobs", ["lifecycle_status"])
    op.create_index("ix_review_jobs_publication_action", "review_jobs", ["publication_action"])
    op.create_index("ix_review_jobs_target_review_job_id", "review_jobs", ["target_review_job_id"])
    op.create_index(
        "ux_review_jobs_decision_idempotency_key",
        "review_jobs",
        ["decision_idempotency_key"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ux_review_jobs_decision_idempotency_key", table_name="review_jobs")
    op.drop_index("ix_review_jobs_target_review_job_id", table_name="review_jobs")
    op.drop_index("ix_review_jobs_publication_action", table_name="review_jobs")
    op.drop_index("ix_review_jobs_lifecycle_status", table_name="review_jobs")
    op.drop_column("review_jobs", "decision_idempotency_key")
    op.drop_column("review_jobs", "superseded_by_claim_id")
    op.drop_column("review_jobs", "target_claim_id")
    op.drop_column("review_jobs", "target_review_job_id")
    op.drop_column("review_jobs", "publication_action")
    op.drop_column("review_jobs", "lifecycle_status")
