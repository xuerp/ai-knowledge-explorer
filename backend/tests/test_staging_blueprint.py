import json
from pathlib import Path

import yaml


def test_staging_blueprint_uses_one_free_api_service() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    blueprint = yaml.safe_load((repository_root / "render.yaml").read_text(encoding="utf-8"))

    assert "databases" not in blueprint
    assert len(blueprint["services"]) == 1
    (api,) = blueprint["services"]
    assert api["type"] == "web"
    assert api["plan"] == "free"
    assert api["branch"] == "codex/productionize"
    assert api["healthCheckPath"] == "/health"
    assert "preDeployCommand" not in api


def test_staging_blueprint_requests_neon_url_as_a_secret() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    blueprint = yaml.safe_load((repository_root / "render.yaml").read_text(encoding="utf-8"))
    env_vars = {item["key"]: item for item in blueprint["services"][0]["envVars"] if "key" in item}

    assert env_vars["AI_RADAR_DATABASE_URL"] == {
        "key": "AI_RADAR_DATABASE_URL",
        "sync": False,
    }
    assert env_vars["AI_RADAR_JWT_SECRET"]["generateValue"] is True
    assert env_vars["CLOUDFLARE_ACCOUNT_ID"] == {
        "key": "CLOUDFLARE_ACCOUNT_ID",
        "sync": False,
    }
    assert env_vars["CLOUDFLARE_API_TOKEN"] == {
        "key": "CLOUDFLARE_API_TOKEN",
        "sync": False,
    }
    assert env_vars["PORT"]["value"] == "8000"


def test_github_manual_automation_fallback_runs_directly_against_database() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    workflow = (repository_root / ".github" / "workflows" / "automation.yml").read_text(
        encoding="utf-8"
    )

    assert "workflow_dispatch:" in workflow
    assert "schedule:" not in workflow
    assert "cron:" not in workflow
    assert "AI_RADAR_DATABASE_URL: ${{ secrets.AI_RADAR_DATABASE_URL }}" in workflow
    assert "app.worker --scheduled-once --next-cycle-seconds 1800" in workflow
    assert "/api/v2/automation/run-cycle" not in workflow
    assert "curl " not in workflow


def test_cloudflare_cron_is_the_primary_automation_schedule() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    cron_root = repository_root / "ops" / "cloudflare-cron"
    config = json.loads((cron_root / "wrangler.json").read_text(encoding="utf-8"))
    worker = (cron_root / "worker.mjs").read_text(encoding="utf-8")

    assert config["triggers"]["crons"] == ["*/30 * * * *"]
    assert "/api/v2/automation/run-cycle" in worker
    assert '"X-Automation-Token"' in worker


def test_staging_blueprint_enables_guarded_cloudflare_hybrid() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    blueprint = yaml.safe_load((repository_root / "render.yaml").read_text(encoding="utf-8"))
    group = next(
        item for item in blueprint["envVarGroups"] if item["name"] == "ai-radar-staging-runtime"
    )
    env_vars = {item["key"]: item["value"] for item in group["envVars"]}

    assert env_vars["AI_RADAR_RETRIEVAL_MODE"] == "hybrid"
    assert env_vars["AI_RADAR_EMBEDDING_PROVIDER"] == "cloudflare"
    assert env_vars["AI_RADAR_EMBEDDING_MODEL"] == "@cf/baai/bge-m3"
    assert int(env_vars["AI_RADAR_EMBEDDING_DAILY_NEURON_BUDGET"]) <= 1000
    assert int(env_vars["AI_RADAR_EMBEDDING_DAILY_API_CALL_BUDGET"]) <= 1000


def test_container_liveness_does_not_depend_on_database_readiness() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    dockerfile = (repository_root / "backend" / "Dockerfile").read_text(encoding="utf-8")

    healthcheck = dockerfile.split("HEALTHCHECK", 1)[1].split("\n\n", 1)[0]
    assert "/health" in healthcheck
    assert "/ready" not in healthcheck
