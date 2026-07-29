"""Add editorial guides to model-family entities.

Revision ID: 20260729_0009
Revises: 20260729_0008
Create Date: 2026-07-29
"""

import json
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

import sqlalchemy as sa
from alembic import op

revision: str = "20260729_0009"
down_revision: str | None = "20260729_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MODEL_FAMILY_IDS = {
    "e-gpt",
    "e-claude",
    "e-gemini",
    "e-deepseek",
    "e-qwen",
    "e-kimi",
    "e-doubao",
    "e-ernie",
}


def _seed_snapshot() -> dict:
    snapshot_path = Path(__file__).resolve().parents[2] / "data" / "demo_snapshot.json"
    return json.loads(snapshot_path.read_text(encoding="utf-8"))


def upgrade() -> None:
    snapshot = _seed_snapshot()
    connection = op.get_bind()
    updated_at = datetime.now(UTC)

    for entity in snapshot["entities"]:
        if entity["id"] not in MODEL_FAMILY_IDS:
            continue
        connection.execute(
            sa.text(
                """
                UPDATE knowledge_entities
                SET payload_json = :payload_json, updated_at = :updated_at
                WHERE id = :entity_id
                """
            ),
            {
                "entity_id": entity["id"],
                "payload_json": json.dumps(entity, ensure_ascii=False, separators=(",", ":")),
                "updated_at": updated_at,
            },
        )


def downgrade() -> None:
    # Editorial payload upgrades are intentionally retained; the schema remains compatible.
    pass
