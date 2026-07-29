from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )


class LocalizedText(CamelModel):
    zh: str
    en: str


Confidence = Literal["verified", "inferred", "unverified", "conflict"]


class Evidence(CamelModel):
    id: str
    title: LocalizedText
    url: str
    publisher: str
    published_at: str
    collected_at: str
    verified_at: str | None = None
    original_language: Literal["zh", "en"] | None = None
    type: Literal["official", "paper", "news", "community", "benchmark"]
    supports_claim_ids: list[str] | None = None
    contradicts_claim_ids: list[str] | None = None


class ClaimText(LocalizedText):
    technical: LocalizedText | None = None


class Claim(CamelModel):
    id: str
    text: ClaimText
    confidence: Confidence
    source_ids: list[str]
    updated_at: str
    valid_from: str | None = None
    valid_to: str | None = None
    observed_at: str | None = None


class Capability(LocalizedText):
    confidence: Confidence


class Metric(CamelModel):
    name: str
    value: str
    benchmark: str
    date: str
    confidence: Confidence
    source_ids: list[str] | None = None


class Entity(CamelModel):
    id: str
    type: Literal[
        "model",
        "agent",
        "framework",
        "paper",
        "benchmark",
        "company",
        "dataset",
        "api",
        "tool",
        "application",
    ]
    slug: str
    name: LocalizedText
    summary: LocalizedText
    vendor: str | None = None
    origin: LocalizedText | None = None
    status: Literal["active", "deprecated", "preview", "rumor"]
    tags: list[str]
    latest_version: str | None = None
    first_released_at: str | None = None
    last_updated_at: str
    aliases: list[str] | None = None
    capabilities: list[Capability] | None = None
    metrics: list[Metric] | None = None


class TimelineEntry(CamelModel):
    id: str
    date: str
    title: LocalizedText
    summary: LocalizedText
    kind: Literal["release", "update", "paper", "benchmark", "incident", "deprecation"]
    source_ids: list[str]
    confidence: Confidence


class GraphNode(CamelModel):
    id: str
    entity_id: str
    type: str
    importance: float


class GraphEdge(CamelModel):
    id: str
    from_id: str
    to_id: str
    kind: Literal[
        "developed-by",
        "based-on",
        "competes-with",
        "benchmarked-on",
        "uses",
        "cited-by",
        "part-of",
        "successor-of",
    ]
    label: LocalizedText | None = None
    confidence: Confidence
    source_ids: list[str]
    valid_from: str | None = None
    valid_to: str | None = None


class GraphSnapshot(CamelModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    captured_at: str
    valid_at: str


class ChangeEvent(CamelModel):
    id: str
    entity_id: str
    date: str
    summary: LocalizedText
    kind: Literal["new", "updated", "deprecated", "benchmark", "rumor"]
    confidence: Confidence
    source_ids: list[str] | None = None


class FollowPreference(CamelModel):
    entity_id: str
    intensity: Literal["silent", "digest", "instant"]
    added_at: str
    reason: LocalizedText


class InterestProfileItem(CamelModel):
    id: str
    label: LocalizedText
    score: float


class ResearchStep(CamelModel):
    id: str
    label: LocalizedText
    status: Literal["pending", "running", "complete", "failed", "cancelled"]
    detail: LocalizedText | None = None


class ResearchAnswer(CamelModel):
    id: str
    question: LocalizedText
    summary: LocalizedText
    claim_ids: list[str]
    steps: list[ResearchStep]
    generated_at: str
    status: Literal["ready", "insufficient-evidence", "failed", "cancelled"]


class Notification(CamelModel):
    id: str
    entity_id: str
    change_id: str
    created_at: str
    read_at: str | None = None
    priority: Literal["normal", "important"]


class ReviewCandidate(CamelModel):
    id: str
    entity_id: str | None = None
    claim: Claim
    evidence_ids: list[str]
    status: Literal["pending", "approved", "rejected", "needs-more-evidence"]
    created_at: str
    reviewed_at: str | None = None


class SyncRun(CamelModel):
    id: str
    source_id: str
    started_at: str
    finished_at: str | None = None
    status: Literal["running", "succeeded", "failed", "partial"]
    documents_seen: int
    candidates_created: int
    error: str | None = None


class DataMeta(CamelModel):
    mode: Literal["demo", "live"]
    freshness: Literal["fresh", "cached", "stale", "offline"]
    retrieved_at: str
    cached_at: str | None = None
    message: LocalizedText | None = None


class KnowledgeSnapshot(CamelModel):
    meta: DataMeta
    entities: list[Entity]
    evidence: list[Evidence]
    claims: list[Claim]
    timeline: dict[str, list[TimelineEntry]]
    graph: GraphSnapshot
    changes: list[ChangeEvent]
    following: list[FollowPreference]
    interest_profile: list[InterestProfileItem]
    research_questions: list[LocalizedText]
    research_answers: list[ResearchAnswer]
    notifications: list[Notification]
    review_candidates: list[ReviewCandidate]
    sync_runs: list[SyncRun]


class ReviewDecision(CamelModel):
    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=3, max_length=500)


class ReviewQueueItem(ReviewCandidate):
    version: int
    review_reason: str | None = None


class PublicationRecord(CamelModel):
    id: int
    review_job_id: str
    claim_id: str
    published_at: datetime
    actor: str


class HealthResponse(CamelModel):
    ok: bool
    environment: str
    data_mode: Literal["demo", "live"]
    database: str
    admin_writes_enabled: bool


class GraphQuery(CamelModel):
    entity_types: list[str] = Field(default_factory=list)
    confidences: list[Confidence] = Field(default_factory=list)
    relation_kinds: list[str] = Field(default_factory=list)
    valid_at: str | None = None
