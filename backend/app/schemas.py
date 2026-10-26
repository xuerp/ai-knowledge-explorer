from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    HttpUrl,
    field_validator,
    model_validator,
)
from pydantic.alias_generators import to_camel

from .decision_semantics import TaskMeaningReceipt


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
RelationKind = Literal[
    "developed-by",
    "based-on",
    "competes-with",
    "benchmarked-on",
    "uses",
    "cited-by",
    "part-of",
    "successor-of",
    "integrates-with",
]
RELATION_KINDS: tuple[RelationKind, ...] = (
    "developed-by",
    "based-on",
    "competes-with",
    "benchmarked-on",
    "uses",
    "cited-by",
    "part-of",
    "successor-of",
    "integrates-with",
)


class Evidence(CamelModel):
    id: str
    title: LocalizedText
    url: str
    publisher: str
    published_at: str
    collected_at: str
    verified_at: str | None = None
    source_excerpt: str | None = None
    source_excerpt_kind: Literal["quote", "summary", "unclassified"] = "unclassified"
    original_language: Literal["zh", "en"] | None = None
    type: Literal["official", "paper", "news", "community", "benchmark"]
    supports_claim_ids: list[str] | None = None
    contradicts_claim_ids: list[str] | None = None


class ClaimText(LocalizedText):
    technical: LocalizedText | None = None


class Claim(CamelModel):
    id: str
    entity_id: str | None = None
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


class EntitySpecs(CamelModel):
    context_window: str | None = None
    input_price: str | None = None
    output_price: str | None = None
    modalities: str | None = None
    tool_use: str | None = None
    availability: str | None = None


class KnowledgePoint(CamelModel):
    title: LocalizedText
    description: LocalizedText
    source_ids: list[str] | None = None


class KnowledgeUseCase(CamelModel):
    title: LocalizedText
    description: LocalizedText


class KnowledgeSection(CamelModel):
    id: str
    title: LocalizedText
    summary: LocalizedText
    items: list[LocalizedText] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)


class EntityKnowledge(CamelModel):
    introduction: list[LocalizedText]
    significance: LocalizedText
    key_points: list[KnowledgePoint]
    use_cases: list[KnowledgeUseCase]
    limitations: list[LocalizedText]
    official_url: str | None = None
    sections: list[KnowledgeSection] = Field(default_factory=list)


class ModelAccessChannel(CamelModel):
    type: Literal[
        "official-api",
        "first-party-product",
        "managed-cloud",
        "open-weights",
        "restricted-access",
    ]
    provider: str
    model_id: str | None = None
    url: str | None = None


class ModelProductLine(CamelModel):
    id: str
    name: LocalizedText
    positioning: LocalizedText


class ModelReleaseMetadata(CamelModel):
    generation: str
    variant: str
    release_id: str
    api_model_ids: list[str] = Field(default_factory=list)
    stage: Literal["stable", "preview", "pending", "deprecated", "retired"]
    product_line: ModelProductLine | None = None
    catalog_current: bool | None = None
    released_at: str | None = None
    retirement_not_before: str | None = None
    last_verified_at: str
    access_channels: list[ModelAccessChannel] = Field(default_factory=list)


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
    family_id: str | None = None
    release: ModelReleaseMetadata | None = None
    specs: EntitySpecs | None = None
    capabilities: list[Capability] | None = None
    metrics: list[Metric] | None = None
    knowledge: EntityKnowledge | None = None


ChangeKind = Literal[
    "new", "updated", "deprecated", "benchmark", "rumor", "pricing", "availability"
]


class ChangeDetail(CamelModel):
    description: LocalizedText
    before: LocalizedText
    after: LocalizedText
    affected: LocalizedText
    action: LocalizedText


class TimelineEntry(CamelModel):
    id: str
    date: str
    date_kind: Literal["release", "announcement", "catalog-review"] | None = None
    release_entity_id: str | None = None
    change_kind: ChangeKind | None = None
    detail: ChangeDetail | None = None
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
    kind: RelationKind
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
    kind: ChangeKind
    detail: ChangeDetail | None = None
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


ReviewReasonCategory = Literal[
    "unsupported_evidence",
    "duplicate",
    "conflict",
    "schema_error",
    "low_confidence",
]


class ReviewDecision(CamelModel):
    expected_version: int = Field(ge=1)
    reason: str | None = Field(default=None, min_length=3, max_length=500)
    reason_note: str | None = Field(default=None, min_length=3, max_length=500)
    reason_category: ReviewReasonCategory | None = None


class ReviewLifecycleDecision(ReviewDecision):
    target_claim_id: str = Field(min_length=1, max_length=128)
    expected_target_version: int = Field(ge=1)
    idempotency_key: str = Field(min_length=8, max_length=128)


class ReviewPublicationStateRequest(CamelModel):
    action: Literal["retract", "restore"]
    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=3, max_length=500)


class ReviewRevisionRequest(CamelModel):
    expected_version: int = Field(ge=1)
    idempotency_key: str = Field(min_length=8, max_length=128)
    text_zh: str = Field(min_length=1, max_length=10000)
    text_en: str = Field(min_length=1, max_length=10000)
    reason: str = Field(min_length=3, max_length=500)


class ReviewBatchDecision(CamelModel):
    id: str = Field(min_length=1, max_length=128)
    expected_version: int = Field(ge=1)
    reason: str | None = Field(default=None, min_length=3, max_length=500)
    reason_note: str | None = Field(default=None, min_length=3, max_length=500)
    reason_category: ReviewReasonCategory | None = None


