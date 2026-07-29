from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, HttpUrl
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
    subject: str | None = None
    predicate: str | None = None
    object_or_value: str | None = None
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
    conflict_claim_ids: list[str] = Field(default_factory=list)


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
    auth_enabled: bool


class GraphQuery(CamelModel):
    entity_types: list[str] = Field(default_factory=list)
    confidences: list[Confidence] = Field(default_factory=list)
    relation_kinds: list[str] = Field(default_factory=list)
    valid_at: str | None = None


class SourceCreate(CamelModel):
    id: str = Field(min_length=3, max_length=128, pattern=r"^[a-z0-9][a-z0-9._-]+$")
    url: HttpUrl
    title: str = Field(min_length=3, max_length=500)
    publisher: str = Field(min_length=2, max_length=255)
    fetch_enabled: bool = False
    fetch_interval_minutes: int = Field(default=240, ge=120, le=1440)


class SourceView(CamelModel):
    id: str
    url: str
    title: str
    publisher: str
    active: bool
    fetch_enabled: bool
    fetch_interval_minutes: int
    next_fetch_at: datetime | None = None
    created_at: datetime
    last_seen_at: datetime | None = None


class DocumentIngestRequest(CamelModel):
    content: str = Field(min_length=20, max_length=2_000_000)
    published_at: datetime | None = None


class IngestionResult(CamelModel):
    run_id: str
    source_id: str
    change_type: Literal["created", "updated", "unchanged"]
    snapshot_id: str
    content_hash: str
    previous_snapshot_id: str | None = None


class IngestionRunView(CamelModel):
    id: str
    source_id: str
    started_at: datetime
    finished_at: datetime
    status: Literal["succeeded", "failed", "partial"]
    change_type: Literal["created", "updated", "unchanged"]
    snapshot_id: str | None = None
    error: str | None = None


class SchedulerRunSummary(CamelModel):
    due: int
    succeeded: int
    unchanged: int
    failed: int


class CandidateCreate(CamelModel):
    id: str = Field(min_length=3, max_length=128, pattern=r"^[a-z0-9][a-z0-9._-]+$")
    entity_id: str | None = None
    claim: Claim
    evidence: list[Evidence] = Field(min_length=1)
    created_at: datetime | None = None


class CandidateAssessment(CamelModel):
    resolved_entity_id: str | None = None
    resolution: Literal["resolved", "ambiguous", "unresolved"]
    conflicting_claim_ids: list[str] = Field(default_factory=list)
    queue_status: Literal["pending", "needs-more-evidence"]


class ExtractionRequest(CamelModel):
    snapshot_id: str | None = None
    max_candidates: int = Field(default=10, ge=1, le=30)


Role = Literal["viewer", "reviewer", "admin"]


class BootstrapUser(CamelModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=256)


class LoginRequest(CamelModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class UserCreate(CamelModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=256)
    role: Role = "viewer"


class UserView(CamelModel):
    id: str
    email: EmailStr
    role: Role
    active: bool
    daily_digest_enabled: bool
    digest_hour: str
    created_at: datetime


class TokenResponse(CamelModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: UserView


class AuditLogView(CamelModel):
    id: int
    actor: str
    action: str
    target_type: str
    target_id: str
    detail: dict[str, object]
    created_at: datetime


class FollowCreate(CamelModel):
    entity_id: str = Field(min_length=2, max_length=128)
    intensity: Literal["silent", "digest", "instant"] = "digest"


class FollowView(FollowCreate):
    id: str
    created_at: datetime


class NotificationView(CamelModel):
    id: str
    entity_id: str
    change_id: str
    title: str
    priority: Literal["normal", "important"]
    created_at: datetime
    read_at: datetime | None = None


class DigestPreference(CamelModel):
    enabled: bool
    hour: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")


class ResearchCreate(CamelModel):
    question: str = Field(min_length=5, max_length=2000)
    language: Literal["zh", "en"] = "zh"


class ResearchView(CamelModel):
    id: str
    question: str
    summary: str
    claim_ids: list[str]
    steps: list[ResearchStep]
    status: Literal["ready", "insufficient-evidence", "failed", "cancelled"]
    published_slug: str | None = None
    created_at: datetime
    published_at: datetime | None = None


class ResearchCitation(CamelModel):
    claim: Claim
    evidence: list[Evidence]


class PublishedResearchView(ResearchView):
    citations: list[ResearchCitation]


class EmailOutboxView(CamelModel):
    id: str
    to_email: EmailStr
    subject: str
    status: Literal["queued", "sent", "failed"]
    created_at: datetime
    sent_at: datetime | None = None
    error: str | None = None


class DigestRunSummary(CamelModel):
    recipients: int
    messages_queued: int


class EmailDeliverySummary(CamelModel):
    attempted: int
    sent: int
    failed: int


class DataQualityReport(CamelModel):
    entity_count: int
    claim_count: int
    evidence_count: int
    relation_count: int
    core_entities_below_five_relations: list[str]
    claims_with_missing_evidence: list[str]
    live_ready: bool
    issues: list[str]
