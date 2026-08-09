from pathlib import Path

import yaml


def test_staging_blueprint_uses_only_a_free_render_web_service() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    blueprint = yaml.safe_load((repository_root / "render.yaml").read_text(encoding="utf-8"))

    assert "databases" not in blueprint
    assert len(blueprint["services"]) == 1
    service = blueprint["services"][0]
    assert service["type"] == "web"
    assert service["plan"] == "free"
    assert service["branch"] == "codex/productionize"
    assert "preDeployCommand" not in service
    assert "maxShutdownDelaySeconds" not in service


def test_staging_blueprint_requests_neon_url_as_a_secret() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    blueprint = yaml.safe_load((repository_root / "render.yaml").read_text(encoding="utf-8"))
    env_vars = {item["key"]: item for item in blueprint["services"][0]["envVars"] if "key" in item}

    assert env_vars["AI_RADAR_DATABASE_URL"] == {
        "key": "AI_RADAR_DATABASE_URL",
        "sync": False,
    }
    assert env_vars["AI_RADAR_JWT_SECRET"]["generateValue"] is True
    assert env_vars["PORT"]["value"] == "8000"