class ReviewBatchApproval(CamelModel):
    items: list[ReviewBatchDecision] = Field(min_length=1, max_length=50)


class ReviewQueueItem(ReviewCandidate):
    version: int
    reason_category: ReviewReasonCategory | None = None
    reason_note: str | None = None
    # Compatibility alias for clients deployed before structured rejection reasons.
    review_reason: str | None = None
    review_method: Literal["human", "automation"] | None = None
    evidence_items: list[Evidence] = Field(default_factory=list)
    conflict_claim_ids: list[str] = Field(default_factory=list)
    lifecycle_status: Literal["current", "superseded", "historical", "retracted"] = "current"
    publication_action: Literal["new", "merged-evidence", "superseding"] = "new"
    target_claim_id: str | None = None
    superseded_by_claim_id: str | None = None


class ReviewInventoryReport(CamelModel):
    generated_at: str
    open_total: int
    by_entity: dict[str, int]
    by_source: dict[str, int]
    by_month: dict[str, int]
    risk_counts: dict[str, int]
    deterministic_duplicate_groups: int
    possible_update_groups: int
    conflict_items: int
    missing_evidence_items: int
    invalid_anchor_items: int
    stale_items: int
    duplicate_with_published_items: int


class ReviewReasonBreakdown(CamelModel):
    category: ReviewReasonCategory | Literal["uncategorized"]
    count: int
    ratio: float


class ReviewStats(CamelModel):
    generated_at: datetime
    open_count: int
    reviewed_count: int
    approved_count: int
    rejected_count: int
    approval_rate: float
    rejection_rate: float
    average_review_seconds: float | None = None
    reviewed_with_duration_count: int
    last_reviewed_at: datetime | None = None
    rejection_reasons: list[ReviewReasonBreakdown]


class EntityClaimPage(CamelModel):
    total: int = 0
    items: list[Claim]
    evidence: list[Evidence]
    next_cursor: str | None = None


class PublicationRecord(CamelModel):
    id: int
    review_job_id: str
    claim_id: str
    published_at: datetime
    actor: str


class HealthResponse(CamelModel):
    ok: bool
    release: str
    build_commit: str
    schema_revision: str
    built_at: str | None = None
    environment: str
    data_mode: Literal["demo", "live"]
    database: str
    admin_writes_enabled: bool
    auth_enabled: bool


class RelationBackfillStatus(CamelModel):
    configured: bool
    status: Literal["disabled", "waiting", "running", "complete"]
    batch_id: str | None = None
    budget: int
    attempts: int
    succeeded: int
    failed: int
    candidates_created: int
    duplicates_skipped: int
    relations_auto_approved: int
    attempts_remaining: int
    eligible_snapshots: int
    relation_deficit: int
    core_entities_below_requirement: int


class IntegrationStatus(CamelModel):
    extraction_configured: bool
    extraction_pipeline_version: str
    extraction_endpoint_host: str | None = None
    extraction_model: str | None = None
    extraction_reasoning_effort: str | None = None
    extraction_max_completion_tokens: int | None = None
    automatic_extraction_enabled: bool
    automatic_extraction_max_snapshots_per_cycle: int
    automatic_extraction_max_candidates_per_snapshot: int
    automatic_extraction_retry_minutes: int
    automatic_relation_approval_enabled: bool
    retrieval_mode: Literal["lexical", "hybrid"]
    embedding_configured: bool
    embedding_provider: Literal["none", "cloudflare"]
    embedding_model: str | None = None
    embedding_version: str | None = None
    embedding_dimension: int | None = None
    embedding_daily_neuron_budget: float | None = None
    embedding_daily_api_call_budget: int | None = None
    smtp_configured: bool
    smtp_host: str | None = None
    smtp_from: str | None = None
    email_delivery_provider: Literal["smtp", "resend"]
    email_delivery_endpoint_host: str | None = None
    fetch_allowed_hosts: list[str]
    registered_sources: int
    automatic_sources: int
    digest_timezone: str


class ExtractionProbeResult(CamelModel):
    configured: bool
    passed: bool
    checked_at: datetime
    latency_ms: int
    endpoint_host: str | None = None
    model: str | None = None
    error_code: str | None = None
    detail: str


class ProductionReadinessCheck(CamelModel):
    code: str
    title: str
    status: Literal["ready", "blocked", "warning", "manual"]
    detail: str
    action: str | None = None


class ProductionReadiness(CamelModel):
    generated_at: datetime
    automated_ready: bool
    blocking_count: int
    warning_count: int
    checks: list[ProductionReadinessCheck]
    manual_checks: list[ProductionReadinessCheck]


class ReleaseClaimMetrics(CamelModel):
    public_claim_count: int
    entity_linked_public_claim_count: int
    approved_claim_count: int
    human_reviewed_claim_count: int
    auto_approved_relation_claim_count: int
    current_claim_count: int
    historical_claim_count: int


class ClaimEntityAuditItem(CamelModel):
    claim_id: str
    review_job_id: str | None = None
    version: int | None = None
    current_entity_id: str | None = None
    subject: str | None = None
    resolution: Literal[
        "deterministic",
        "review-required",
        "ambiguous",
        "unresolved",
        "invalid",
    ]
    proposed_entity_id: str | None = None
    candidate_entity_ids: list[str] = Field(default_factory=list)
    reason: str
    recommended_action: Literal["assign", "retract"] | None = None
    recommended_entity_id: str | None = None
    recommendation_reason: str | None = None


