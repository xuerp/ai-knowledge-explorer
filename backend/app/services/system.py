from urllib.parse import urlsplit

from fastapi import Response
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..application_rules import DATABASE_SCHEMA_REVISION, SERVICE_RELEASE
from ..auth import Principal
from ..extraction import (
    EXTRACTION_PIPELINE_VERSION,
)
from ..production_readiness import ProductionReadinessInputs, build_production_readiness
from ..schemas import (
    HealthResponse,
    IntegrationStatus,
    ProductionReadiness,
)


class SystemServices:
    def health(
        self,
    ) -> HealthResponse:
        return HealthResponse(
            ok=True,
            release=SERVICE_RELEASE,
            build_commit=self.app_settings.build_commit,
            schema_revision=DATABASE_SCHEMA_REVISION,
            built_at=self.app_settings.built_at,
            environment=self.app_settings.environment,
            data_mode=self.app_settings.data_mode,
            database=self.app_settings.database_url.split(":", 1)[0],
            admin_writes_enabled=bool(self.app_settings.admin_token or self.auth.enabled),
            auth_enabled=self.auth.enabled,
        )

    def integration_status(
        self,
        _: Principal,
        session: Session,
    ) -> IntegrationStatus:
        sources = self.ingestion.list_sources(session)
        extraction_host = (
            urlsplit(self.app_settings.extraction_api_url).hostname
            if self.app_settings.extraction_api_url
            else None
        )
        return IntegrationStatus(
            extraction_configured=bool(
                self.app_settings.extraction_api_url
                and self.app_settings.extraction_api_key
                and self.app_settings.extraction_model
            ),
            extraction_pipeline_version=EXTRACTION_PIPELINE_VERSION,
            extraction_endpoint_host=extraction_host,
            extraction_model=self.app_settings.extraction_model,
            extraction_reasoning_effort=self.extraction.reasoning_effort,
            extraction_max_completion_tokens=self.extraction.max_completion_tokens,
            automatic_extraction_enabled=(
                self.extraction.enabled
                and self.app_settings.auto_extraction_max_snapshots_per_cycle > 0
            ),
            automatic_extraction_max_snapshots_per_cycle=(
                self.app_settings.auto_extraction_max_snapshots_per_cycle
            ),
            automatic_extraction_max_candidates_per_snapshot=(
                self.app_settings.auto_extraction_max_candidates_per_snapshot
            ),
            automatic_extraction_retry_minutes=self.app_settings.auto_extraction_retry_minutes,
            automatic_relation_approval_enabled=self.app_settings.auto_approve_grounded_relations,
            retrieval_mode=self.app_settings.retrieval_mode,
            embedding_configured=self.embedding_provider is not None
            and self.vector_index is not None,
            embedding_provider=self.app_settings.embedding_provider,
            embedding_model=(
                self.app_settings.embedding_model
                if self.app_settings.embedding_provider != "none"
                else None
            ),
            embedding_version=(
                self.app_settings.embedding_version
                if self.app_settings.embedding_provider != "none"
                else None
            ),
            embedding_dimension=(
                self.app_settings.embedding_dimension
                if self.app_settings.embedding_provider != "none"
                else None
            ),
            embedding_daily_neuron_budget=(
                self.app_settings.embedding_daily_neuron_budget
                if self.app_settings.embedding_provider != "none"
                else None
            ),
            embedding_daily_api_call_budget=(
                self.app_settings.embedding_daily_api_call_budget
                if self.app_settings.embedding_provider != "none"
                else None
            ),
            smtp_configured=self.email_delivery.enabled,
            smtp_host=self.app_settings.smtp_host,
            smtp_from=self.app_settings.smtp_from,
            email_delivery_provider=self.app_settings.email_provider,
            email_delivery_endpoint_host=(
                urlsplit(self.app_settings.email_api_url).hostname
                if self.app_settings.email_provider == "resend"
                else self.app_settings.smtp_host
            ),
            fetch_allowed_hosts=list(self.app_settings.fetch_allowed_hosts),
            registered_sources=len(sources),
            automatic_sources=sum(source.fetch_enabled for source in sources),
            digest_timezone=self.app_settings.digest_timezone,
        )

    def production_readiness(
        self,
        response: Response,
        _: Principal,
        session: Session,
    ) -> ProductionReadiness:
        response.headers["Cache-Control"] = "no-store"
        sources = self.ingestion.list_sources(session)
        quality = self.get_quality_report(session, include_retrieval=False)
        diagnostics = self.operations.diagnostics(session, self.app_settings.worker_id, run_limit=1)
        revision: str | None = None
        if self.database.engine.dialect.name != "sqlite":
            try:
                revision = session.scalar(text("SELECT version_num FROM alembic_version"))
            except SQLAlchemyError:
                session.rollback()
        return build_production_readiness(
            ProductionReadinessInputs(
                environment=self.app_settings.environment,
                data_mode=self.app_settings.data_mode,
                database_dialect=self.database.engine.dialect.name,
                schema_revision=revision,
                expected_schema_revision=DATABASE_SCHEMA_REVISION,
                jwt_enabled=self.auth.enabled,
                legacy_admin_token_enabled=bool(self.app_settings.admin_token),
                cors_origins=self.app_settings.cors_origins,
                extraction_configured=self.extraction.enabled,
                smtp_configured=self.email_delivery.enabled,
                fetch_allowed_hosts=len(self.app_settings.fetch_allowed_hosts),
                automatic_sources=sum(source.active and source.fetch_enabled for source in sources),
                quality_ready=quality.live_ready,
                heartbeat_status=diagnostics.heartbeat_status,
            )
        )
