from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]


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
