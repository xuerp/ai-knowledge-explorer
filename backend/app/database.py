from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


class Base(DeclarativeBase):
    pass


class ReviewJobRecord(Base):
    __tablename__ = "review_jobs"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    entity_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    claim_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    claim_json: Mapped[str] = mapped_column(Text, nullable=False)
    evidence_ids_json: Mapped[str] = mapped_column(Text, nullable=False)
    evidence_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    conflict_ids_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class PublicationRecordRow(Base):
    __tablename__ = "publication_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    review_job_id: Mapped[str] = mapped_column(
        ForeignKey("review_jobs.id"),
        nullable=False,
        index=True,
    )
    claim_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
    )
    actor: Mapped[str] = mapped_column(String(128), nullable=False)


class KnowledgeEntityRecord(Base):
    __tablename__ = "knowledge_entities"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    family_id: Mapped[str | None] = mapped_column(
        ForeignKey("knowledge_entities.id"),
        nullable=True,
        index=True,
    )
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class KnowledgeRelationRecord(Base):
    __tablename__ = "knowledge_relations"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    from_id: Mapped[str] = mapped_column(
        ForeignKey("knowledge_entities.id"),
        nullable=False,
        index=True,
    )
    to_id: Mapped[str] = mapped_column(
        ForeignKey("knowledge_entities.id"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class KnowledgeTimelineRecord(Base):
    __tablename__ = "knowledge_timeline"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    entity_id: Mapped[str] = mapped_column(
        ForeignKey("knowledge_entities.id"),
        nullable=False,
        primary_key=True,
        index=True,
    )
    event_date: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class SourceRecord(Base):
    __tablename__ = "sources"
    __table_args__ = (
        Index("ix_sources_automatic_due", "active", "fetch_enabled", "next_fetch_at"),
        Index("ix_sources_fetch_lease_expires_at", "fetch_lease_expires_at"),
    )

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    url: Mapped[str] = mapped_column(String(2048), nullable=False, unique=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    publisher: Mapped[str] = mapped_column(String(255), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    fetch_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    fetch_interval_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=240)
    next_fetch_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    etag: Mapped[str | None] = mapped_column(String(512), nullable=True)
    last_modified: Mapped[str | None] = mapped_column(String(512), nullable=True)
    consecutive_failures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_fetch_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    fetch_lease_token: Mapped[str | None] = mapped_column(String(36), nullable=True)
    fetch_lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_probe_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_probe_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    last_probe_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_probe_content_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_probe_readable_characters: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DocumentSnapshotRecord(Base):
    __tablename__ = "document_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    source_id: Mapped[str] = mapped_column(
        ForeignKey("sources.id"),
        nullable=False,
        index=True,
    )
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    content_text: Mapped[str] = mapped_column(Text, nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    previous_snapshot_id: Mapped[str | None] = mapped_column(
        ForeignKey("document_snapshots.id"),
        nullable=True,
    )


class IngestionRunRecord(Base):
    __tablename__ = "ingestion_runs"
    __table_args__ = (Index("ix_ingestion_runs_started_at", "started_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    source_id: Mapped[str] = mapped_column(
        ForeignKey("sources.id"),
        nullable=False,
        index=True,
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    change_type: Mapped[str] = mapped_column(String(32), nullable=False)
    snapshot_id: Mapped[str | None] = mapped_column(
        ForeignKey("document_snapshots.id"),
        nullable=True,
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class UserRecord(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="viewer")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    daily_digest_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    digest_hour: Mapped[str] = mapped_column(String(5), nullable=False, default="08:00")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AuditLogRecord(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(128), nullable=False)
    target_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    detail_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class FollowRecord(Base):
    __tablename__ = "follows"
    __table_args__ = (UniqueConstraint("user_id", "entity_id", name="uq_follow_user_entity"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    entity_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    intensity: Mapped[str] = mapped_column(String(32), nullable=False, default="digest")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class NotificationRecord(Base):
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    entity_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    change_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    priority: Mapped[str] = mapped_column(String(32), nullable=False, default="normal")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ResearchRecord(Base):
    __tablename__ = "research_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    claim_ids_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    steps_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    published_slug: Mapped[str | None] = mapped_column(
        String(128), nullable=True, unique=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EmailOutboxRecord(Base):
    __tablename__ = "email_outbox"
    __table_args__ = (
        Index(
            "ix_email_outbox_delivery_due",
            "status",
            "next_attempt_at",
            "created_at",
        ),
        Index("ix_email_outbox_lease_expires_at", "delivery_lease_expires_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    to_email: Mapped[str] = mapped_column(String(320), nullable=False)
    subject: Mapped[str] = mapped_column(String(500), nullable=False)
    body_text: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued")
    delivery_key: Mapped[str | None] = mapped_column(
        String(160), nullable=True, unique=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivery_lease_token: Mapped[str | None] = mapped_column(String(36), nullable=True)
    delivery_lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class AutomationRunRecord(Base):
    __tablename__ = "automation_runs"
    __table_args__ = (Index("ix_automation_runs_started_at", "started_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    worker_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    trigger: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    result_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class WorkerStatusRecord(Base):
    __tablename__ = "worker_status"

    worker_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    state: Mapped[str] = mapped_column(String(32), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    heartbeat_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    next_cycle_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_cycle_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    last_cycle_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_cycle_finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_cycle_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    consecutive_failures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class Database:
    def __init__(self, url: str):
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        self.engine = create_engine(
            url,
            connect_args=connect_args,
            future=True,
            pool_pre_ping=not url.startswith("sqlite"),
        )
        self.session_factory = sessionmaker(
            bind=self.engine,
            class_=Session,
            expire_on_commit=False,
        )

    def create_all(self) -> None:
        Base.metadata.create_all(self.engine)

    def session(self) -> Session:
        return self.session_factory()

    def dispose(self) -> None:
        self.engine.dispose()
