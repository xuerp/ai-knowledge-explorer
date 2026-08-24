from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from time import perf_counter
from typing import Protocol

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .database import RagClaimDocumentRecord
from .schemas import (
    Claim,
    Entity,
    Evidence,
    KnowledgeSnapshot,
    ResearchCitation,
    RetrievalDiagnostics,
)

ASCII_TOKEN = re.compile(r"[a-z0-9][a-z0-9._+-]*", re.IGNORECASE)
CJK_SEQUENCE = re.compile(r"[\u3400-\u9fff]+")


@dataclass(slots=True)
class RagSearchResult:
    citations: list[ResearchCitation]
    diagnostics: RetrievalDiagnostics
    retrieval_mode: str = "lexical"


class RagRetriever(Protocol):
    def search(
        self,
        session: Session,
        snapshot: KnowledgeSnapshot,
        question: str,
        *,
        limit: int = 8,
    ) -> RagSearchResult: ...


class EmbeddingProvider(Protocol):
    @property
    def model_name(self) -> str: ...

    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...


@dataclass(frozen=True, slots=True)
class VectorDocument:
    claim_id: str
    content_hash: str
    model_name: str
    vector: list[float]


@dataclass(frozen=True, slots=True)
class VectorSearchHit:
    claim_id: str
    score: float


class VectorClaimIndex(Protocol):
    def upsert(self, documents: list[VectorDocument]) -> None: ...

    def search(self, vector: list[float], *, limit: int) -> list[VectorSearchHit]: ...


class ClaimReranker(Protocol):
    def rerank(
        self,
        question: str,
        citations: list[ResearchCitation],
    ) -> list[str]: ...


