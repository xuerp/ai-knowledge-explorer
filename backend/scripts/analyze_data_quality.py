#!/usr/bin/env python3
"""
分析 AI Radar 数据质量并生成项目完成检查清单。

基于 REMAINING_ISSUES_RESOLUTION_SPEC.md 中定义的门槛。
"""

import json
import sys
from collections import Counter
from pathlib import Path


def load_snapshot(path: Path) -> dict:
    """加载快照数据"""
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def analyze_claim_entity_links(snapshot: dict) -> dict:
    """分析 Claim 实体关联状态"""
    claims = snapshot.get("claims", [])
    entities = snapshot.get("entities", [])
    entity_ids = {e["id"] for e in entities}

    missing_entity = []
    invalid_entity = []
    linked = []

    for claim in claims:
        entity_id = claim.get("entityId")
        if not entity_id:
            missing_entity.append(claim["id"])
        elif entity_id not in entity_ids:
            invalid_entity.append(claim["id"])
        else:
            linked.append(claim["id"])

    return {
        "total_claims": len(claims),
        "linked_claims": len(linked),
        "missing_entity": len(missing_entity),
        "invalid_entity": len(invalid_entity),
        "missing_entity_ids": missing_entity[:10],  # 显示前10条
        "invalid_entity_ids": invalid_entity[:10],
    }


def analyze_core_entity_relations(snapshot: dict) -> dict:
    """分析核心实体关系覆盖"""
    # 从 REMAINING_ISSUES_RESOLUTION_SPEC 中提取的核心实体列表
    CORE_ENTITIES = [
        "Claude Code", "Codex", "Devin", "Gemini CLI", "Manus",
        "AutoGen", "CrewAI", "LangGraph", "MCP", "OpenAI Agents SDK",
        "GPT", "Claude", "Gemini", "Llama", "Qwen", "DeepSeek"
    ]

    entities = snapshot.get("entities", [])
    relations = snapshot.get("relations", [])

    # 构建实体名称到ID的映射
    entity_name_map = {}
    for e in entities:
        entity_name_map[e["name"]["en"].lower()] = e["id"]
        entity_name_map[e["name"]["zh"].lower()] = e["id"]
        entity_name_map[e["slug"].lower()] = e["id"]

    # 统计每个实体的关系数
    relation_counts = Counter()
    for rel in relations:
        if rel.get("sourceIds"):  # 只计算有证据的关系
            relation_counts[rel.get("fromId")] += 1
            relation_counts[rel.get("toId")] += 1

    # 找出核心实体并统计缺口
    THRESHOLD = 5
    gaps = []
    for core_name in CORE_ENTITIES:
        entity_id = None
        for variant in [core_name.lower(), core_name.replace(" ", "-").lower()]:
            if variant in entity_name_map:
                entity_id = entity_name_map[variant]
                break

        if entity_id:
            count = relation_counts.get(entity_id, 0)
            if count < THRESHOLD:
                gaps.append({
                    "name": core_name,
                    "entity_id": entity_id,
                    "current_count": count,
                    "needed": THRESHOLD - count
                })

    total_gap = sum(g["needed"] for g in gaps)

    return {
        "core_entity_count": len(CORE_ENTITIES),
        "entities_below_threshold": len(gaps),
        "total_relation_gap": total_gap,
        "gaps": gaps[:16],  # 显示前16个
    }


def analyze_evidence_quality(snapshot: dict) -> dict:
    """分析 Evidence 质量"""
    evidence = snapshot.get("evidence", [])
    claims = snapshot.get("claims", [])

    total = len(evidence)
    official = sum(1 for e in evidence if e.get("publisher") != "Community")
    verified = sum(1 for e in evidence if e.get("verifiedAt"))
    recent_180d = sum(1 for e in evidence if e.get("collectedAt"))  # 简化检查

    claims_with_evidence = sum(1 for c in claims if c.get("sourceIds"))

    return {
        "total_evidence": total,
        "official_evidence": official,
        "official_percentage": round(official / total * 100, 2) if total > 0 else 0,
        "verified_evidence": verified,
        "verified_percentage": round(verified / total * 100, 2) if total > 0 else 0,
        "claims_with_evidence": claims_with_evidence,
        "claims_without_evidence": len(claims) - claims_with_evidence,
    }


