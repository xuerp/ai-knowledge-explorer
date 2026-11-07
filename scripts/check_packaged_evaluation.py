"""Verify evaluation and archive resources through their runtime reader, without a database."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))

from app.config import Settings
from app.schemas import KnowledgeSnapshot
from app.services.catalog import CatalogServices


def main() -> None:
    root = Path.cwd()
    services = CatalogServices()
    services.app_settings = Settings(
        database_url="sqlite://",
        seed_snapshot_path=root / "data/demo_snapshot.json",
        quality_evaluation_path=root / "data/quality_evaluation.json",
        admin_token=None,
        cors_origins=(),
    )
    snapshot = KnowledgeSnapshot.model_validate_json(
        services.app_settings.seed_snapshot_path.read_bytes()
    )
    active = services.evaluation_quality_metrics(snapshot)
    history = services.evaluation_quality_history(snapshot)
    if not any(item.golden_set_version == "1.0.0" and item.sample_count == 80 for item in history):
        raise RuntimeError("The runtime image is missing the preserved 80-question evaluation.")
    print(
        json.dumps(
            {
                "activeVersion": active.golden_set_version,
                "activeSamples": active.sample_count,
                "archivedVersions": [item.golden_set_version for item in history],
            }
        )
    )


if __name__ == "__main__":
    main()