class LexicalRagRetriever:
    def search(
        self,
        session: Session,
        snapshot: KnowledgeSnapshot,
        question: str,
        *,
        limit: int = 8,
    ) -> RagSearchResult:
        started = perf_counter()
        self.sync_snapshot(session, snapshot)
        matched_entity_ids = self.resolve_mentions(snapshot.entities, question)
        statement = select(RagClaimDocumentRecord).where(
            RagClaimDocumentRecord.lifecycle_status == "current"
        )
        fallback_reason: str | None = None
        if matched_entity_ids:
            statement = statement.where(RagClaimDocumentRecord.entity_id.in_(matched_entity_ids))
        elif session.get_bind().dialect.name == "postgresql":
            query_text = self.postgres_query_text(question)
            if query_text:
                query = func.websearch_to_tsquery("simple", query_text)
                vector = func.to_tsvector("simple", RagClaimDocumentRecord.search_text)
                statement = statement.where(vector.op("@@")(query))
            else:
                fallback_reason = "query-has-no-indexable-terms"
        rows = list(session.scalars(statement).all())
        if not rows and not matched_entity_ids:
            fallback_reason = fallback_reason or "full-text-no-match"
            rows = list(
                session.scalars(
                    select(RagClaimDocumentRecord).where(
                        RagClaimDocumentRecord.lifecycle_status == "current"
                    )
                ).all()
            )
        scored = sorted(
            ((self.score(row, question, matched_entity_ids), row) for row in rows),
            key=lambda item: (-item[0], item[1].claim_id),
        )
        selected = [row for score, row in scored if score > 0][:limit]
        citations = [
            ResearchCitation(
                claim=Claim.model_validate_json(row.claim_json),
                evidence=[Evidence.model_validate(item) for item in json.loads(row.evidence_json)],
            )
            for row in selected
        ]
        elapsed_ms = max(0, round((perf_counter() - started) * 1000))
        return RagSearchResult(
            citations=citations,
            diagnostics=RetrievalDiagnostics(
                candidate_count=len(rows),
                returned_count=len(citations),
                filtered_count=max(0, len(rows) - len(citations)),
                elapsed_ms=elapsed_ms,
                matched_entity_ids=sorted(matched_entity_ids),
                fallback_reason=fallback_reason,
            ),
        )

    def sync_snapshot(self, session: Session, snapshot: KnowledgeSnapshot) -> None:
        evidence_by_id = {item.id: item for item in snapshot.evidence}
        entity_by_id = {item.id: item for item in snapshot.entities}
        indexed_ids: set[str] = set()
        now = datetime.now(UTC)
        for claim in snapshot.claims:
            if claim.confidence != "verified" or claim.entity_id not in entity_by_id:
                continue
            evidence = [
                evidence_by_id[source_id]
                for source_id in claim.source_ids
                if source_id in evidence_by_id
            ]
            if not evidence or len(evidence) != len(claim.source_ids):
                continue
            entity = entity_by_id[claim.entity_id]
            search_text = self.document_text(claim, entity, evidence)
            content_hash = hashlib.sha256(search_text.encode("utf-8")).hexdigest()
            row = session.get(RagClaimDocumentRecord, claim.id)
            payload = claim.model_dump_json(by_alias=True)
            evidence_json = json.dumps(
                [item.model_dump(mode="json", by_alias=True) for item in evidence],
                ensure_ascii=False,
            )
            published_dates = sorted(item.published_at for item in evidence if item.published_at)
            if row is None:
                row = RagClaimDocumentRecord(
                    claim_id=claim.id,
                    entity_id=claim.entity_id,
                    claim_json=payload,
                    evidence_json=evidence_json,
                    search_text=search_text,
                    lifecycle_status="current",
                    valid_from=claim.valid_from,
                    valid_to=claim.valid_to,
                    source_published_at=published_dates[0] if published_dates else None,
                    content_hash=content_hash,
                    updated_at=now,
                )
                session.add(row)
            elif row.content_hash != content_hash or row.lifecycle_status != "current":
                row.entity_id = claim.entity_id
                row.claim_json = payload
                row.evidence_json = evidence_json
                row.search_text = search_text
                row.lifecycle_status = "current"
                row.valid_from = claim.valid_from
                row.valid_to = claim.valid_to
                row.source_published_at = published_dates[0] if published_dates else None
                row.content_hash = content_hash
                row.updated_at = now
            indexed_ids.add(claim.id)
        if indexed_ids:
            session.execute(
                delete(RagClaimDocumentRecord).where(
                    RagClaimDocumentRecord.claim_id.not_in(indexed_ids)
                )
            )
        else:
            session.execute(delete(RagClaimDocumentRecord))
        session.flush()

    @staticmethod
    def document_text(claim: Claim, entity: Entity, evidence: list[Evidence]) -> str:
        return "\n".join(
            value
            for value in [
                entity.id,
                entity.slug,
                entity.name.zh,
                entity.name.en,
                *(entity.aliases or []),
                claim.subject,
                claim.predicate,
                claim.object_or_value,
                claim.text.zh,
                claim.text.en,
                claim.text.technical.zh if claim.text.technical else None,
                claim.text.technical.en if claim.text.technical else None,
                *(item.publisher for item in evidence),
                *(item.source_excerpt for item in evidence),
            ]
            if value
        )

    @classmethod
    def score(
        cls,
        row: RagClaimDocumentRecord,
        question: str,
        matched_entity_ids: set[str],
    ) -> float:
        query_tokens = cls.tokens(question)
        document_tokens = cls.tokens(row.search_text)
        overlap = len(query_tokens & document_tokens) / len(query_tokens) if query_tokens else 0.0
        entity_score = 1.0 if row.entity_id in matched_entity_ids else 0.0
        evidence = [Evidence.model_validate(item) for item in json.loads(row.evidence_json)]
        official_score = 1.0 if any(item.type == "official" for item in evidence) else 0.0
        time_score = 1.0 if row.valid_from or row.source_published_at else 0.0
        evidence_score = 1.0 if evidence else 0.0
        return (
            0.4 * overlap
            + 0.25 * entity_score
            + 0.15 * official_score
            + 0.1 * time_score
            + 0.1 * evidence_score
        )

    @staticmethod
    def resolve_mentions(entities: list[Entity], question: str) -> set[str]:
        key = question.casefold()
        matches: list[tuple[str, str, int]] = []
        for entity in entities:
            canonical = {
                value.casefold().strip()
                for value in [entity.slug, entity.name.zh, entity.name.en]
                if value.strip()
            }
            aliases = {value.casefold().strip() for value in entity.aliases or [] if value.strip()}
            matching = [
                (token, priority)
                for token, priority in [
                    *((token, 2) for token in canonical),
                    *((token, 1) for token in aliases - canonical),
                ]
                if token in key
            ]
            if matching:
                token, priority = max(matching, key=lambda item: (len(item[0]), item[1]))
                matches.append((entity.id, token, priority))
        strongest_token_priority = {
            token: max(priority for _, candidate, priority in matches if candidate == token)
            for _, token, _ in matches
        }
        matches = [item for item in matches if item[2] == strongest_token_priority[item[1]]]
        return {
            entity_id
            for entity_id, token, _ in matches
            if not any(token != other and token in other for _, other, _ in matches)
        }

    @classmethod
    def tokens(cls, value: str) -> set[str]:
        normalized = value.casefold()
        tokens = {item for item in ASCII_TOKEN.findall(normalized) if len(item) >= 2}
        for sequence in CJK_SEQUENCE.findall(normalized):
            if len(sequence) <= 2:
                tokens.add(sequence)
            else:
                tokens.update(sequence[index : index + 2] for index in range(len(sequence) - 1))
        return tokens

    @classmethod
    def postgres_query_text(cls, question: str) -> str:
        return " OR ".join(sorted(cls.tokens(question)))


