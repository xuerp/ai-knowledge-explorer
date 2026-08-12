from __future__ import annotations

import json
from collections import deque
from pathlib import Path

from .schemas import GoldenQuestionReport, GoldenQuestionResult, GraphEdge, KnowledgeSnapshot

GOLDEN_PASS_RATIO = 0.85
GOLDEN_QUESTIONS_PATH = Path(__file__).resolve().parents[1] / "data" / "golden_questions.json"


class GoldenQuestionEvaluator:
    def __init__(self, questions_path: Path = GOLDEN_QUESTIONS_PATH):
        self.questions_path = questions_path

    def evaluate(self, snapshot: KnowledgeSnapshot) -> GoldenQuestionReport:
        questions = json.loads(self.questions_path.read_text(encoding="utf-8"))
        results = [self._evaluate_question(snapshot, item) for item in questions]
        passed = sum(result.passed for result in results)
        ratio = round(passed / len(results), 4) if results else 0.0
        return GoldenQuestionReport(
            total=len(results),
            passed=passed,
            failed=len(results) - passed,
            pass_ratio=ratio,
            required_ratio=GOLDEN_PASS_RATIO,
            ready=bool(results) and ratio >= GOLDEN_PASS_RATIO,
            results=results,
        )

    def _evaluate_question(
        self,
        snapshot: KnowledgeSnapshot,
        question: dict[str, object],
    ) -> GoldenQuestionResult:
        question_id = str(question["id"])
        text = str(question["question"])
        expected = {str(item) for item in question.get("expectedEntityIds", [])}
        temporal = bool(question.get("requiresTemporalEvidence", False))
        evidence_ids = {item.id for item in snapshot.evidence}
        grounded_edges = [
            edge
            for edge in snapshot.graph.edges
            if edge.confidence == "verified"
            and edge.source_ids
            and set(edge.source_ids).issubset(evidence_ids)
        ]
        mentioned = self._resolve_mentions(snapshot, text)
        reachable = set(mentioned)
        for edge in grounded_edges:
            if edge.from_id in mentioned:
                reachable.add(edge.to_id)
            if edge.to_id in mentioned:
                reachable.add(edge.from_id)
        missing = sorted(expected - reachable)
        temporal_missing = sorted(
            entity_id
            for entity_id in expected
            if temporal and not self._has_grounded_timeline(snapshot, entity_id, evidence_ids)
        )
        reasons: list[str] = []
        if missing:
            reasons.append("问题解析及一跳证据图未覆盖预期实体：" + "、".join(missing))
        if temporal_missing:
            reasons.append("缺少带来源的已核验时间证据：" + "、".join(temporal_missing))

        if question_id == "gq-15":
            passed = any(
                claim.confidence in {"conflict", "unverified"} for claim in snapshot.claims
            ) or bool(snapshot.review_candidates)
            if not passed:
                reasons.append("当前快照没有可解释的冲突或证据不足候选。")
        elif question_id == "gq-17":
            passed = any(edge.kind == "competes-with" for edge in grounded_edges)
            if not passed:
                reasons.append("缺少带来源的竞争关系。")
        elif question_id == "gq-18":
            official = {item.id for item in snapshot.evidence if item.type == "official"}
            passed = any(
                edge.source_ids and set(edge.source_ids) & official for edge in grounded_edges
            )
            if not passed:
                reasons.append("没有由官方来源支撑的已核验关系。")
        elif question_id == "gq-19":
            passed = self._has_explicit_evidence_gap(snapshot, evidence_ids)
            if not passed:
                reasons.append("当前目录未显式记录可回答范围之外的证据缺口。")
        elif question_id == "gq-20":
            path_types = self._reachable_types(snapshot, "e-gpt", grounded_edges, max_depth=2)
            passed = not missing and {"benchmark", "company", "agent"}.issubset(path_types)
            if not passed:
                reasons.append("GPT 的两跳证据路径尚未同时覆盖评测、公司和工具。")
        else:
            passed = not missing and not temporal_missing and bool(expected)

        return GoldenQuestionResult(
            id=question_id,
            question=text,
            passed=passed,
            matched_entity_ids=sorted(reachable & expected),
            missing_entity_ids=missing,
            reason="；".join(reasons) if reasons else "预期实体与证据约束均已满足。",
        )

    @staticmethod
    def _resolve_mentions(snapshot: KnowledgeSnapshot, question: str) -> set[str]:
        key = question.casefold()
        matches: list[tuple[str, str]] = []
        for entity in snapshot.entities:
            tokens = {
                value.casefold().strip()
                for value in [entity.slug, entity.name.zh, entity.name.en, *(entity.aliases or [])]
                if value.strip()
            }
            matching = [token for token in tokens if token in key]
            if matching:
                matches.append((entity.id, max(matching, key=len)))
        return {
            entity_id
            for entity_id, token in matches
            if not any(token != other and token in other for _, other in matches)
        }

    @staticmethod
    def _has_grounded_timeline(
        snapshot: KnowledgeSnapshot,
        entity_id: str,
        evidence_ids: set[str],
    ) -> bool:
        return any(
            entry.confidence == "verified"
            and bool(entry.source_ids)
            and set(entry.source_ids).issubset(evidence_ids)
            for entry in snapshot.timeline.get(entity_id, [])
        )

    @staticmethod
    def _has_explicit_evidence_gap(snapshot: KnowledgeSnapshot, evidence_ids: set[str]) -> bool:
        if any(claim.confidence != "verified" for claim in snapshot.claims):
            return True
        return any(
            not source_ids or not set(source_ids).issubset(evidence_ids)
            for source_ids in [
                *(claim.source_ids for claim in snapshot.claims),
                *(edge.source_ids for edge in snapshot.graph.edges),
            ]
        )

    @staticmethod
    def _reachable_types(
        snapshot: KnowledgeSnapshot,
        start_id: str,
        edges: list[GraphEdge],
        *,
        max_depth: int,
    ) -> set[str]:
        adjacency: dict[str, set[str]] = {}
        for edge in edges:
            adjacency.setdefault(edge.from_id, set()).add(edge.to_id)
            adjacency.setdefault(edge.to_id, set()).add(edge.from_id)
        visited = {start_id}
        queue = deque([(start_id, 0)])
        while queue:
            current, depth = queue.popleft()
            if depth >= max_depth:
                continue
            for neighbor in adjacency.get(current, set()):
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append((neighbor, depth + 1))
        entity_types = {entity.id: entity.type for entity in snapshot.entities}
        return {entity_types[item] for item in visited if item in entity_types}
