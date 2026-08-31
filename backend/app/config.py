from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

BACKEND_ROOT = Path(__file__).resolve().parents[1]


def normalize_database_url(url: str) -> str:
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    return url


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str
    seed_snapshot_path: Path
    admin_token: str | None
    cors_origins: tuple[str, ...]
    automation_token: str | None = None
    automation_cycle_lease_seconds: int = 900
    environment: str = "development"
    data_mode: Literal["demo", "live"] = "demo"
    jwt_secret: str | None = None
    access_token_minutes: int = 30
    fetch_allowed_hosts: tuple[str, ...] = ()
    fetch_max_bytes: int = 2_000_000
    fetch_retry_base_minutes: int = 15
    fetch_retry_max_minutes: int = 360
    fetch_lease_minutes: int = 5
    extraction_api_url: str | None = None
    extraction_api_key: str | None = None
    extraction_model: str | None = None
    auto_extraction_max_snapshots_per_cycle: int = 0
    auto_extraction_max_candidates_per_snapshot: int = 10
    auto_extraction_retry_minutes: int = 360
    auto_approve_grounded_relations: bool = False
    relation_backfill_batch_id: str | None = None
    relation_backfill_max_snapshots: int = 0
    retrieval_mode: Literal["lexical", "hybrid"] = "lexical"
    rag_hybrid_enabled: bool = False
    rag_generation_enabled: bool = False
    embedding_provider: Literal["none", "cloudflare"] = "none"
    embedding_model: str = "@cf/baai/bge-m3"
    embedding_version: str = "cloudflare-managed:@cf/baai/bge-m3:2026-08-31-baseline"
    embedding_dimension: int = 1024
    embedding_daily_neuron_budget: float = 1000
    embedding_neurons_per_million_tokens: float = 1075
    embedding_daily_api_call_budget: int = 1000
    cloudflare_account_id: str | None = None
    cloudflare_api_token: str | None = None
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from: str | None = None
    smtp_starttls: bool = True
    email_max_attempts: int = 5
    email_retry_base_seconds: int = 300
    email_lease_seconds: int = 120
    digest_timezone: str = "Asia/Shanghai"
    worker_id: str = "scheduler"
    worker_heartbeat_seconds: int = 30
    worker_stale_seconds: int = 180
    build_commit: str = "local"
    built_at: str | None = None

    def __post_init__(self) -> None:
        if self.automation_token is not None and len(self.automation_token) < 32:
            raise ValueError("AI_RADAR_AUTOMATION_TOKEN must contain at least 32 characters.")
        if not 60 <= self.automation_cycle_lease_seconds <= 3600:
            raise ValueError("AI_RADAR_AUTOMATION_CYCLE_LEASE_SECONDS must be between 60 and 3600.")
        if self.fetch_retry_base_minutes < 1:
            raise ValueError("AI_RADAR_FETCH_RETRY_BASE_MINUTES must be at least 1.")
        if self.fetch_retry_max_minutes < self.fetch_retry_base_minutes:
            raise ValueError("AI_RADAR_FETCH_RETRY_MAX_MINUTES must be at least the retry base.")
        if not 1 <= self.fetch_lease_minutes <= 60:
            raise ValueError("AI_RADAR_FETCH_LEASE_MINUTES must be between 1 and 60.")
        if not 0 <= self.auto_extraction_max_snapshots_per_cycle <= 10:
            raise ValueError(
                "AI_RADAR_AUTO_EXTRACTION_MAX_SNAPSHOTS_PER_CYCLE must be between 0 and 10."
            )
        if not 1 <= self.auto_extraction_max_candidates_per_snapshot <= 20:
            raise ValueError(
                "AI_RADAR_AUTO_EXTRACTION_MAX_CANDIDATES_PER_SNAPSHOT must be between 1 and 20."
            )
        if not 1 <= self.auto_extraction_retry_minutes <= 1440:
            raise ValueError("AI_RADAR_AUTO_EXTRACTION_RETRY_MINUTES must be between 1 and 1440.")
        if not 0 <= self.relation_backfill_max_snapshots <= 10:
            raise ValueError("AI_RADAR_RELATION_BACKFILL_MAX_SNAPSHOTS must be between 0 and 10.")
        if self.relation_backfill_max_snapshots > 0 and not self.relation_backfill_batch_id:
            raise ValueError(
                "AI_RADAR_RELATION_BACKFILL_BATCH_ID is required when relation backfill is enabled."
            )
        if self.retrieval_mode not in {"lexical", "hybrid"}:
            raise ValueError("AI_RADAR_RETRIEVAL_MODE must be 'lexical' or 'hybrid'.")
        if self.embedding_provider not in {"none", "cloudflare"}:
            raise ValueError("AI_RADAR_EMBEDDING_PROVIDER must be 'none' or 'cloudflare'.")
        if self.embedding_dimension <= 0:
            raise ValueError("AI_RADAR_EMBEDDING_DIMENSION must be positive.")
        if self.embedding_daily_neuron_budget <= 0:
            raise ValueError("AI_RADAR_EMBEDDING_DAILY_NEURON_BUDGET must be positive.")
        if self.embedding_neurons_per_million_tokens <= 0:
            raise ValueError("AI_RADAR_EMBEDDING_NEURONS_PER_MILLION_TOKENS must be positive.")
        if self.embedding_daily_api_call_budget <= 0:
            raise ValueError("AI_RADAR_EMBEDDING_DAILY_API_CALL_BUDGET must be positive.")
        if not 1 <= self.email_max_attempts <= 20:
            raise ValueError("AI_RADAR_EMAIL_MAX_ATTEMPTS must be between 1 and 20.")
        if self.email_retry_base_seconds < 1:
            raise ValueError("AI_RADAR_EMAIL_RETRY_BASE_SECONDS must be at least 1.")
        if not 30 <= self.email_lease_seconds <= 900:
            raise ValueError("AI_RADAR_EMAIL_LEASE_SECONDS must be between 30 and 900.")
        if self.worker_heartbeat_seconds < 5:
            raise ValueError("AI_RADAR_WORKER_HEARTBEAT_SECONDS must be at least 5.")
        if self.worker_stale_seconds < self.worker_heartbeat_seconds * 2:
            raise ValueError(
                "AI_RADAR_WORKER_STALE_SECONDS must be at least twice the heartbeat interval."
            )

    @classmethod
    def from_env(cls) -> Settings:
        database_path = BACKEND_ROOT / "data" / "ai_radar.db"
        cors_origins = tuple(
            origin.strip()
            for origin in os.getenv(
                "AI_RADAR_CORS_ORIGINS",
                (
                    "http://localhost:3000,http://localhost:5173,"
                    "http://localhost:4181,http://localhost:4182,"
                    "http://127.0.0.1:8080,http://127.0.0.1:4181,"
                    "http://127.0.0.1:4182"
                ),
            ).split(",")
            if origin.strip()
        )
        data_mode = os.getenv("AI_RADAR_DATA_MODE", "demo")
        if data_mode not in {"demo", "live"}:
            raise ValueError("AI_RADAR_DATA_MODE must be either 'demo' or 'live'.")
        legacy_hybrid_enabled = os.getenv("AI_RADAR_RAG_HYBRID_ENABLED", "false").lower() in {
            "1",
            "true",
            "yes",
        }
        retrieval_mode = os.getenv(
            "AI_RADAR_RETRIEVAL_MODE",
            "hybrid" if legacy_hybrid_enabled else "lexical",
        ).lower()
        if retrieval_mode not in {"lexical", "hybrid"}:
            raise ValueError("AI_RADAR_RETRIEVAL_MODE must be 'lexical' or 'hybrid'.")
        embedding_provider = os.getenv("AI_RADAR_EMBEDDING_PROVIDER", "none").lower()
        if embedding_provider not in {"none", "cloudflare"}:
            raise ValueError("AI_RADAR_EMBEDDING_PROVIDER must be 'none' or 'cloudflare'.")
        return cls(
            database_url=normalize_database_url(
                os.getenv(
                    "AI_RADAR_DATABASE_URL",
                    f"sqlite:///{database_path.as_posix()}",
                )
            ),
            seed_snapshot_path=Path(
                os.getenv(
                    "AI_RADAR_SEED_SNAPSHOT",
                    str(BACKEND_ROOT / "data" / "demo_snapshot.json"),
                )
            ),
            admin_token=os.getenv("AI_RADAR_ADMIN_TOKEN") or None,
            cors_origins=cors_origins,
            automation_token=os.getenv("AI_RADAR_AUTOMATION_TOKEN") or None,
            automation_cycle_lease_seconds=int(
                os.getenv("AI_RADAR_AUTOMATION_CYCLE_LEASE_SECONDS", "900")
            ),
            environment=os.getenv("AI_RADAR_ENVIRONMENT", "development"),
            data_mode=data_mode,
            jwt_secret=os.getenv("AI_RADAR_JWT_SECRET") or None,
            access_token_minutes=int(os.getenv("AI_RADAR_ACCESS_TOKEN_MINUTES", "30")),
            fetch_allowed_hosts=tuple(
                host.strip().lower()
                for host in os.getenv("AI_RADAR_FETCH_ALLOWED_HOSTS", "").split(",")
                if host.strip()
            ),
            fetch_max_bytes=int(os.getenv("AI_RADAR_FETCH_MAX_BYTES", "2000000")),
            fetch_retry_base_minutes=int(os.getenv("AI_RADAR_FETCH_RETRY_BASE_MINUTES", "15")),
            fetch_retry_max_minutes=int(os.getenv("AI_RADAR_FETCH_RETRY_MAX_MINUTES", "360")),
            fetch_lease_minutes=int(os.getenv("AI_RADAR_FETCH_LEASE_MINUTES", "5")),
            extraction_api_url=os.getenv("AI_RADAR_EXTRACTION_API_URL") or None,
            extraction_api_key=os.getenv("AI_RADAR_EXTRACTION_API_KEY") or None,
            extraction_model=os.getenv("AI_RADAR_EXTRACTION_MODEL") or None,
            auto_extraction_max_snapshots_per_cycle=int(
                os.getenv("AI_RADAR_AUTO_EXTRACTION_MAX_SNAPSHOTS_PER_CYCLE", "0")
            ),
            auto_extraction_max_candidates_per_snapshot=int(
                os.getenv("AI_RADAR_AUTO_EXTRACTION_MAX_CANDIDATES_PER_SNAPSHOT", "10")
            ),
            auto_extraction_retry_minutes=int(
                os.getenv("AI_RADAR_AUTO_EXTRACTION_RETRY_MINUTES", "360")
            ),
            auto_approve_grounded_relations=os.getenv(
                "AI_RADAR_AUTO_APPROVE_GROUNDED_RELATIONS", "false"
            ).lower()
            in {"1", "true", "yes"},
            relation_backfill_batch_id=(os.getenv("AI_RADAR_RELATION_BACKFILL_BATCH_ID") or None),
            relation_backfill_max_snapshots=int(
                os.getenv("AI_RADAR_RELATION_BACKFILL_MAX_SNAPSHOTS", "0")
            ),
            retrieval_mode=retrieval_mode,
            rag_hybrid_enabled=legacy_hybrid_enabled,
            rag_generation_enabled=os.getenv("AI_RADAR_RAG_GENERATION_ENABLED", "false").lower()
            in {"1", "true", "yes"},
            embedding_provider=embedding_provider,
            embedding_model=os.getenv("AI_RADAR_EMBEDDING_MODEL", "@cf/baai/bge-m3"),
            embedding_version=os.getenv(
                "AI_RADAR_EMBEDDING_VERSION",
                "cloudflare-managed:@cf/baai/bge-m3:2026-08-31-baseline",
            ),
            embedding_dimension=int(os.getenv("AI_RADAR_EMBEDDING_DIMENSION", "1024")),
            embedding_daily_neuron_budget=float(
                os.getenv("AI_RADAR_EMBEDDING_DAILY_NEURON_BUDGET", "1000")
            ),
            embedding_neurons_per_million_tokens=float(
                os.getenv("AI_RADAR_EMBEDDING_NEURONS_PER_MILLION_TOKENS", "1075")
            ),
            embedding_daily_api_call_budget=int(
                os.getenv("AI_RADAR_EMBEDDING_DAILY_API_CALL_BUDGET", "1000")
            ),
            cloudflare_account_id=os.getenv("CLOUDFLARE_ACCOUNT_ID") or None,
            cloudflare_api_token=os.getenv("CLOUDFLARE_API_TOKEN") or None,
            smtp_host=os.getenv("AI_RADAR_SMTP_HOST") or None,
            smtp_port=int(os.getenv("AI_RADAR_SMTP_PORT", "587")),
            smtp_username=os.getenv("AI_RADAR_SMTP_USERNAME") or None,
            smtp_password=os.getenv("AI_RADAR_SMTP_PASSWORD") or None,
            smtp_from=os.getenv("AI_RADAR_SMTP_FROM") or None,
            smtp_starttls=os.getenv("AI_RADAR_SMTP_STARTTLS", "true").lower()
            in {"1", "true", "yes"},
            email_max_attempts=int(os.getenv("AI_RADAR_EMAIL_MAX_ATTEMPTS", "5")),
            email_retry_base_seconds=int(os.getenv("AI_RADAR_EMAIL_RETRY_BASE_SECONDS", "300")),
            email_lease_seconds=int(os.getenv("AI_RADAR_EMAIL_LEASE_SECONDS", "120")),
            digest_timezone=os.getenv("AI_RADAR_DIGEST_TIMEZONE", "Asia/Shanghai"),
            worker_id=os.getenv("AI_RADAR_WORKER_ID", "scheduler").strip() or "scheduler",
            worker_heartbeat_seconds=int(os.getenv("AI_RADAR_WORKER_HEARTBEAT_SECONDS", "30")),
            worker_stale_seconds=int(os.getenv("AI_RADAR_WORKER_STALE_SECONDS", "180")),
            build_commit=(
                (
                    os.getenv("AI_RADAR_BUILD_COMMIT") or os.getenv("RENDER_GIT_COMMIT") or "local"
                ).strip()
                or "local"
            ),
            built_at=os.getenv("AI_RADAR_BUILT_AT") or None,
        )
