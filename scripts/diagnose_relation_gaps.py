from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.quality import CORE_ENTITY_RELATION_REQUIREMENT
from app.schemas import RELATION_KINDS, Entity, KnowledgeSnapshot

DIAGNOSIS_VERSION = "1.0.0"
CORE_ENTITY_TYPES = {"agent", "framework"}


def is_core_entity(entity: Entity) -> bool:
    return (entity.type == "model" and entity.family_id is None) or entity.type in CORE_ENTITY_TYPES


def nested_source_ids(value: Any) -> set[str]:
    if isinstance(value, dict):
        result = set(value.get("source_ids") or [])
        for nested in value.values():
            result.update(nested_source_ids(nested))
        return result
    if isinstance(value, list):
        result: set[str] = set()
        for nested in value:
            result.update(nested_source_ids(nested))
        return result
    return set()


def diagnose(snapshot: KnowledgeSnapshot, snapshot_hash: str, snapshot_path: str) -> dict[str, Any]:
    evidence_by_id = {item.id: item for item in snapshot.evidence}
    evidence_ids = set(evidence_by_id)
    core_entities = [item for item in snapshot.entities if is_core_entity(item)]
    core_entity_ids = {item.id for item in core_entities}

    grounded_relations = [
        edge
        for edge in snapshot.graph.edges
        if edge.confidence != "conflict"
        and bool(edge.source_ids)
        and set(edge.source_ids).issubset(evidence_ids)
    ]
    relation_counts = Counter(edge.kind for edge in grounded_relations)
    entity_degrees: Counter[str] = Counter()
    relation_source_ids: set[str] = set()
    for edge in grounded_relations:
        entity_degrees.update((edge.from_id, edge.to_id))
        relation_source_ids.update(edge.source_ids)

    evidence_entity_ids: defaultdict[str, set[str]] = defaultdict(set)
    evidence_claim_ids: defaultdict[str, set[str]] = defaultdict(set)
    evidence_timeline_ids: defaultdict[str, set[str]] = defaultdict(set)
    evidence_entity_reference_ids: defaultdict[str, set[str]] = defaultdict(set)
    for claim in snapshot.claims:
        if claim.entity_id:
            for source_id in claim.source_ids:
                evidence_entity_ids[source_id].add(claim.entity_id)
                evidence_claim_ids[source_id].add(claim.id)
    for entity_id, entries in snapshot.timeline.items():
        for entry in entries:
            for source_id in entry.source_ids:
                evidence_entity_ids[source_id].add(entity_id)
                evidence_timeline_ids[source_id].add(entry.id)
    for entity in snapshot.entities:
        for source_id in nested_source_ids(entity.model_dump(mode="python")):
            evidence_entity_ids[source_id].add(entity.id)
            evidence_entity_reference_ids[source_id].add(entity.id)

    core_coverage = []
    for entity in sorted(core_entities, key=lambda item: (entity_degrees[item.id], item.id)):
        relation_count = entity_degrees[entity.id]
        core_coverage.append(
            {
                "entityId": entity.id,
                "name": entity.name.model_dump(mode="json"),
                "entityType": entity.type,
                "publishedGroundedRelations": relation_count,
                "distanceToExistingQualityThreshold": max(
                    0, CORE_ENTITY_RELATION_REQUIREMENT - relation_count
                ),
            }
        )

    unused_official_evidence = []
    for evidence in sorted(snapshot.evidence, key=lambda item: item.id):
        if evidence.type != "official" or evidence.id in relation_source_ids:
            continue
        associated_entity_ids = sorted(evidence_entity_ids[evidence.id])
        unused_official_evidence.append(
            {
                "evidenceId": evidence.id,
                "title": evidence.title.model_dump(mode="json"),
                "publisher": evidence.publisher,
                "url": evidence.url,
                "publishedAt": evidence.published_at,
                "associatedEntityIds": associated_entity_ids,
                "associatedCoreEntityIds": sorted(core_entity_ids & set(associated_entity_ids)),
                "supportedClaimIds": sorted(evidence_claim_ids[evidence.id]),
                "timelineEntryIds": sorted(evidence_timeline_ids[evidence.id]),
                "entityReferenceIds": sorted(evidence_entity_reference_ids[evidence.id]),
            }
        )

    below_threshold = [
        item for item in core_coverage if item["distanceToExistingQualityThreshold"] > 0
    ]
    ontology_coverage = [
        {"relationKind": kind, "publishedGroundedRelations": relation_counts[kind]}
        for kind in RELATION_KINDS
    ]
    return {
        "metadata": {
            "diagnosisVersion": DIAGNOSIS_VERSION,
            "snapshotPath": snapshot_path,
            "snapshotSha256": snapshot_hash,
            "snapshotRetrievedAt": snapshot.meta.retrieved_at,
            "relationOntologyKinds": list(RELATION_KINDS),
            "coreEntityRule": ("top-level model families plus agent and framework entities"),
            "qualityThresholdReference": CORE_ENTITY_RELATION_REQUIREMENT,
        },
        "summary": {
            "publishedRelations": len(snapshot.graph.edges),
            "publishedGroundedRelations": len(grounded_relations),
            "coreEntities": len(core_entities),
            "coreEntitiesBelowExistingQualityThreshold": len(below_threshold),
            "distanceToExistingQualityThreshold": sum(
                item["distanceToExistingQualityThreshold"] for item in below_threshold
            ),
            "officialEvidence": sum(item.type == "official" for item in snapshot.evidence),
            "officialEvidenceUnusedByRelations": len(unused_official_evidence),
            "unusedOfficialEvidenceAssociatedWithCoreEntities": sum(
                bool(item["associatedCoreEntityIds"]) for item in unused_official_evidence
            ),
        },
        "coreEntityCoverage": core_coverage,
        "ontologyCoverage": ontology_coverage,
        "unusedOfficialEvidence": unused_official_evidence,
        "interpretationBoundary": (
            "This diagnosis reports observed coverage and unused official evidence only. "
            "It does not propose entity pairs that should have relations, and the distance "
            "to the existing quality threshold is not a publication quota."
        ),
    }


