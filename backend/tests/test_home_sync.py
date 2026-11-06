import json
from pathlib import Path

from app.home_overview import build_home_overview
from app.schemas import KnowledgeSnapshot


def test_home_catalog_date_matches_generated_public_data_and_not_retrieval_time():
    generated = Path(__file__).resolve().parents[2] / "src/data/generated"
    snapshot = KnowledgeSnapshot.model_validate_json(
        (generated / "snapshot.json").read_text(encoding="utf-8")
    )
    expected = json.loads((generated / "home-overview.json").read_text(encoding="utf-8"))
    snapshot.meta.retrieved_at = "2099-01-01T00:00:00Z"
    home = build_home_overview(snapshot)
    assert home.catalog_updated_at == expected["catalogUpdatedAt"]
    assert home.catalog_updated_at != home.meta.retrieved_at[:10]


def test_empty_catalog_has_no_fabricated_content_update_date():
    generated = Path(__file__).resolve().parents[2] / "src/data/generated/snapshot.json"
    snapshot = KnowledgeSnapshot.model_validate_json(generated.read_text(encoding="utf-8"))
    snapshot.entities = []
    snapshot.claims = []
    snapshot.evidence = []
    home = build_home_overview(snapshot)
    assert home.catalog_updated_at is None
    assert home.entity_count == home.claim_count == 0
