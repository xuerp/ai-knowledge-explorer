from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from app.entity_aliases import apply_entity_aliases, load_entity_alias_catalog
from app.schemas import KnowledgeSnapshot

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts/eval_hybrid_retrieval.py"
SPEC = importlib.util.spec_from_file_location("eval_hybrid_retrieval", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
eval_hybrid_retrieval = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(eval_hybrid_retrieval)


def test_hybrid_evaluation_preflight_is_bound_to_fixed_workload():
    snapshot_path = REPO_ROOT / "docs/eval/snapshots/public_snapshot_2026-08-30.json"
    golden_path = REPO_ROOT / "docs/eval/retrieval_golden_set.jsonl"
    alias_path = REPO_ROOT / "backend/data/entity_aliases_v1.json"
    snapshot = KnowledgeSnapshot.model_validate_json(snapshot_path.read_bytes())
    _, aliases, _ = load_entity_alias_catalog(alias_path)
    apply_entity_aliases(snapshot.entities, aliases)
    samples = [
        json.loads(line)
        for line in golden_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]

    documents = eval_hybrid_retrieval.build_document_texts(snapshot)
    all_inputs = documents + [str(item["query"]) for item in samples]

    assert len(documents) == 195
    assert len(samples) == 80
    assert sum(len(text) for text in all_inputs) == 69_750