def _cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ")


def markdown_summary(report: dict[str, Any]) -> str:
    metadata = report["metadata"]
    summary = report["summary"]
    lines = [
        "# 关系缺口只读诊断",
        "",
        f"- 诊断版本：v{metadata['diagnosisVersion']}",
        f"- 快照 SHA-256：`{metadata['snapshotSha256']}`",
        f"- 快照时间：`{metadata['snapshotRetrievedAt']}`",
        f"- 已发布关系：{summary['publishedRelations']}（Evidence 完整且非冲突：{summary['publishedGroundedRelations']}）",
        f"- 核心实体：{summary['coreEntities']}；低于既有 5 条质量阈值：{summary['coreEntitiesBelowExistingQualityThreshold']}；覆盖差值：{summary['distanceToExistingQualityThreshold']}",
        f"- 官方 Evidence：{summary['officialEvidence']}；未被任何已发布关系引用：{summary['officialEvidenceUnusedByRelations']}",
        "",
        "> 本诊断只报告已观察到的覆盖和未用于关系的官方 Evidence，不生成“应该存在关系”的实体对。覆盖差值是既有质量规则的观测值，不是发布配额。",
        "",
        "## 核心实体关系覆盖",
        "",
        "| 实体 | 类型 | 已发布可解释关系 | 距既有阈值差值 |",
        "| --- | --- | ---: | ---: |",
    ]
    for item in report["coreEntityCoverage"]:
        lines.append(
            f"| {_cell(item['name']['zh'])} (`{item['entityId']}`) | {item['entityType']} | "
            f"{item['publishedGroundedRelations']} | "
            f"{item['distanceToExistingQualityThreshold']} |"
        )
    lines.extend(
        [
            "",
            "## 本体类型覆盖",
            "",
            "| 合法关系类型 | 已发布可解释关系 |",
            "| --- | ---: |",
        ]
    )
    for item in report["ontologyCoverage"]:
        lines.append(f"| `{item['relationKind']}` | {item['publishedGroundedRelations']} |")
    lines.extend(
        [
            "",
            "## 未被已发布关系引用的官方 Evidence",
            "",
            "以下条目来自快照中的官方 Evidence；“关联核心实体”只依据现有 Claim、Timeline 或实体字段引用，不推断新关系。",
            "",
            "| Evidence | 发布方 | 关联核心实体 | 已支撑内容 |",
            "| --- | --- | --- | ---: |",
        ]
    )
    for item in report["unusedOfficialEvidence"]:
        content_count = len(item["supportedClaimIds"]) + len(item["timelineEntryIds"])
        core_ids = ", ".join(f"`{value}`" for value in item["associatedCoreEntityIds"]) or "—"
        lines.append(
            f"| [{_cell(item['title']['zh'])}]({item['url']}) (`{item['evidenceId']}`) | "
            f"{_cell(item['publisher'])} | {core_ids} | {content_count} |"
        )
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="运行关系覆盖与官方 Evidence 的只读诊断。")
    parser.add_argument(
        "--snapshot",
        type=Path,
        default=REPO_ROOT / "docs/eval/snapshots/public_snapshot_2026-08-30.json",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=REPO_ROOT / "docs/eval/results",
    )
    args = parser.parse_args()

    payload = args.snapshot.read_bytes()
    snapshot_hash = hashlib.sha256(payload).hexdigest()
    snapshot = KnowledgeSnapshot.model_validate_json(payload)
    try:
        snapshot_path = args.snapshot.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        snapshot_path = str(args.snapshot.resolve())
    report = diagnose(snapshot, snapshot_hash, snapshot_path)
    stem = f"relation_gap_diagnosis_v{DIAGNOSIS_VERSION}_{snapshot_hash[:12]}"
    args.output_dir.mkdir(parents=True, exist_ok=True)
    json_path = args.output_dir / f"{stem}.json"
    markdown_path = args.output_dir / f"{stem}.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    markdown_path.write_text(markdown_summary(report), encoding="utf-8")
    print(
        json.dumps(
            {
                "json": str(json_path),
                "markdown": str(markdown_path),
                **report["summary"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
