import importlib.util
import json
from pathlib import Path

import pytest


@pytest.mark.parametrize(
    "url",
    [
        "https://raw.githubusercontent.com/deepseek-ai/DeepSeek-V3/main/README.md",
        "https://huggingface.co/Qwen/Qwen3-235B-A22B/raw/main/README.md",
        "https://developers.openai.com/api/docs/models/gpt-4o.md",
        "https://developers.openai.com/api/docs/models/gpt-4o",
    ],
)
def test_enrichment_keeps_the_exact_collected_source_url(tmp_path, monkeypatch, url):
    script = Path(__file__).resolve().parents[1] / "scripts/enrich_model_specs.py"
    spec = importlib.util.spec_from_file_location("enrich_model_specs_test", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    data = tmp_path / "data"
    data.mkdir()
    (data / "frontier_catalog_v1.json").write_text(
        json.dumps({"entities": [], "evidence": []}), encoding="utf-8"
    )
    ledger = tmp_path / "ledger.json"
    ledger.write_text(
        json.dumps(
            {
                "entries": [
                    {
                        "entityId": "test-entity",
                        "specs": {},
                        "notes": [],
                        "sources": [
                            {"name": "test-source", "url": url, "excerpt": "Exact collected text."}
                        ],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(module, "ROOT", tmp_path)
    monkeypatch.setattr(module, "LEDGER", ledger)
    monkeypatch.setattr(
        module,
        "catalog",
        lambda: {
            "test-entity": {
                "id": "test-entity",
                "summary": {"zh": "测试对象", "en": "Test entity"},
            }
        },
    )
    module.apply()
    result = json.loads((data / "frontier_catalog_v1.json").read_text(encoding="utf-8"))
    assert result["evidence"][0]["url"] == url
    assert result["evidence"][0]["sourceExcerpt"] == "Exact collected text."
