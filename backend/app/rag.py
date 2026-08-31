from __future__ import annotations

import hashlib
import json
import logging
import math
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from time import perf_counter
from typing import Protocol

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .database import RagClaimDocumentRecord, RagClaimEmbeddingRecord
from .entity_aliases import normalize_entity_alias
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
LOGGER = logging.getLogger(__name__)


@dataclass(slots=True)
class RagSearchResult:
    citations: list[ResearchCitation]
    diagnostics: RetrievalDiagnostics
    retrieval_mode: str = "lexical"


class RagRetriever(Protocol):
    def prepare(self, session: Session, snapshot: KnowledgeSnapshot) -> None: ...

    def search(
        self,
        session: Session,
        snapshot: KnowledgeSnapshot,
        question: str,
        *,
        limit: int = 8,
        prepared: bool = False,
    ) -> RagSearchResult: ...


class EmbeddingProvider(Protocol):
    @property
    def provider_name(self) -> str: ...

    @property
    def model_name(self) -> str: ...

    @property
    def model_version(self) -> str: ...

    @property
    def dimension(self) -> int: ...

    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...


@dataclass(frozen=True, slots=True)
class VectorDocument:
    claim_id: str
    content_hash: str
    embedding_provider: str
    embedding_model: str
    embedding_version: str
    embedding_dimension: int
    vector: list[float]


@dataclass(frozen=True, slots=True)
class VectorSearchHit:
    claim_id: str
    score: float


class VectorClaimIndex(Protocol):
    def stale_documents(self, session: Session) -> list[RagClaimDocumentRecord]: ...

    def upsert(self, session: Session, documents: list[VectorDocument]) -> None: ...

    def search(
        self, session: Session, vector: list[float], *, limit: int
    ) -> list[VectorSearchHit]: ...


