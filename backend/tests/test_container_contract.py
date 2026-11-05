import os
import shutil
import subprocess
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def test_docker_copied_runtime_can_import_the_application_without_checkout_assets(tmp_path):
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    # Reconstruct COPY inputs, rather than importing from the full checkout
    # where a missing container asset can be accidentally present.
    dockerfile = (BACKEND_ROOT / "Dockerfile").read_text(encoding="utf-8")
    for line in dockerfile.splitlines():
        parts = line.split()
        if len(parts) != 3 or parts[0] != "COPY":
            continue
        source = BACKEND_ROOT / parts[1]
        target = runtime / parts[2]
        if source.is_dir():
            shutil.copytree(source, target, ignore=shutil.ignore_patterns("__pycache__"))
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
    env = {key: value for key, value in os.environ.items() if not key.startswith("AI_RADAR_")}
    env["PYTHONPATH"] = str(runtime)
    env["AI_RADAR_DATABASE_URL"] = "sqlite:///:memory:"
    completed = subprocess.run(
        [sys.executable, "-c", "from app.main import app; assert app is not None"],
        cwd=runtime,
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    assert completed.returncode == 0, completed.stderr


def test_runtime_data_files_are_copied_into_container_image():
    dockerfile = (BACKEND_ROOT / "Dockerfile").read_text(encoding="utf-8")
    required_files = (
        "demo_snapshot.json",
        "catalog_extension.json",
        "entity_aliases_v1.json",
        "golden_questions.json",
    )

    for filename in required_files:
        assert f"COPY data/{filename} ./data/{filename}" in dockerfile
