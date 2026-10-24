"""Local full-catalog preview. Does not enable paid services or public writes."""

import hashlib
import secrets
import sys
from pathlib import Path

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Settings
from app.main import create_app

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "artifacts/portfolio-local"
OUTPUT.mkdir(parents=True, exist_ok=True)
secret_path = OUTPUT / "session-secret.txt"
if not secret_path.exists():
    secret_path.write_text(secrets.token_urlsafe(48), encoding="utf-8")

snapshot_path = ROOT / "backend/data/demo_snapshot.json"
snapshot_version = hashlib.sha256(snapshot_path.read_bytes()).hexdigest()[:16]
settings = Settings(
    database_url="sqlite:///" + (OUTPUT / f"research-{snapshot_version}.db").as_posix(),
    seed_snapshot_path=snapshot_path,
    quality_evaluation_path=OUTPUT / "no-historical-evaluation.json",
    admin_token=None,
    cors_origins=("http://127.0.0.1:8085",),
    environment="test",
    jwt_secret=secret_path.read_text(encoding="utf-8"),
    rag_generation_enabled=False,
    embedding_provider="none",
    auto_extraction_max_snapshots_per_cycle=0,
)

if __name__ == "__main__":
    uvicorn.run(create_app(settings), host="127.0.0.1", port=8004)
