"""Manually authorized inference only; never connects to the application database."""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.evaluation_scope import corpus_fingerprint, retrieval_implementation_fingerprint
from app.schemas import KnowledgeSnapshot


def evaluation_environment() -> dict[str, str]:
    account_id = os.getenv("AI_RADAR_EVALUATION_CLOUDFLARE_ACCOUNT_ID", "").strip()
    token = os.getenv("AI_RADAR_EVALUATION_CLOUDFLARE_API_TOKEN", "").strip()
    if not re.fullmatch(r"[a-f0-9]{32}", account_id) or not token:
        raise SystemExit(
            "Dedicated evaluation account/token are not configured. No inference called."
        )
    return {**os.environ, "CLOUDFLARE_ACCOUNT_ID": account_id, "CLOUDFLARE_API_TOKEN": token}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--allow-external-api", action="store_true")
    if not parser.parse_args().allow_external_api:
        raise SystemExit("Explicit --allow-external-api authorization is required.")
    env = evaluation_environment()
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
        "--canary-first",
    ]
    subprocess.run(command, env=env, cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