class ClaimEntityAuditReport(CamelModel):
    generated_at: datetime
    public_claim_count: int
    linked_claim_count: int
    missing_or_invalid_count: int
    deterministic_repair_count: int
    manual_review_count: int
    items: list[ClaimEntityAuditItem]


class ClaimEntityRepairRequest(CamelModel):
    mode: Literal["dry-run", "apply"] = "dry-run"
    claim_ids: list[str] = Field(default_factory=list, max_length=50)


class ClaimEntityRepairItem(CamelModel):
    review_job_id: str
    claim_id: str
    previous_entity_id: str | None = None
    proposed_entity_id: str | None = None
    status: Literal["repairable", "repaired", "skipped"]
    reason: str


class ClaimEntityRepairReport(CamelModel):
    generated_at: datetime
    mode: Literal["dry-run", "apply"]
    total: int
    repairable_count: int
    repaired_count: int
    items: list[ClaimEntityRepairItem]


class ClaimEntityResolutionRequest(CamelModel):
    claim_id: str = Field(min_length=1, max_length=128)
    action: Literal["assign", "retract"]
    entity_id: str | None = Field(default=None, min_length=1, max_length=128)
    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=8, max_length=500)


class ClaimEntityResolutionResult(CamelModel):
    review_job_id: str
    claim_id: str
    status: Literal["assigned", "retracted"]
    previous_entity_id: str | None = None
    entity_id: str | None = None
    lifecycle_status: Literal["current", "retracted"]
    version: int


class RelationClaimAuditItem(CamelModel):
    review_job_id: str
    claim_id: str
    source_entity_id: str | None = None
    predicate: str | None = None
    target_reference: str | None = None
    proposed_target_entity_id: str | None = None
    relation_id: str | None = None
    relation_kind: str | None = None
    status: Literal["repairable", "linked", "review-required", "invalid"]
    reason: str


class RelationClaimAuditReport(CamelModel):
    generated_at: datetime
    total_relation_claims: int
    linked_count: int
    repairable_count: int
    manual_review_count: int
    items: list[RelationClaimAuditItem]


class RelationClaimRepairRequest(CamelModel):
    mode: Literal["dry-run", "apply"] = "dry-run"
    claim_ids: list[str] = Field(default_factory=list, max_length=50)


class RelationClaimRepairItem(CamelModel):
    review_job_id: str
    claim_id: str
    relation_id: str | None = None
    status: Literal["repairable", "repaired", "skipped"]
    reason: str


class RelationClaimRepairReport(CamelModel):
    generated_at: datetime
    mode: Literal["dry-run", "apply"]
    total: int
    repairable_count: int
    repaired_count: int
    items: list[RelationClaimRepairItem]


class GraphQuery(CamelModel):
    entity_types: list[str] = Field(default_factory=list)
    confidences: list[Confidence] = Field(default_factory=list)
    relation_kinds: list[str] = Field(default_factory=list)
    valid_at: str | None = None


class ModelVersionCompareRequest(CamelModel):
    version_ids: list[str] = Field(min_length=2, max_length=4)


class SourceCreate(CamelModel):
    id: str = Field(min_length=3, max_length=128, pattern=r"^[a-z0-9][a-z0-9._-]+$")
    url: HttpUrl
    title: str = Field(min_length=3, max_length=500)
    publisher: str = Field(min_length=2, max_length=255)
    fetch_url: HttpUrl | None = None
    fallback_urls: list[HttpUrl] = Field(default_factory=list, max_length=5)
    fetch_enabled: bool = False
    fetch_interval_minutes: int = Field(default=240, ge=120, le=1440)


class SourceUpdate(CamelModel):
    active: bool | None = None
    fetch_enabled: bool | None = None
    fetch_interval_minutes: int | None = Field(default=None, ge=120, le=1440)
    fetch_url: HttpUrl | None = None
    fallback_urls: list[HttpUrl] | None = Field(default=None, max_length=5)


class SourceView(CamelModel):
    id: str
    url: str
    title: str
    publisher: str
    fetch_url: str | None = None
    effective_fetch_url: str
    fallback_urls: list[str] = Field(default_factory=list)
    last_successful_fetch_url: str | None = None
    active: bool
    fetch_enabled: bool
    fetch_interval_minutes: int
    next_fetch_at: datetime | None = None
    created_at: datetime
    last_seen_at: datetime | None = None
    consecutive_failures: int = 0
    last_fetch_error: str | None = None
    failure_kind: (
        Literal[
            "network",
            "timeout",
            "rate-limited",
            "upstream",
            "blocked",
            "redirect",
            "allowlist",
            "content",
            "unknown",
        ]
        | None
    ) = None
    auto_paused_at: datetime | None = None
    health_state: Literal["healthy", "retrying", "paused", "manual", "unverified"]
    fetch_lease_expires_at: datetime | None = None
    last_probe_at: datetime | None = None
    last_probe_status: Literal["passed", "failed"] | None = None
    last_probe_error: str | None = None
    last_probe_content_type: str | None = None
    last_probe_readable_characters: int | None = None
    collection_strategy: Literal["automatic", "manual", "unverified"]
    collection_reason: str


class SourceProbeResult(CamelModel):
    source_id: str
    url: str
    content_type: str
    readable_characters: int
    etag: str | None = None
    last_modified: str | None = None


