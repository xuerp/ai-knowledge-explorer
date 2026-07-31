"""Add concrete Kimi, Doubao and ERNIE releases.

Revision ID: 20260731_0010
Revises: 20260729_0009
Create Date: 2026-07-31
"""

import json
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

import sqlalchemy as sa
from alembic import op

revision: str = "20260731_0010"
down_revision: str | None = "20260729_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEW_ENTITY_IDS = {
    "e-kimi-k26",
    "e-kimi-k3",
    "e-doubao-seed18",
    "e-doubao-seed20-pro",
    "e-ernie-45",
    "e-ernie-50",
    "e-ernie-51",
}

NEW_RELATION_IDS = {f"r{index}" for index in range(45, 58)}


def _seed_snapshot() -> dict:
    snapshot_path = Path(__file__).resolve().parents[2] / "data" / "demo_snapshot.json"
    return json.loads(snapshot_path.read_text(encoding="utf-8"))


def upgrade() -> None:
    connection = op.get_bind()
    has_catalog = connection.scalar(sa.text("SELECT id FROM knowledge_entities LIMIT 1"))
    if not has_catalog:
        # A fresh application seeds the complete catalog after migrations.
        return

    snapshot = _seed_snapshot()
    updated_at = datetime.now(UTC)

    for entity in snapshot["entities"]:
        if entity["id"] not in NEW_ENTITY_IDS:
            continue
        exists = connection.scalar(
            sa.text("SELECT 1 FROM knowledge_entities WHERE id = :entity_id"),
            {"entity_id": entity["id"]},
        )
        if exists:
            continue
        connection.execute(
            sa.text(
                """
                INSERT INTO knowledge_entities
                    (id, entity_type, slug, family_id, payload_json, updated_at)
                VALUES
                    (:id, :entity_type, :slug, :family_id, :payload_json, :updated_at)
                """
            ),
            {
                "id": entity["id"],
                "entity_type": entity["type"],
                "slug": entity["slug"],
                "family_id": entity.get("familyId"),
                "payload_json": json.dumps(entity, ensure_ascii=False, separators=(",", ":")),
                "updated_at": updated_at,
            },
        )

    for entity_id in NEW_ENTITY_IDS:
        for entry in snapshot["timeline"].get(entity_id, []):
            connection.execute(
                sa.text(
                    """
                    INSERT INTO knowledge_timeline
                        (id, entity_id, event_date, payload_json, updated_at)
                    VALUES
                        (:id, :entity_id, :event_date, :payload_json, :updated_at)
                    """
                ),
                {
                    "id": entry["id"],
                    "entity_id": entity_id,
                    "event_date": entry["date"],
                    "payload_json": json.dumps(entry, ensure_ascii=False, separators=(",", ":")),
                    "updated_at": updated_at,
                },
            )

    for relation in snapshot["graph"]["edges"]:
        if relation["id"] not in NEW_RELATION_IDS:
            continue
        connection.execute(
            sa.text(
                """
                INSERT INTO knowledge_relations
                    (id, from_id, to_id, kind, payload_json, updated_at)
                VALUES
                    (:id, :from_id, :to_id, :kind, :payload_json, :updated_at)
                """
            ),
            {
                "id": relation["id"],
                "from_id": relation["fromId"],
                "to_id": relation["toId"],
                "kind": relation["kind"],
                "payload_json": json.dumps(
                    relation,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
                "updated_at": updated_at,
            },
        )


def downgrade() -> None:
    # Catalog additions are intentionally retained so external references remain valid.
    pass
