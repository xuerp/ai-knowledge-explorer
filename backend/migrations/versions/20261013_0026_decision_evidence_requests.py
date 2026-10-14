"""Private owner links to public-object evidence maintenance requests."""

import sqlalchemy as sa
from alembic import op

revision = "20261013_0026"
down_revision = "20261009_0025"
branch_labels = None
depends_on = None


def upgrade():
    if "decision_evidence_requests" not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            "decision_evidence_requests",
            sa.Column("id", sa.String(36), sa.ForeignKey("entry_requests.id"), primary_key=True),
            sa.Column(
                "research_id", sa.String(36), sa.ForeignKey("research_records.id"), nullable=False
            ),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("candidate_id", sa.String(128), nullable=False),
            sa.Column("dimensions_json", sa.Text(), nullable=False),
            sa.UniqueConstraint(
                "research_id", "candidate_id", name="uq_decision_evidence_candidate"
            ),
        )
        op.create_index(
            "ix_decision_evidence_requests_user_id", "decision_evidence_requests", ["user_id"]
        )


def downgrade():
    op.drop_index("ix_decision_evidence_requests_user_id", table_name="decision_evidence_requests")
    op.drop_table("decision_evidence_requests")
