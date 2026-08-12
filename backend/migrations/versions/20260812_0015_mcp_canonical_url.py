"""Update the MCP source to its canonical versioned URL.

Revision ID: 20260812_0015
Revises: 20260812_0014
Create Date: 2026-08-12
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260812_0015"
down_revision: str | None = "20260812_0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_URL = "https://modelcontextprotocol.io/docs/learn/architecture"
CANONICAL_URL = "https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture"


def upgrade() -> None:
    op.execute(
        "UPDATE sources "
        f"SET url = '{CANONICAL_URL}', last_probe_at = NULL, last_probe_status = NULL, "
        "last_probe_error = NULL, last_probe_content_type = NULL, "
        "last_probe_readable_characters = NULL "
        "WHERE id = 's-mcp-architecture'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE sources "
        f"SET url = '{OLD_URL}', last_probe_at = NULL, last_probe_status = NULL, "
        "last_probe_error = NULL, last_probe_content_type = NULL, "
        "last_probe_readable_characters = NULL "
        "WHERE id = 's-mcp-architecture'"
    )