class EmailOutboxRetryRequest(CamelModel):
    expected_attempt_count: int = Field(ge=0)


class SourceRetryRequest(CamelModel):
    expected_failure_count: int = Field(ge=0)


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


class DocumentSnapshotView(CamelModel):
    id: str
    source_id: str
    content_hash: str
    content_preview: str
    readable_characters: int
    observed_at: datetime
    published_at: datetime | None = None
    previous_snapshot_id: str | None = None


class IngestionRunView(CamelModel):
    id: str
    source_id: str
    started_at: datetime
    finished_at: datetime
    status: Literal["succeeded", "failed", "partial"]
    change_type: Literal["created", "updated", "unchanged", "failed"]
    snapshot_id: str | None = None
    error: str | None = None


class SchedulerRunSummary(CamelModel):
    due: int
    succeeded: int
    unchanged: int
    failed: int
    failed_source_ids: list[str] = Field(default_factory=list)


class AutomationRunView(CamelModel):
    id: str
    worker_id: str
    trigger: Literal["scheduled", "manual"]
    status: Literal["running", "succeeded", "partial", "failed"]
    started_at: datetime
    finished_at: datetime | None = None
    duration_ms: int | None = None
    result: dict[str, object] | None = None
    error: str | None = None


class AutomationCycleResponse(CamelModel):
    cycle_id: str
    worker_id: str
    status: Literal["succeeded", "partial"]
    result: dict[str, object]
    next_cycle_at: datetime


class WorkerStatusView(CamelModel):
    worker_id: str
    state: Literal["starting", "running", "idle", "failed", "stopped"]
    started_at: datetime
    heartbeat_at: datetime
    heartbeat_age_seconds: int
    next_cycle_at: datetime | None = None
    last_cycle_id: str | None = None
    last_cycle_started_at: datetime | None = None
    last_cycle_finished_at: datetime | None = None
    last_cycle_status: Literal["running", "succeeded", "partial", "failed"] | None = None
    consecutive_failures: int
    last_error: str | None = None


class OperationsQueueSummary(CamelModel):
    automatic_sources: int
    sources_due: int
    sources_retrying: int
    sources_paused: int
    extraction_ready: int
    extraction_retrying: int
    email_queued: int
    email_retrying: int
    email_sending: int
    email_failed: int


class OperationsDiagnostics(CamelModel):
    generated_at: datetime
    heartbeat_status: Literal["healthy", "stale", "missing"]
    stale_after_seconds: int
    worker: WorkerStatusView | None = None
    recent_runs: list[AutomationRunView]
    queues: OperationsQueueSummary


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


class ExtractionPlanItem(CamelModel):
    source_id: str
    source_title: str
    snapshot_id: str
    observed_at: datetime
    readable_characters: int


Role = Literal["viewer", "reviewer", "admin"]


class BootstrapUser(CamelModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=256)


class LoginRequest(CamelModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)
    remember_me: bool = False


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


class DecisionBudget(CamelModel):
    mode: Literal["cost-first", "range", "unknown"] = "unknown"
    cost_scope: Literal["all-costs", "standard-token-only"] = "all-costs"
    maximum_input_tokens_per_request: int | None = Field(
        default=None, ge=1, le=100_000_000, strict=True
    )
    min: float | None = Field(default=None, ge=0, le=1_000_000_000_000, allow_inf_nan=False)
    max: float | None = Field(default=None, ge=0, le=1_000_000_000_000, allow_inf_nan=False)
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3,8}$")
    period: Literal["month", "per-million-tokens"] = "month"
    monthly_input_tokens: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    monthly_output_tokens: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    channel: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def validate_range(self) -> DecisionBudget:
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError("budget min must not exceed max")
        return self


class DecisionServiceAccess(CamelModel):
    channel: str = Field(min_length=1, max_length=200)
    tier: Literal["paid", "free", "unknown"] = "unknown"
    region: str | None = Field(default=None, pattern=r"^[A-Z]{2}$")

    @field_validator("channel", mode="before")
    @classmethod
    def trim_channel(cls, value):
        return value.strip() if isinstance(value, str) else value


class DecisionIntentAnswer(CamelModel):
    question_id: str = Field(min_length=1, max_length=100)
    option_id: str | None = Field(default=None, max_length=100)
    text: str | None = Field(default=None, max_length=500)