class SqlAlchemyVectorClaimIndex:
    def __init__(
        self,
        *,
        embedding_provider: str,
        embedding_model: str,
        embedding_version: str,
        embedding_dimension: int,
    ) -> None:
        self.embedding_provider = embedding_provider
        self.embedding_model = embedding_model
        self.embedding_version = embedding_version
        self.embedding_dimension = embedding_dimension

    def stale_documents(self, session: Session) -> list[RagClaimDocumentRecord]:
        documents = list(session.scalars(select(RagClaimDocumentRecord)).all())
        embeddings = list(
            session.scalars(
                select(RagClaimEmbeddingRecord).where(
                    RagClaimEmbeddingRecord.embedding_provider == self.embedding_provider,
                    RagClaimEmbeddingRecord.embedding_model == self.embedding_model,
                    RagClaimEmbeddingRecord.embedding_version == self.embedding_version,
                )
            ).all()
        )
        by_claim_id = {item.claim_id: item for item in embeddings}
        return [
            document
            for document in documents
            if (embedding := by_claim_id.get(document.claim_id)) is None
            or embedding.content_hash != document.content_hash
            or embedding.embedding_dimension != self.embedding_dimension
        ]

    def upsert(self, session: Session, documents: list[VectorDocument]) -> None:
        now = datetime.now(UTC)
        for document in documents:
            self._validate_document(document)
            row = session.scalar(
                select(RagClaimEmbeddingRecord).where(
                    RagClaimEmbeddingRecord.claim_id == document.claim_id,
                    RagClaimEmbeddingRecord.embedding_provider == self.embedding_provider,
                    RagClaimEmbeddingRecord.embedding_model == self.embedding_model,
                    RagClaimEmbeddingRecord.embedding_version == self.embedding_version,
                )
            )
            vector_json = json.dumps(document.vector, separators=(",", ":"))
            if row is None:
                session.add(
                    RagClaimEmbeddingRecord(
                        claim_id=document.claim_id,
                        embedding_provider=self.embedding_provider,
                        embedding_model=self.embedding_model,
                        embedding_version=self.embedding_version,
                        embedding_dimension=self.embedding_dimension,
                        content_hash=document.content_hash,
                        vector_json=vector_json,
                        embedded_at=now,
                    )
                )
            else:
                row.embedding_dimension = self.embedding_dimension
                row.content_hash = document.content_hash
                row.vector_json = vector_json
                row.embedded_at = now
        session.flush()

    def search(self, session: Session, vector: list[float], *, limit: int) -> list[VectorSearchHit]:
        if len(vector) != self.embedding_dimension:
            raise ValueError("Query embedding dimension does not match the active index.")
        rows = session.execute(
            select(RagClaimEmbeddingRecord, RagClaimDocumentRecord)
            .join(
                RagClaimDocumentRecord,
                RagClaimDocumentRecord.claim_id == RagClaimEmbeddingRecord.claim_id,
            )
            .where(
                RagClaimEmbeddingRecord.embedding_provider == self.embedding_provider,
                RagClaimEmbeddingRecord.embedding_model == self.embedding_model,
                RagClaimEmbeddingRecord.embedding_version == self.embedding_version,
                RagClaimEmbeddingRecord.content_hash == RagClaimDocumentRecord.content_hash,
            )
        ).all()
        query_norm = math.sqrt(sum(value * value for value in vector))
        if query_norm == 0:
            raise ValueError("Query embedding must have a non-zero norm.")
        scored: list[VectorSearchHit] = []
        for embedding, _ in rows:
            candidate = [float(value) for value in json.loads(embedding.vector_json)]
            if len(candidate) != self.embedding_dimension:
                continue
            candidate_norm = math.sqrt(sum(value * value for value in candidate))
            if candidate_norm == 0:
                continue
            score = sum(left * right for left, right in zip(vector, candidate, strict=True))
            scored.append(
                VectorSearchHit(
                    claim_id=embedding.claim_id,
                    score=score / (query_norm * candidate_norm),
                )
            )
        return sorted(scored, key=lambda item: (-item.score, item.claim_id))[:limit]

    def _validate_document(self, document: VectorDocument) -> None:
        expected = (
            self.embedding_provider,
            self.embedding_model,
            self.embedding_version,
            self.embedding_dimension,
        )
        actual = (
            document.embedding_provider,
            document.embedding_model,
            document.embedding_version,
            document.embedding_dimension,
        )
        if actual != expected or len(document.vector) != self.embedding_dimension:
            raise ValueError("Vector document metadata does not match the active index.")


class ClaimReranker(Protocol):
    def rerank(
        self,
        question: str,
        citations: list[ResearchCitation],
    ) -> list[str]: ...


