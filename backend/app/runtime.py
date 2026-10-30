from dataclasses import dataclass
from typing import Any

from .answer_generation import CitedAnswerService
from .auth import AuditService, AuthService
from .config import Settings
from .database import (
    Database,
)
from .email_delivery import EmailDeliveryService
from .embeddings import CloudflareEmbeddingProvider
from .engagement import EngagementService
from .extraction import (
    StructuredExtractionService,
)
from .fetching import SafeHttpFetcher
from .golden_questions import GoldenQuestionEvaluator
from .ingestion import IngestionService
from .operations import OperationsService
from .quality import (
    KnowledgeQualityGate,
)
from .rag import (
    HybridRagRetriever,
    LexicalRagRetriever,
    SqlAlchemyVectorClaimIndex,
)
from .repository import KnowledgeRepository
from .scheduler import IngestionScheduler
from .services.catalog import CatalogServices
from .services.extraction import ExtractionServices
from .services.reports import ReportsServices
from .services.review import ReviewServices
from .services.system import SystemServices


@dataclass
class ApplicationServices(
    CatalogServices, ExtractionServices, ReviewServices, ReportsServices, SystemServices
):
    """One isolated service graph per app; no module-level mutable services."""

    app_settings: Settings
    database: Database
    repository: KnowledgeRepository
    ingestion: IngestionService
    fetcher: SafeHttpFetcher
    scheduler: IngestionScheduler
    auth: AuthService
    audit: AuditService
    quality_gate: KnowledgeQualityGate
    golden_questions: GoldenQuestionEvaluator
    embedding_provider: CloudflareEmbeddingProvider | None
    vector_index: SqlAlchemyVectorClaimIndex | None
    engagement: EngagementService
    extraction: StructuredExtractionService
    email_delivery: EmailDeliveryService
    operations: OperationsService
    task_interpreter: Any


def create_services(
    settings: Settings | None = None, *, task_interpreter=None
) -> ApplicationServices:
    from .decision_runtime import configured_task_interpreter
    from .decision_semantics import TaskMeaningService

    app_settings = settings or Settings.from_env()
    database = Database(app_settings.database_url)
    if task_interpreter is None:
        task_interpreter = configured_task_interpreter(app_settings, database)
    repository = KnowledgeRepository(app_settings.seed_snapshot_path, app_settings.data_mode)
    ingestion = IngestionService(app_settings.fetch_allowed_hosts)
    if app_settings.fetch_dns_mode == "https-google":
        from .safe_dns import GoogleHttpsResolver

        fetcher = SafeHttpFetcher(
            app_settings.fetch_allowed_hosts,
            app_settings.fetch_max_bytes,
            resolver=GoogleHttpsResolver(),
        )
    else:
        fetcher = SafeHttpFetcher(app_settings.fetch_allowed_hosts, app_settings.fetch_max_bytes)
    scheduler = IngestionScheduler(
        fetcher,
        ingestion,
        retry_base_minutes=app_settings.fetch_retry_base_minutes,
        retry_max_minutes=app_settings.fetch_retry_max_minutes,
        lease_minutes=app_settings.fetch_lease_minutes,
    )
    auth = AuthService(app_settings.jwt_secret, app_settings.access_token_minutes)
    audit = AuditService()
    quality_gate = KnowledgeQualityGate()
    golden_questions = GoldenQuestionEvaluator()
    embedding_provider = None
    vector_index = None
    if (
        app_settings.retrieval_mode == "hybrid"
        and app_settings.embedding_provider == "cloudflare"
        and app_settings.cloudflare_account_id
        and app_settings.cloudflare_api_token
    ):
        embedding_provider = CloudflareEmbeddingProvider(
            account_id=app_settings.cloudflare_account_id,
            api_token=app_settings.cloudflare_api_token,
            model_name=app_settings.embedding_model,
            model_version=app_settings.embedding_version,
            dimension=app_settings.embedding_dimension,
            daily_neuron_budget=app_settings.embedding_daily_neuron_budget,
            neurons_per_million_tokens=app_settings.embedding_neurons_per_million_tokens,
            daily_api_call_budget=app_settings.embedding_daily_api_call_budget,
        )
        vector_index = SqlAlchemyVectorClaimIndex(
            embedding_provider=embedding_provider.provider_name,
            embedding_model=embedding_provider.model_name,
            embedding_version=embedding_provider.model_version,
            embedding_dimension=embedding_provider.dimension,
        )
    rag_retriever = (
        HybridRagRetriever(
            embedding_provider=embedding_provider,
            vector_index=vector_index,
            enabled=True,
        )
        if app_settings.retrieval_mode == "hybrid"
        else LexicalRagRetriever()
    )
    engagement = EngagementService(
        rag_retriever,
        CitedAnswerService(enabled=app_settings.rag_generation_enabled),
        task_meaning_service=TaskMeaningService(task_interpreter),
    )
    extraction = StructuredExtractionService(
        app_settings.extraction_api_url,
        app_settings.extraction_api_key,
        app_settings.extraction_model,
        response_timeout_seconds=app_settings.extraction_response_timeout_seconds,
        reasoning_effort=app_settings.extraction_reasoning_effort,
        max_completion_tokens=app_settings.extraction_max_completion_tokens,
        require_json_schema=app_settings.extraction_require_json_schema,
        require_usage=app_settings.extraction_require_usage,
        contract_state_path=app_settings.extraction_contract_state_path,
    )
    email_delivery = EmailDeliveryService(
        app_settings.smtp_host,
        app_settings.smtp_port,
        app_settings.smtp_username,
        app_settings.smtp_password,
        app_settings.smtp_from,
        app_settings.smtp_starttls,
        max_attempts=app_settings.email_max_attempts,
        retry_base_seconds=app_settings.email_retry_base_seconds,
        lease_seconds=app_settings.email_lease_seconds,
        provider=app_settings.email_provider,
        api_key=app_settings.email_api_key,
        api_url=app_settings.email_api_url,
    )
    operations = OperationsService(
        app_settings.worker_stale_seconds,
        app_settings.auto_extraction_retry_minutes,
    )

    return ApplicationServices(
        app_settings=app_settings,
        database=database,
        repository=repository,
        ingestion=ingestion,
        fetcher=fetcher,
        scheduler=scheduler,
        auth=auth,
        audit=audit,
        quality_gate=quality_gate,
        golden_questions=golden_questions,
        embedding_provider=embedding_provider,
        vector_index=vector_index,
        engagement=engagement,
        extraction=extraction,
        email_delivery=email_delivery,
        operations=operations,
        task_interpreter=task_interpreter,
    )