class HybridRagRetriever:
    """可选混合检索层；依赖缺失或异常时始终安全降级到全文检索。"""

    def __init__(
        self,
        lexical: LexicalRagRetriever | None = None,
        *,
        embedding_provider: EmbeddingProvider | None = None,
        vector_index: VectorClaimIndex | None = None,
        reranker: ClaimReranker | None = None,
        enabled: bool = False,
        rrf_k: int = 60,
    ) -> None:
        self.lexical = lexical or LexicalRagRetriever()
        self.embedding_provider = embedding_provider
        self.vector_index = vector_index
        self.reranker = reranker
        self.enabled = enabled
        self.rrf_k = rrf_k

    def search(
        self,
        session: Session,
        snapshot: KnowledgeSnapshot,
        question: str,
        *,
        limit: int = 8,
    ) -> RagSearchResult:
        lexical_result = self.lexical.search(session, snapshot, question, limit=max(32, limit * 4))
        if not self.enabled:
            return self._lexical_fallback(lexical_result, limit, "hybrid-disabled")
        if self.embedding_provider is None or self.vector_index is None:
            return self._lexical_fallback(lexical_result, limit, "hybrid-unavailable")

        try:
            vector = self.embedding_provider.embed_query(question)
            vector_hits = self.vector_index.search(vector, limit=max(32, limit * 4))
            citations = self._fuse(lexical_result.citations, vector_hits)
            if self.reranker is not None and citations:
                citations = self._apply_reranker(question, citations)
        except Exception:  # noqa: BLE001 -- 第三方供应商异常必须统一降级，不能中断研究接口。
            return self._lexical_fallback(lexical_result, limit, "hybrid-provider-error")

        selected = citations[:limit]
        diagnostics = lexical_result.diagnostics.model_copy(
            update={
                "returned_count": len(selected),
                "filtered_count": max(0, len(citations) - len(selected)),
                "fallback_reason": None,
            }
        )
        return RagSearchResult(
            citations=selected,
            diagnostics=diagnostics,
            retrieval_mode="hybrid",
        )

    def _fuse(
        self,
        lexical_citations: list[ResearchCitation],
        vector_hits: list[VectorSearchHit],
    ) -> list[ResearchCitation]:
        by_id = {item.claim.id: item for item in lexical_citations}
        scores: dict[str, float] = {}
        for rank, citation in enumerate(lexical_citations, start=1):
            scores[citation.claim.id] = scores.get(citation.claim.id, 0.0) + 1 / (self.rrf_k + rank)
        for rank, hit in enumerate(vector_hits, start=1):
            if hit.claim_id in by_id:
                scores[hit.claim_id] = scores.get(hit.claim_id, 0.0) + 1 / (self.rrf_k + rank)
        return [
            by_id[claim_id] for claim_id in sorted(scores, key=lambda item: (-scores[item], item))
        ]

    def _apply_reranker(
        self,
        question: str,
        citations: list[ResearchCitation],
    ) -> list[ResearchCitation]:
        assert self.reranker is not None
        requested_ids = self.reranker.rerank(question, citations)
        by_id = {item.claim.id: item for item in citations}
        ordered_ids = [claim_id for claim_id in requested_ids if claim_id in by_id]
        ordered_ids.extend(claim_id for claim_id in by_id if claim_id not in ordered_ids)
        return [by_id[claim_id] for claim_id in ordered_ids]

    @staticmethod
    def _lexical_fallback(
        result: RagSearchResult,
        limit: int,
        reason: str,
    ) -> RagSearchResult:
        citations = result.citations[:limit]
        diagnostics = result.diagnostics.model_copy(
            update={
                "returned_count": len(citations),
                "filtered_count": max(0, result.diagnostics.candidate_count - len(citations)),
                "fallback_reason": reason,
            }
        )
        return RagSearchResult(citations=citations, diagnostics=diagnostics)