def generate_completion_checklist(snapshot: dict) -> dict:
    """生成项目完成检查清单"""
    claim_analysis = analyze_claim_entity_links(snapshot)
    relation_analysis = analyze_core_entity_relations(snapshot)
    evidence_analysis = analyze_evidence_quality(snapshot)

    # P0 门槛检查
    p0_checks = {
        "claim_entity_complete": claim_analysis["missing_entity"] == 0 and claim_analysis["invalid_entity"] == 0,
        "claim_count_sufficient": claim_analysis["total_claims"] >= 150,
        "core_relations_sufficient": relation_analysis["entities_below_threshold"] == 0,
        "evidence_official_ratio": evidence_analysis["official_percentage"] >= 60,
        "evidence_coverage": evidence_analysis["claims_without_evidence"] == 0,
    }

    return {
        "claim_analysis": claim_analysis,
        "relation_analysis": relation_analysis,
        "evidence_analysis": evidence_analysis,
        "p0_checks": p0_checks,
        "p0_passed": all(p0_checks.values()),
        "p0_blockers": [k for k, v in p0_checks.items() if not v],
    }


def main():
    # 加载快照
    backend_root = Path(__file__).parent.parent
    snapshot_path = backend_root / "data" / "demo_snapshot.json"

    if not snapshot_path.exists():
        print(f"❌ 快照文件不存在: {snapshot_path}", file=sys.stderr)
        sys.exit(1)

    snapshot = load_snapshot(snapshot_path)
    checklist = generate_completion_checklist(snapshot)

    # 打印报告 (避免Windows控制台编码问题)
    print("=" * 80)
    print("AI RADAR Data Quality Analysis Report")
    print("=" * 80)
    print()

    print("[CLAIM Entity Linkage Analysis]")
    print("-" * 80)
    ca = checklist["claim_analysis"]
    print(f"  总 Claim 数量: {ca['total_claims']}")
    print(f"  已关联实体: {ca['linked_claims']}")
    print(f"  ❌ 缺失实体: {ca['missing_entity']}")
    print(f"  ❌ 无效实体ID: {ca['invalid_entity']}")
    if ca["missing_entity"] > 0:
        print(f"  示例 (前10): {', '.join(ca['missing_entity_ids'])}")
    print()

    print("[Core Entity Relations Analysis]")
    print("-" * 80)
    ra = checklist["relation_analysis"]
    print(f"  核心实体总数: {ra['core_entity_count']}")
    print(f"  ❌ 低于门槛 (<5): {ra['entities_below_threshold']}")
    print(f"  总关系缺口: {ra['total_relation_gap']}")
    if ra["gaps"]:
        print("  缺口详情:")
        for gap in ra["gaps"][:5]:  # 只显示前5个
            print(f"    - {gap['name']}: {gap['current_count']}/5 (需补 {gap['needed']} 条)")
    print()

    print("[Evidence Quality Analysis]")
    print("-" * 80)
    ea = checklist["evidence_analysis"]
    print(f"  总 Evidence 数: {ea['total_evidence']}")
    print(f"  官方来源: {ea['official_evidence']} ({ea['official_percentage']}%)")
    print(f"  已核验: {ea['verified_evidence']} ({ea['verified_percentage']}%)")
    print(f"  Claim 引用覆盖: {ea['claims_with_evidence']}/{ea['claims_with_evidence'] + ea['claims_without_evidence']}")
    print()

    print("[P0 Completion Checks]")
    print("-" * 80)
    checks = checklist["p0_checks"]
    for check_name, passed in checks.items():
        status = "[OK]" if passed else "[FAIL]"
        print(f"  {status} {check_name}")
    print()

    if checklist["p0_passed"]:
        print("[SUCCESS] All P0 checks passed! Ready to switch to live mode.")
    else:
        print(f"[WARNING] {len(checklist['p0_blockers'])} P0 blockers need fixing:")
        for blocker in checklist["p0_blockers"]:
            print(f"    - {blocker}")
    print()

    # 输出 JSON 供其他脚本使用
    output_path = backend_root / "data" / "quality_analysis.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(checklist, f, indent=2, ensure_ascii=False)

    print(f"[INFO] Full report saved to: {output_path}")

    return 0 if checklist["p0_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
