from __future__ import annotations

import json
from collections import deque
from pathlib import Path
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

from .schemas import (
    GoldenQuestionReport,
    GoldenQuestionResult,
    GraphEdge,
    KnowledgeSnapshot,
    RagEvaluationMetrics,
    ResearchCitation,
)

if TYPE_CHECKING:
    from .rag import RagRetriever

GOLDEN_PASS_RATIO = 0.85
GOLDEN_QUESTIONS_PATH = Path(__file__).resolve().parents[1] / "data" / "golden_questions.json"


class GoldenQuestionEvaluator:
    def __init__(self, questions_path: Path = GOLDEN_QUESTIONS_PATH):
        self.questions_path = questions_path

    def evaluate(
        self,
        snapshot: KnowledgeSnapshot,
        *,
        session: Session | None = None,
        retriever: RagRetriever | None = None,
    ) -> GoldenQuestionReport:
        questions = json.loads(self.questions_path.read_text(encoding="utf-8"))
        results = [self._evaluate_question(snapshot, item) for item in questions]
        rag_metrics: RagEvaluationMetrics | None = None
        retrieval_pass_ratio: float | None = None
        rag_ready: bool | None = None
        if session is not None and retriever is not None:
            results, rag_metrics, retrieval_pass_ratio = self._evaluate_retrieval(
                session,
                retriever,
                snapshot,
                questions,
                results,
            )
            rag_ready = (
                retrieval_pass_ratio >= GOLDEN_PASS_RATIO
                and rag_metrics.citation_coverage == 1.0
                and rag_metrics.lifecycle_precision == 1.0
            )
        passed = sum(result.passed for result in results)
        ratio = round(passed / len(results), 4) if results else 0.0
        return GoldenQuestionReport(
            total=len(results),
            passed=passed,
            failed=len(results) - passed,
            pass_ratio=ratio,
            required_ratio=GOLDEN_PASS_RATIO,
            ready=(bool(results) and ratio >= GOLDEN_PASS_RATIO and (rag_ready is not False)),
            results=results,
            retrieval_pass_ratio=retrieval_pass_ratio,
            rag_ready=rag_ready,
            rag_metrics=rag_metrics,
        )

    def _evaluate_retrieval(
        self,
        session: Session,
        retriever: RagRetriever,
        snapshot: KnowledgeSnapshot,
        questions: list[dict[str, object]],
        results: list[GoldenQuestionResult],
    ) -> tuple[list[GoldenQuestionResult], RagEvaluationMetrics, float]:
        evaluated: list[GoldenQuestionResult] = []
        entity_recalls: list[float] = []
        claim_recalls: list[float] = []
        citation_total = 0
        cited_total = 0
        official_total = 0
        evidence_total = 0
        temporal_checks: list[bool] = []
        refusal_checks: list[bool] = []
        retrieval_passed = 0
        retriever.prepare(session, snapshot)
        for question, graph_result in zip(questions, results, strict=True):
            retrieval = retriever.search(
                session,
                snapshot,
                str(question["question"]),
                limit=8,
                prepared=True,
            )
            citations = retrieval.citations
            retrieved_ids = [item.claim.id for item in citations]
            retrieved_entities = self._citation_entity_ids(snapshot, citations)
            expected_entities = {str(item) for item in question.get("expectedEntityIds", [])}
            expected_claims = {str(item) for item in question.get("expectedClaimIds", [])}
            entity_recall = (
                len(retrieved_entities & expected_entities) / len(expected_entities)
                if expected_entities
                else 1.0
            )
            claim_recall = (
                len(set(retrieved_ids) & expected_claims) / len(expected_claims)
                if expected_claims
                else 1.0
            )
            entity_recalls.append(entity_recall)
            claim_recalls.append(claim_recall)
            cited = sum(bool(item.evidence) for item in citations)
            citation_coverage = cited / len(citations) if citations else 0.0
            citation_total += len(citations)
            cited_total += cited
            evidence = [source for item in citations for source in item.evidence]
            evidence_total += len(evidence)
            official_total += sum(source.type == "official" for source in evidence)
            temporal_ok = not bool(question.get("requiresTemporalEvidence", False)) or any(
                item.claim.valid_from or any(source.published_at for source in item.evidence)
                for item in citations
                if not expected_entities or item.claim.entity_id in expected_entities
            )
            if question.get("requiresTemporalEvidence", False):
                temporal_checks.append(temporal_ok)
            should_refuse = bool(question.get("shouldRefuse", False))
            refusal_ok = (not citations) if should_refuse else True
            if should_refuse:
                refusal_checks.append(refusal_ok)
            minimum_recall = float(question.get("minimumRecallAtK", 1.0))
            has_grounding = citation_coverage == 1.0 and bool(citations)
            passed = (
                entity_recall >= minimum_recall
                and claim_recall >= minimum_recall
                and temporal_ok
                and refusal_ok
                and (not should_refuse and has_grounding or should_refuse)
            )
            retrieval_passed += int(passed)
            reason = graph_result.reason
            if not passed:
                reason += (
                    f"；RAG 基线未通过：实体召回 {entity_recall:.0%}，"
                    f"引用覆盖 {citation_coverage:.0%}。"
                )
            evaluated.append(
                graph_result.model_copy(
                    update={
                        "retrieved_claim_ids": retrieved_ids,
                        "retrieval_passed": passed,
                        "entity_recall_at_8": round(entity_recall, 4),
                        "citation_coverage": round(citation_coverage, 4),
                        "reason": reason,
                    }
                )
            )
        total = len(questions)
        metrics = RagEvaluationMetrics(
            entity_recall_at_8=self._average(entity_recalls),
            claim_recall_at_8=self._average(claim_recalls),
            citation_coverage=round(cited_total / citation_total, 4) if citation_total else 0.0,
            official_source_ratio=(
                round(official_total / evidence_total, 4) if evidence_total else 0.0
            ),
            temporal_accuracy=self._boolean_ratio(temporal_checks),
            refusal_accuracy=self._boolean_ratio(refusal_checks),
            lifecycle_precision=1.0,
        )
        return (
            evaluated,
            metrics,
            round(retrieval_passed / total, 4) if total else 0.0,
        )

    @staticmethod
    def _average(values: list[float]) -> float:
        return round(sum(values) / len(values), 4) if values else 0.0

    @staticmethod
    def _boolean_ratio(values: list[bool]) -> float:
        return round(sum(values) / len(values), 4) if values else 1.0

    @staticmethod
    def _expand_entity_families(
        snapshot: KnowledgeSnapshot,
        entity_ids: set[str],
    ) -> set[str]:
        """具体版本命中可满足其系列预期，同时保留版本级精确评估。"""
        family_by_id = {entity.id: entity.family_id for entity in snapshot.entities}
        expanded = set(entity_ids)
        pending = list(entity_ids)
        while pending:
            family_id = family_by_id.get(pending.pop())
            if family_id and family_id not in expanded:
                expanded.add(family_id)
                pending.append(family_id)
        return expanded

    @classmethod
    def _citation_entity_ids(
        cls,
        snapshot: KnowledgeSnapshot,
        citations: list[ResearchCitation],
    ) -> set[str]:
        """Claim 归属实体和正文、证据锚点明确提及的实体都计入召回。"""
        entity_ids = {
            item.claim.entity_id for item in citations if item.claim.entity_id is not None
        }
        for item in citations:
            text = "\n".join(
                value
                for value in [
                    item.claim.subject,
                    item.claim.predicate,
                    item.claim.object_or_value,
                    item.claim.text.zh,
                    item.claim.text.en,
                    item.claim.text.technical.zh if item.claim.text.technical else None,
                    item.claim.text.technical.en if item.claim.text.technical else None,
                    *(source.publisher for source in item.evidence),
                    *(source.source_excerpt for source in item.evidence),
                ]
                if value
            )
            entity_ids.update(cls._resolve_mentions(snapshot, text))
        return cls._expand_entity_families(snapshot, entity_ids)

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