class DecisionContext(CamelModel):
    task_meaning: TaskMeaningReceipt | None = None
    workflow_version: Literal[1, 2] = 1
    minimum_context_tokens: int | None = Field(default=None, ge=1, le=100_000_000, strict=True)
    input_modalities: list[Literal["text", "image", "audio", "video"]] = Field(
        default_factory=list, max_length=4
    )
    commercial_use_required: bool = False
    service_access: DecisionServiceAccess | None = None
    task: str = Field(min_length=5, max_length=1000)
    priority: Literal["quality", "cost", "speed", "privacy", "control", "balanced"]
    budget: DecisionBudget = Field(default_factory=DecisionBudget)
    deployment: Literal["cloud-api", "private", "on-device", "hybrid", "undecided"]
    exclusions: list[str] = Field(default_factory=list, max_length=20)
    candidate_entity_ids: list[str] = Field(default_factory=list, max_length=20)
    notes: str | None = Field(default=None, max_length=1000)
    task_type: Literal[
        "model-api", "coding-product", "knowledge-product", "agent-development", "unspecified"
    ] = "unspecified"
    region: str | None = Field(default=None, max_length=100)
    intent_answers: list[DecisionIntentAnswer] = Field(default_factory=list, max_length=4)
    parent_research_id: str | None = Field(default=None, max_length=128)

    @field_validator("exclusions")
    @classmethod
    def validate_exclusions(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(not value or len(value) > 200 for value in normalized):
            raise ValueError("each exclusion must contain 1 to 200 characters")
        return normalized

    @field_validator("candidate_entity_ids")
    @classmethod
    def validate_candidate_entity_ids(cls, values: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(value.strip() for value in values))
        if any(not value or len(value) > 128 for value in normalized):
            raise ValueError("each candidate entity id must contain 1 to 128 characters")
        return normalized


class ResearchCreate(CamelModel):
    question: str = Field(min_length=5, max_length=2000)
    language: Literal["zh", "en"] = "zh"
    decision_context: DecisionContext | None = None
    parent_research_id: str | None = Field(default=None, max_length=128)
    clarification_answer: DecisionIntentAnswer | None = None


class DecisionIntentField(CamelModel):
    field: str
    value: str
    source: Literal["user-input", "user-choice", "assumption"]


class DecisionClarificationOption(CamelModel):
    id: str
    label: str
    description: str
    task: str | None = None
    task_type: str | None = None


class DecisionClarification(CamelModel):
    id: str
    reason: str
    question: str
    options: list[DecisionClarificationOption]


class DecisionGuidanceRecommendation(CamelModel):
    headline: str
    summary: str
    entity_ids: list[str] = Field(default_factory=list)
    primary_entity_id: str | None = None
    reasons: list[DecisionTradeoff] = Field(default_factory=list)
    tradeoff: str | None = None
    premises: list[str] = Field(default_factory=list)


class DecisionGuidanceUnknown(CamelModel):
    candidate_id: str | None = None
    requirement: str
    kind: Literal[
        "not-recorded",
        "not-retrieved",
        "not-structured",
        "not-current",
        "conflicting",
        "scope-mismatch",
        "needs-input",
        "not-tested",
    ]
    decisive: bool
    detail: str
    affects: str
    recovery: str
    claim_ids: list[str] = Field(default_factory=list)
    checked_at: datetime


class DecisionNextAction(CamelModel):
    kind: Literal["answer", "start", "compare", "edit", "routes"]
    label: str
    target_ids: list[str] = Field(default_factory=list)
    location: Literal["this-page", "selected-product"]
    instruction: str
    execution_prompt: str | None = None


class DecisionGuidance(CamelModel):
    schema_version: Literal[1] = 1
    outcome: Literal["advice", "clarify", "conditional", "unsupported", "blocked"]
    intent: list[DecisionIntentField]
    tasks: list[str]
    answered: list[DecisionIntentAnswer] = Field(default_factory=list)
    clarification: DecisionClarification | None = None
    recommendation: DecisionGuidanceRecommendation
    unknowns: list[DecisionGuidanceUnknown] = Field(default_factory=list)
    next_action: DecisionNextAction


class ResearchCitation(CamelModel):
    claim: Claim
    evidence: list[Evidence]


class GeneratedAnswerStatement(CamelModel):
    text_zh: str = Field(min_length=1)
    text_en: str = Field(min_length=1)
    claim_ids: list[str] = Field(min_length=1)


class GeneratedAnswerPayload(CamelModel):
    answer_zh: str = Field(min_length=1)
    answer_en: str = Field(min_length=1)
    statements: list[GeneratedAnswerStatement] = Field(default_factory=list)
    uncertainties: list[str] = Field(default_factory=list)
    refused: bool = False
    refusal_reason: str | None = None


class RetrievalDiagnostics(CamelModel):
    candidate_count: int = 0
    returned_count: int = 0
    filtered_count: int = 0
    elapsed_ms: int = 0
    matched_entity_ids: list[str] = Field(default_factory=list)
    fallback_reason: str | None = None
    generation_fallback_reason: str | None = None


class DecisionTradeoff(CamelModel):
    dimension: str
    finding: str
    claim_ids: list[str] = Field(default_factory=list)


class DecisionComparisonCell(CamelModel):
    entity_id: str
    state: Literal["supported", "unknown"]
    facts: list[DecisionTradeoff] = Field(default_factory=list)


class DecisionComparison(CamelModel):
    id: str
    dimension: str
    cells: list[DecisionComparisonCell] = Field(default_factory=list)


class DecisionRisk(CamelModel):
    state: Literal["verified", "inferred", "unknown", "conflict"]
    detail: str
    claim_ids: list[str] = Field(default_factory=list)


class DecisionRecommendation(CamelModel):
    primary_entity_id: str | None = None
    alternative_entity_ids: list[str] = Field(default_factory=list)
    summary: str
    basis: Literal["sole-eligible", "comparable-cost", "validation-sequence", "comparison-only"] = (
        "comparison-only"
    )
    reasons: list[DecisionTradeoff] = Field(default_factory=list)
    validation_entity_ids: list[str] = Field(default_factory=list)


class DecisionGap(CamelModel):
    dimension: str
    reason: Literal[
        "not-recorded",
        "not-structured",
        "not-current",
        "needs-input",
        "conflicting",
        "requires-poc",
    ]
    detail: str
    claim_ids: list[str] = Field(default_factory=list)


class DecisionScenario(CamelModel):
    id: str = "unspecified"
    name: str = ""
    required_features: list[str] = Field(default_factory=list)
    clarification_checks: list[str] = Field(default_factory=list)


class DecisionScope(CamelModel):
    considered_entity_ids: list[str] = Field(default_factory=list)
    omitted_entity_ids: list[str] = Field(default_factory=list)
    selection_basis: str = ""
    explicit: bool = False


class DecisionCandidate(CamelModel):
    entity_id: str
    eligibility: Literal["eligible", "excluded", "unknown", "conflict"]
    reasons: list[str] = Field(default_factory=list)
    claim_ids: list[str] = Field(default_factory=list)
    covered_dimensions: list[str] = Field(default_factory=list)
    required_dimensions: list[str] = Field(default_factory=list)
    is_concrete_version: bool = False
    strengths: list[DecisionTradeoff] = Field(default_factory=list)
    gaps: list[DecisionGap] = Field(default_factory=list)
    fit_state: Literal["described", "unverified"] = "unverified"


class DecisionTestConditions(CamelModel):
    model_version: str = Field(default="", max_length=200)
    configuration: str = Field(default="", max_length=1000)
    sample_count: int | None = Field(default=None, ge=1, le=100_000_000, strict=True)
    tested_at: str = Field(default="", max_length=32)
    scope: str = Field(default="", max_length=1000)

    @field_validator("tested_at")
    @classmethod
    def valid_test_date(cls, value: str) -> str:
        if value:
            try:
                datetime.fromisoformat(value)
            except ValueError:
                raise ValueError("test date must be an ISO date or datetime") from None
        return value


class DecisionMeasurements(CamelModel):
    successful_samples: int | None = Field(default=None, ge=0, le=1_000_000, strict=True)
    minimum_successful_samples: int | None = Field(default=None, ge=1, le=1_000_000, strict=True)
    total_cost: float | None = Field(default=None, ge=0, le=1e15, allow_inf_nan=False, strict=True)
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    cost_basis: Literal["actual-charge", "estimate"] | None = None
    source_note: str = Field(default="", max_length=500)
    p50_ms: float | None = Field(default=None, ge=0, le=1e15, allow_inf_nan=False, strict=True)
    p95_ms: float | None = Field(default=None, gt=0, le=1e15, allow_inf_nan=False, strict=True)
    privacy_verified: bool | None = Field(default=None, strict=True)
    control_verified: bool | None = Field(default=None, strict=True)

    @model_validator(mode="after")
    def consistent_latency(self) -> DecisionMeasurements:
        if self.p50_ms is not None and self.p95_ms is not None and self.p95_ms < self.p50_ms:
            raise ValueError("P95 latency cannot be lower than P50 latency")
        return self


class DecisionValidationItem(CamelModel):
    measurements: DecisionMeasurements | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    suggested_protocol: DecisionTrial | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    test_conditions: DecisionTestConditions | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    id: str = Field(min_length=1, max_length=128)
    title: str = Field(min_length=1, max_length=500)
    candidate_id: str | None = Field(default=None, max_length=128)
    status: Literal["pending", "passed", "failed", "blocked"] = "pending"
    result: str = Field(default="", max_length=3000)

    @model_validator(mode="after")
    def tested_results(self) -> DecisionValidationItem:
        if self.measurements:
            measures = self.measurements
            if (
                measures.successful_samples is not None
                or measures.minimum_successful_samples is not None
            ):
                if self.id != "quality" and not self.id.endswith("-quality"):
                    raise ValueError("successful sample counts belong to a task quality check")
                count = self.test_conditions.sample_count if self.test_conditions else None
                if count is not None and any(
                    value is not None and value > count
                    for value in (measures.successful_samples, measures.minimum_successful_samples)
                ):
                    raise ValueError(
                        "successful and minimum sample counts cannot exceed the sample count"
                    )
                if (
                    self.status in {"passed", "failed"}
                    and measures.successful_samples is not None
                    and measures.minimum_successful_samples is None
                ):
                    raise ValueError(
                        "numeric task results require the predeclared minimum successful sample count"
                    )
                if (
                    self.status == "passed"
                    and measures.successful_samples is not None
                    and measures.minimum_successful_samples is not None
                    and measures.successful_samples < measures.minimum_successful_samples
                ):
                    raise ValueError(
                        "a task below its declared success threshold cannot be marked passed"
                    )
            if measures.total_cost is not None:
                if self.id != "cost" and not self.id.endswith("-cost"):
                    raise ValueError("cost measurements belong to a cost check")
                if self.status in {"passed", "failed"} and not all(
                    [measures.currency, measures.cost_basis, measures.source_note.strip()]
                ):
                    raise ValueError(
                        "measured cost requires currency, actual-charge/estimate basis and source note"
                    )
            if (
                (measures.p50_ms is not None or measures.p95_ms is not None)
                and self.id != "latency"
                and not self.id.endswith("-latency")
            ):
                raise ValueError("latency measurements belong to a latency check")
            if (
                (measures.privacy_verified is not None or measures.control_verified is not None)
                and self.id != "terms"
                and not self.id.endswith("-terms")
            ):
                raise ValueError("privacy/control verification belongs to an entry and terms check")
        if self.status in {"passed", "failed"} and not self.result.strip():
            raise ValueError("tested items require actual results and test conditions")
        if self.status in {"passed", "failed"} and self.test_conditions is not None:
            conditions = self.test_conditions
            if not all(
                [
                    conditions.model_version.strip(),
                    conditions.configuration.strip(),
                    conditions.sample_count,
                    conditions.tested_at,
                    conditions.scope.strip(),
                ]
            ):
                raise ValueError(
                    "measured items require version, configuration, sample count, test date and scope"
                )
        return self


class DecisionValidationSave(CamelModel):
    expected_revision: int = Field(ge=0)
    items: list[DecisionValidationItem] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def unique_items(self) -> DecisionValidationSave:
        if len({item.id for item in self.items}) != len(self.items):
            raise ValueError("validation item ids must be unique")
        return self


class DecisionValidationCheckReview(CamelModel):
    dimension: Literal["quality", "latency", "cost", "terms"]
    item_ids: list[str] = Field(default_factory=list)
    complete: bool = False
    reason: Literal["missing", "pending", "blocked", "conditions-missing", "ambiguous", "complete"]
    missing_conditions: list[str] = Field(default_factory=list)


class DecisionValidationCandidateReview(CamelModel):
    candidate_id: str | None = None
    recorded_checks: int = 0
    completed_checks: int = 0
    required_checks: int = 4
    checks: list[DecisionValidationCheckReview] = Field(default_factory=list)


class DecisionValidationComparisonGroup(CamelModel):
    minimum_successful_samples: int | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    measurement_unit: str | None = Field(default=None, exclude_if=lambda value: value is None)
    cost_basis: Literal["actual-charge", "estimate"] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    dimension: Literal["quality", "latency", "cost", "terms"]
    candidate_ids: list[str]
    item_ids: list[str]
    configuration: str
    scope: str
    sample_count: int
    test_date: str


class DecisionValidationFinding(CamelModel):
    candidate_id: str
    outcome: Literal[
        "limited-fit",
        "tested-fail",
        "testing-blocked",
        "record-incomplete",
        "unverified",
        "entry-unverified",
        "eligibility-unverified",
    ]
    item_ids: list[str] = Field(default_factory=list)
    scope: str = ""
    model_version: str = ""


class DecisionMeasuredChoice(CamelModel):
    minimum_successful_samples: int | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    priority: Literal["quality", "cost", "speed"]
    candidate_ids: list[str]
    item_ids: list[str]
    metric: Literal["successful-samples", "total-cost", "p95-ms"]
    unit: str
    values: dict[str, float]
    configuration: str
    scope: str
    sample_count: int
    test_date: str
    basis: Literal["user-declared-actual-measurements"] = "user-declared-actual-measurements"


class DecisionValidationConclusion(CamelModel):
    measured_choices: list[DecisionMeasuredChoice] = Field(default_factory=list)
    status: Literal[
        "limited-fit",
        "no-tested-fit",
        "validation-blocked",
        "insufficient-tests",
        "priority-unverified",
    ] = "insufficient-tests"
    trial_candidate_ids: list[str] = Field(default_factory=list)
    findings: list[DecisionValidationFinding] = Field(default_factory=list)


class DecisionValidationReview(CamelModel):
    source_revision: int
    basis: Literal["user-records"] = "user-records"
    candidates: list[DecisionValidationCandidateReview] = Field(default_factory=list)
    comparable_groups: list[DecisionValidationComparisonGroup] = Field(default_factory=list)
    conclusion: DecisionValidationConclusion = Field(default_factory=DecisionValidationConclusion)


class DecisionValidationView(CamelModel):
    research_id: str
    revision: int = 0
    items: list[DecisionValidationItem] = Field(default_factory=list)
    updated_at: datetime | None = None
    review: DecisionValidationReview | None = None


class DecisionAction(CamelModel):
    id: str
    kind: Literal["clarify", "reconcile", "source", "test", "change-scope"]
    title: str
    instruction: str
    unlocks: str
    candidate_ids: list[str] = Field(default_factory=list)
    dimensions: list[str] = Field(default_factory=list)
    claim_ids: list[str] = Field(default_factory=list)


class DecisionTrial(CamelModel):
    sample: str
    procedure: list[str]
    metrics: list[str]
    acceptance: list[str]
    # A proposed protocol is never an executed measurement or product score.
    executed: Literal[False] = False


class DecisionPlan(CamelModel):
    state: Literal[
        "needs-input",
        "needs-evidence",
        "conflict",
        "all-excluded",
        "no-candidates",
        "ready-to-validate",
        "failed",
    ]
    can_decide: str
    actions: list[DecisionAction] = Field(default_factory=list)
    trial_candidate_ids: list[str] = Field(default_factory=list)
    trial: DecisionTrial | None = None


class DecisionResult(CamelModel):
    guidance: DecisionGuidance | None = None
    scenario: DecisionScenario = Field(default_factory=DecisionScenario)
    scope: DecisionScope = Field(default_factory=DecisionScope)
    candidates: list[DecisionCandidate] = Field(default_factory=list)
    missing_inputs: list[str] = Field(default_factory=list)
    workflow_state: Literal[
        "ready", "needs-input", "insufficient-evidence", "conflict", "no-eligible-candidate"
    ] = "insufficient-evidence"
    status: Literal["ready", "insufficient-evidence", "conflict", "failed"]
    as_of: datetime
    recommendation: DecisionRecommendation
    conditions: list[str] = Field(default_factory=list)
    tradeoffs: list[DecisionTradeoff] = Field(default_factory=list)
    comparisons: list[DecisionComparison] = Field(default_factory=list)
    risks: list[DecisionRisk] = Field(default_factory=list)
    next_checks: list[str] = Field(default_factory=list)
    claim_ids: list[str] = Field(default_factory=list)
    plan: DecisionPlan | None = None


class ResearchView(CamelModel):
    citation_states: dict[str, Literal["current", "updated", "unavailable"]] = Field(
        default_factory=dict
    )
    id: str
    question: str
    summary: str
    claim_ids: list[str]
    steps: list[ResearchStep]
    status: Literal["ready", "insufficient-evidence", "failed", "cancelled"]
    citations: list[ResearchCitation] = Field(default_factory=list)
    retrieval_mode: Literal["lexical", "hybrid"] = "lexical"
    answer_mode: Literal["extractive", "generated"] = "extractive"
    retrieval_diagnostics: RetrievalDiagnostics = Field(default_factory=RetrievalDiagnostics)
    decision_context: DecisionContext | None = None
    decision: DecisionResult | None = None
    published_slug: str | None = None
    created_at: datetime
    published_at: datetime | None = None


class PublishedResearchView(ResearchView):
    pass


class EmailOutboxView(CamelModel):
    id: str
    to_email: EmailStr
    subject: str
    status: Literal["queued", "retrying", "sending", "sent", "failed"]
    created_at: datetime
    sent_at: datetime | None = None
    attempt_count: int = 0
    last_attempt_at: datetime | None = None
    next_attempt_at: datetime | None = None
    delivery_lease_expires_at: datetime | None = None
    error: str | None = None


class DigestRunSummary(CamelModel):
    recipients: int
    messages_queued: int


class EmailDeliverySummary(CamelModel):
    attempted: int
    sent: int
    failed: int


class GoldenQuestionResult(CamelModel):
    id: str
    question: str
    passed: bool
    matched_entity_ids: list[str]
    missing_entity_ids: list[str]
    reason: str
    retrieved_claim_ids: list[str] = Field(default_factory=list)
    retrieval_passed: bool | None = None
    entity_recall_at_8: float | None = None
    citation_coverage: float | None = None


class RagEvaluationMetrics(CamelModel):
    entity_recall_at_8: float
    claim_recall_at_8: float
    citation_coverage: float
    official_source_ratio: float
    temporal_accuracy: float
    refusal_accuracy: float
    lifecycle_precision: float


class GoldenQuestionReport(CamelModel):
    total: int
    passed: int
    failed: int
    pass_ratio: float
    required_ratio: float
    ready: bool
    results: list[GoldenQuestionResult]
    retrieval_pass_ratio: float | None = None
    rag_ready: bool | None = None
    rag_metrics: RagEvaluationMetrics | None = None


class DataQualityReport(CamelModel):
    evaluation_scope: Literal["overview", "full"] = "full"
    entity_count: int
    claim_count: int
    evidence_count: int
    relation_count: int
    timeline_entry_count: int
    official_evidence_count: int
    reviewed_evidence_count: int
    fresh_evidence_count: int
    evidence_domain_count: int
    verified_content_count: int
    conflict_content_count: int
    evidence_reference_coverage: float
    official_evidence_ratio: float
    reviewed_evidence_ratio: float
    fresh_evidence_ratio: float
    verified_content_ratio: float
    claims_required: int
    claims_remaining: int
    core_entities_below_five_relations: list[str]
    core_entity_relation_counts: dict[str, int]
    core_entity_relation_labels: dict[str, LocalizedText]
    core_relation_deficit: int
    golden_questions: GoldenQuestionReport | None = None
    claims_with_missing_evidence: list[str]
    claims_with_missing_entity: list[str]
    claims_with_missing_fact_date: list[str]
    relations_with_missing_evidence: list[str]
    timeline_entries_with_missing_evidence: list[str]
    live_ready: bool
    issues: list[str]


class BusinessQualityMetrics(CamelModel):
    updated_at: datetime
    entity_count: int
    claim_count: int
    evidence_count: int
    relation_count: int
    timeline_entry_count: int
    evidence_reference_coverage: float
    official_evidence_ratio: float
    reviewed_evidence_ratio: float
    fresh_evidence_ratio: float
    verified_content_ratio: float
    core_relation_deficit: int


class EvaluationApplicability(CamelModel):
    status: Literal["historical", "scope-matched"]
    corpus_matches: bool | None
    retrieval_config_matches: bool
    build_matches: bool
    missing_expected_claim_sample_count: int | None
    configured_retrieval_mode: Literal["lexical", "hybrid"]
    reasons: list[str]


class EvaluationQualityMetrics(CamelModel):
    updated_at: datetime
    cadence: Literal["daily-or-on-retrieval-change", "on-evaluation-publication"]
    artifact_path: str
    golden_set_version: str
    sample_count: int
    snapshot_sha256: str
    retrieval_mode: Literal["lexical", "hybrid"]
    embedding_model: str | None = None
    top_k: int
    evaluation_commit: str
    recall_at_8: float
    precision_at_8: float
    entity_recall_at_8: float
    pass_ratio: float
    applicability: EvaluationApplicability | None = None


class QualityMetrics(CamelModel):
    generated_at: datetime
    data_mode: Literal["demo", "live"]
    business: BusinessQualityMetrics
    evaluation: EvaluationQualityMetrics


class ReleaseBaseline(CamelModel):
    generated_at: datetime
    build: HealthResponse
    claims: ReleaseClaimMetrics
    quality: DataQualityReport
    golden_questions: GoldenQuestionReport
    review_queue: ReviewInventoryReport
    operations: OperationsDiagnostics
    source_health: dict[str, int]
    integrations: IntegrationStatus
    readiness: ProductionReadiness
