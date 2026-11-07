"""Manually authorized inference only; never connects to the application database."""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.evaluation_scope import corpus_fingerprint, retrieval_implementation_fingerprint
from app.schemas import KnowledgeSnapshot


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--allow-external-api", action="store_true")
    if not parser.parse_args().allow_external_api:
        raise SystemExit("Explicit --allow-external-api authorization is required.")
    output = ROOT / "artifacts/retrieval-v2-hybrid"
    output.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=60) as client:
        response = client.get("https://ai-radar.xue-ai.workers.dev/backend/api/quality/metrics")
        response.raise_for_status()
        runtime = response.json()
        (output / "runtime-scope.json").write_text(
            json.dumps(runtime, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        config = runtime["evaluation"]["applicability"]["configuredConfiguration"]
        if runtime.get("retrievalImplementationSha256") != retrieval_implementation_fingerprint():
            raise SystemExit(
                "Running retrieval code differs from this checkout. No inference called."
            )
        if (
            config["retrievalMode"] != "hybrid"
            or config["databaseDialect"] != "postgresql"
            or config["embeddingProvider"] != "cloudflare"
            or config["embeddingModel"] != "@cf/baai/bge-m3"
            or config["embeddingDimension"] != 1024
        ):
            raise SystemExit("Running retrieval configuration exceeds this evaluation scope.")
        response = client.get("https://ai-radar.xue-ai.workers.dev/backend/api/v2/snapshot")
        response.raise_for_status()
        current = KnowledgeSnapshot.model_validate(response.json())
        frozen = KnowledgeSnapshot.model_validate_json(
            (ROOT / "docs/eval/snapshots/public_snapshot_2026-11-07.json").read_bytes()
        )
        if corpus_fingerprint(current, version=2) != corpus_fingerprint(frozen, version=2):
            raise SystemExit("Published corpus changed since the freeze. No inference called.")
        token = os.environ.get("CLOUDFLARE_API_TOKEN")
        if not token:
            raise SystemExit("Existing Cloudflare token is unavailable. No inference called.")
        response = client.get(
            "https://api.cloudflare.com/client/v4/accounts",
            headers={"Authorization": f"Bearer {token}"},
        )
        if response.status_code != 200:
            raise SystemExit("Account discovery failed. No inference called; no retry.")
        accounts = response.json().get("result", [])
        if len(accounts) != 1:
            raise SystemExit(
                "Cannot determine a unique existing Cloudflare account. No inference called."
            )
        env = {**os.environ, "CLOUDFLARE_ACCOUNT_ID": accounts[0]["id"]}
    command = [
        sys.executable,
        "scripts/eval_hybrid_retrieval.py",
        "--snapshot",
        "docs/eval/snapshots/public_snapshot_2026-11-07.json",
        "--golden-set",
        "docs/eval/retrieval_golden_set.v2.jsonl",
        "--alias-catalog",
        "backend/data/entity_aliases_v1.json",
        "--output-dir",
        str(output),
        "--database-url",
        "postgresql+psycopg://ai_radar:test-only-password@127.0.0.1:5432/ai_radar_evaluation",
        "--model-version",
        config["embeddingVersion"],
        "--daily-api-call-budget",
        "114",
        "--daily-neuron-budget",
        "850",
        "--allow-external-api",
    ]
    subprocess.run(command, env=env, cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