class LexicalRagRetriever:
    def prepare(self, session: Session, snapshot: KnowledgeSnapshot) -> None:
        self.sync_snapshot(session, snapshot)

    def search(
        self,
        session: Session,
        snapshot: KnowledgeSnapshot,
        question: str,
        *,
        limit: int = 8,
        prepared: bool = False,
    ) -> RagSearchResult:
        started = perf_counter()
        if not prepared:
            self.prepare(session, snapshot)
        matched_entity_ids = self.resolve_mentions(snapshot.entities, question)
        search_entity_ids = self.expand_entity_scope(snapshot.entities, matched_entity_ids)
        base_statement = select(RagClaimDocumentRecord).where(
            RagClaimDocumentRecord.lifecycle_status == "current"
        )
        fallback_reason: str | None = None
        rows: list[RagClaimDocumentRecord] = []
        if search_entity_ids:
            rows = list(
                session.scalars(
                    base_statement.where(RagClaimDocumentRecord.entity_id.in_(search_entity_ids))
                ).all()
            )
            covered = {
                entity_id
                for entity_id in matched_entity_ids
                if any(
                    row.entity_id in self.expand_entity_scope(snapshot.entities, {entity_id})
                    for row in rows
                )
            }
            if covered != matched_entity_ids:
                fallback_reason = "entity-scope-incomplete"
        if not search_entity_ids or fallback_reason == "entity-scope-incomplete":
            related_statement = base_statement
            query_text = self.postgres_query_text(question)
            if session.get_bind().dialect.name == "postgresql" and query_text:
                query = func.websearch_to_tsquery("simple", query_text)
                vector = func.to_tsvector("simple", RagClaimDocumentRecord.search_text)
                related_statement = related_statement.where(vector.op("@@")(query))
            elif session.get_bind().dialect.name == "postgresql":
                fallback_reason = "query-has-no-indexable-terms"
            related_rows = list(session.scalars(related_statement).all())
            rows_by_id = {row.claim_id: row for row in [*rows, *related_rows]}
            rows = list(rows_by_id.values())
        if not rows and not matched_entity_ids:
            fallback_reason = fallback_reason or "full-text-no-match"
            rows = list(session.scalars(base_statement).all())
        entity_type_by_id = {entity.id: entity.type for entity in snapshot.entities}
        preferred_entity_types = (
            self.resolve_entity_type_intent(question) if not matched_entity_ids else set()
        )
        scored = sorted(
            (
                (
                    self.score(row, question, search_entity_ids)
                    + (
                        0.3
                        if entity_type_by_id.get(row.entity_id) in preferred_entity_types
                        else 0.0
                    ),
                    row,
                )
                for row in rows
            ),
            key=lambda item: (-item[0], item[1].claim_id),
        )
        selected = self.select_diverse_rows(
            scored,
            snapshot.entities,
            matched_entity_ids,
            limit,
        )
        citations = self.citations_from_rows(selected)
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
    def citations_from_rows(rows: list[RagClaimDocumentRecord]) -> list[ResearchCitation]:
        return [
            ResearchCitation(
                claim=Claim.model_validate_json(row.claim_json),
                evidence=[Evidence.model_validate(item) for item in json.loads(row.evidence_json)],
            )
            for row in rows
        ]

    def citations_for_claim_ids(
        self, session: Session, claim_ids: list[str]
    ) -> list[ResearchCitation]:
        if not claim_ids:
            return []
        rows = list(
            session.scalars(
                select(RagClaimDocumentRecord).where(RagClaimDocumentRecord.claim_id.in_(claim_ids))
            ).all()
        )
        by_id = {row.claim_id: row for row in rows}
        return self.citations_from_rows(
            [by_id[claim_id] for claim_id in claim_ids if claim_id in by_id]
        )

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
        key = normalize_entity_alias(question)
        matches: list[tuple[str, str, int]] = []
        for entity in entities:
            canonical = {
                normalize_entity_alias(value)
                for value in [entity.slug, entity.name.zh, entity.name.en]
                if value.strip()
            }
            aliases = {
                normalize_entity_alias(value) for value in entity.aliases or [] if value.strip()
            }
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

    @staticmethod
    def resolve_entity_type_intent(question: str) -> set[str]:
        """在没有点名具体实体的宽泛问题中，优先召回与问题类型一致的事实。"""
        key = question.casefold()
        intents: set[str] = set()
        if "模型" in key or "model" in key:
            intents.add("model")
        if "agent" in key or "智能体" in key:
            intents.add("agent")
        if "框架" in key or "framework" in key:
            intents.add("framework")
        if "公司" in key or "company" in key or "机构" in key:
            intents.add("company")
        if "论文" in key or "paper" in key:
            intents.add("paper")
        if "基准" in key or "benchmark" in key:
            intents.add("benchmark")
        return intents

    @staticmethod
    def expand_entity_scope(entities: list[Entity], matched_entity_ids: set[str]) -> set[str]:
        """系列问题同时检索具体版本，但具体版本问题不会反向扩大到整个系列。"""
        scope = set(matched_entity_ids)
        while True:
            children = {
                entity.id
                for entity in entities
                if entity.family_id is not None and entity.family_id in scope
            }
            expanded = scope | children
            if expanded == scope:
                return scope
            scope = expanded

    @classmethod
    def select_diverse_rows(
        cls,
        scored: list[tuple[float, RagClaimDocumentRecord]],
        entities: list[Entity],
        matched_entity_ids: set[str],
        limit: int,
    ) -> list[RagClaimDocumentRecord]:
        """多实体问题先为每个实体保留一个结果，再按总分补足。"""
        eligible = [(score, row) for score, row in scored if score > 0]
        selected: list[RagClaimDocumentRecord] = []
        selected_ids: set[str] = set()
        if len(matched_entity_ids) > 1:
            for entity_id in sorted(matched_entity_ids):
                scope = cls.expand_entity_scope(entities, {entity_id})
                match = next((row for _, row in eligible if row.entity_id in scope), None)
                if match is not None and match.claim_id not in selected_ids:
                    selected.append(match)
                    selected_ids.add(match.claim_id)
                    if len(selected) >= limit:
                        return selected
        for _, row in eligible:
            if row.claim_id in selected_ids:
                continue
            selected.append(row)
            selected_ids.add(row.claim_id)
            if len(selected) >= limit:
                break
        return selected

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

    def prepare(self, session: Session, snapshot: KnowledgeSnapshot) -> None:
        self.lexical.prepare(session, snapshot)
        if not self.enabled or self.embedding_provider is None or self.vector_index is None:
            return
        stale = self.vector_index.stale_documents(session)
        if not stale:
            return
        vectors = self.embedding_provider.embed_documents([item.search_text for item in stale])
        if len(vectors) != len(stale):
            raise ValueError("Embedding provider returned an unexpected document count.")
        documents = [
            VectorDocument(
                claim_id=row.claim_id,
                content_hash=row.content_hash,
                embedding_provider=self.embedding_provider.provider_name,
                embedding_model=self.embedding_provider.model_name,
                embedding_version=self.embedding_provider.model_version,
                embedding_dimension=self.embedding_provider.dimension,
                vector=vector,
            )
            for row, vector in zip(stale, vectors, strict=True)
        ]
        with session.begin_nested():
            self.vector_index.upsert(session, documents)

    def search(
        self,
        session: Session,
        snapshot: KnowledgeSnapshot,
        question: str,
        *,
        limit: int = 8,
        prepared: bool = False,
    ) -> RagSearchResult:
        if not self.enabled:
            lexical_result = self.lexical.search(
                session,
                snapshot,
                question,
                limit=max(32, limit * 4),
                prepared=prepared,
            )
            return self._lexical_fallback(lexical_result, limit, "hybrid-disabled")
        if self.embedding_provider is None or self.vector_index is None:
            lexical_result = self.lexical.search(
                session,
                snapshot,
                question,
                limit=max(32, limit * 4),
                prepared=prepared,
            )
            return self._lexical_fallback(lexical_result, limit, "hybrid-unavailable")

        try:
            if not prepared:
                self.prepare(session, snapshot)
            lexical_result = self.lexical.search(
                session,
                snapshot,
                question,
                limit=max(32, limit * 4),
                prepared=True,
            )
            vector = self.embedding_provider.embed_query(question)
            vector_hits = self.vector_index.search(session, vector, limit=max(32, limit * 4))
            vector_citations = self.lexical.citations_for_claim_ids(
                session, [item.claim_id for item in vector_hits]
            )
            citations = self._fuse(
                lexical_result.citations,
                vector_hits,
                vector_citations,
            )
            if self.reranker is not None and citations:
                citations = self._apply_reranker(question, citations)
        except Exception as exc:  # noqa: BLE001 -- 第三方供应商异常必须统一降级。
            LOGGER.warning(
                "hybrid retrieval degraded to lexical",
                extra={
                    "embedding_provider": self.embedding_provider.provider_name,
                    "embedding_model": self.embedding_provider.model_name,
                    "error_type": type(exc).__name__,
                },
            )
            lexical_result = self.lexical.search(
                session,
                snapshot,
                question,
                limit=max(32, limit * 4),
                prepared=True,
            )
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
        vector_citations: list[ResearchCitation],
    ) -> list[ResearchCitation]:
        by_id = {item.claim.id: item for item in lexical_citations}
        by_id.update({item.claim.id: item for item in vector_citations})
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
