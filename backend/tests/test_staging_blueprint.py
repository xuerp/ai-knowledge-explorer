from pathlib import Path

import yaml


def test_staging_blueprint_uses_paid_api_and_dedicated_worker() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    blueprint = yaml.safe_load((repository_root / "render.yaml").read_text(encoding="utf-8"))

    assert "databases" not in blueprint
    assert len(blueprint["services"]) == 2
    api, worker = blueprint["services"]
    assert api["type"] == "web"
    assert api["plan"] == "0.5c-512mb"
    assert api["branch"] == "codex/productionize"
    assert api["healthCheckPath"] == "/health"
    assert "preDeployCommand" not in api

    assert worker["type"] == "worker"
    assert worker["plan"] == "0.5c-512mb"
    assert worker["branch"] == "codex/productionize"
    assert worker["maxShutdownDelaySeconds"] == 300
    assert "app.worker --interval-seconds 300" in worker["dockerCommand"]
    worker_env = {item["key"]: item for item in worker["envVars"] if "key" in item}
    assert worker_env["AI_RADAR_SERVICE_ROLE"]["value"] == "worker"
    assert worker_env["AI_RADAR_DATABASE_URL"]["fromService"] == {
        "name": "ai-radar-api-staging",
        "type": "web",
        "envVarKey": "AI_RADAR_DATABASE_URL",
    }


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


def test_staging_worker_reuses_api_provider_configuration() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    blueprint = yaml.safe_load((repository_root / "render.yaml").read_text(encoding="utf-8"))
    worker = blueprint["services"][1]
    env_vars = {item["key"]: item for item in worker["envVars"] if "key" in item}

    for key in (
        "AI_RADAR_EXTRACTION_API_URL",
        "AI_RADAR_EXTRACTION_API_KEY",
        "AI_RADAR_EXTRACTION_MODEL",
        "AI_RADAR_EMAIL_API_KEY",
        "AI_RADAR_SMTP_FROM",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_API_TOKEN",
    ):
        assert env_vars[key]["fromService"] == {
            "name": "ai-radar-api-staging",
            "type": "web",
            "envVarKey": key,
        }


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
