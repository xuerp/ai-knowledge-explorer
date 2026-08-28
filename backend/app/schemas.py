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
    source_excerpt: str | None = None
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


class EntityKnowledge(CamelModel):
    introduction: list[LocalizedText]
    significance: LocalizedText
    key_points: list[KnowledgePoint]
    use_cases: list[KnowledgeUseCase]
    limitations: list[LocalizedText]
    official_url: str | None = None


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
    specs: EntitySpecs | None = None
    capabilities: list[Capability] | None = None
    metrics: list[Metric] | None = None
    knowledge: EntityKnowledge | None = None


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


class ReviewLifecycleDecision(ReviewDecision):
    target_claim_id: str = Field(min_length=1, max_length=128)
    expected_target_version: int = Field(ge=1)
    idempotency_key: str = Field(min_length=8, max_length=128)


class ReviewBatchDecision(CamelModel):
    id: str = Field(min_length=1, max_length=128)
    expected_version: int = Field(ge=1)
    reason: str = Field(min_length=3, max_length=500)


class ReviewBatchApproval(CamelModel):
    items: list[ReviewBatchDecision] = Field(min_length=1, max_length=50)


class ReviewQueueItem(ReviewCandidate):
    version: int
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


class EntityClaimPage(CamelModel):
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


class IntegrationStatus(CamelModel):
    extraction_configured: bool
    extraction_pipeline_version: str
    extraction_endpoint_host: str | None = None
    extraction_model: str | None = None
    automatic_extraction_enabled: bool
    automatic_extraction_max_snapshots_per_cycle: int
    automatic_extraction_max_candidates_per_snapshot: int
    automatic_extraction_retry_minutes: int
    automatic_relation_approval_enabled: bool
    smtp_configured: bool
    smtp_host: str | None = None
    smtp_from: str | None = None
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


class ResearchView(CamelModel):
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
