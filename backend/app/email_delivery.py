from __future__ import annotations

import smtplib
import ssl
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from email.utils import parseaddr
from typing import Protocol
from uuid import uuid4

from sqlalchemy import and_, or_, select, update
from sqlalchemy.orm import Session

from .database import EmailOutboxRecord
from .schemas import EmailDeliverySummary


class EmailDeliveryUnavailableError(RuntimeError):
    pass


class _SmtpFactory(Protocol):
    def __call__(self, host: str, port: int, timeout: float) -> smtplib.SMTP: ...


class EmailDeliveryService:
    def __init__(
        self,
        host: str | None,
        port: int,
        username: str | None,
        password: str | None,
        from_address: str | None,
        starttls: bool,
        *,
        max_attempts: int = 5,
        retry_base_seconds: int = 300,
        lease_seconds: int = 120,
        smtp_factory: _SmtpFactory = smtplib.SMTP,
    ):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.from_address = from_address
        self.starttls = starttls
        self.max_attempts = max(1, max_attempts)
        self.retry_base_seconds = max(1, retry_base_seconds)
        self.lease_seconds = max(30, lease_seconds)
        self.smtp_factory = smtp_factory

    @property
    def enabled(self) -> bool:
        return bool(self.host and self.from_address)

    def send_queued(
        self,
        session: Session,
        limit: int = 50,
        *,
        now: datetime | None = None,
        progress: Callable[[], None] | None = None,
    ) -> EmailDeliverySummary:
        if not self.enabled:
            raise EmailDeliveryUnavailableError(
                "Configure AI_RADAR_SMTP_HOST and AI_RADAR_SMTP_FROM before delivery."
            )
        if limit <= 0:
            return EmailDeliverySummary(attempted=0, sent=0, failed=0)
        current = now or datetime.now(UTC)
        row, lease_token = self._claim_next(session, current)
        if row is None or lease_token is None:
            return EmailDeliverySummary(attempted=0, sent=0, failed=0)
        sent = failed = attempted = 0
        smtp: smtplib.SMTP | None = None
        connection_error: BaseException | None = None
        try:
            smtp = self.smtp_factory(self.host or "", self.port, timeout=20.0)
            if self.starttls:
                smtp.starttls(context=ssl.create_default_context())
            if self.username:
                smtp.login(self.username, self.password or "")
        except (OSError, smtplib.SMTPException) as error:
            connection_error = error

        try:
            while row is not None and lease_token is not None and attempted < limit:
                attempted += 1
                if connection_error is not None:
                    self._finish_attempt(
                        session,
                        row.id,
                        lease_token,
                        current,
                        error=connection_error,
                    )
                    failed += 1
                    if progress:
                        progress()
                else:
                    message = EmailMessage()
                    message["From"] = self.from_address
                    message["To"] = row.to_email
                    message["Subject"] = row.subject
                    sender_address = parseaddr(self.from_address or "")[1]
                    sender_domain = sender_address.partition("@")[2] or "ai-radar.local"
                    message["Message-ID"] = f"<ai-radar-{row.id}@{sender_domain}>"
                    message.set_content(row.body_text)
                    try:
                        if smtp is None:
                            raise smtplib.SMTPServerDisconnected("SMTP connection is unavailable.")
                        smtp.send_message(message)
                        self._finish_attempt(session, row.id, lease_token, current)
                        sent += 1
                    except (
                        OSError,
                        smtplib.SMTPException,
                        UnicodeError,
                        ValueError,
                    ) as error:
                        self._finish_attempt(
                            session,
                            row.id,
                            lease_token,
                            current,
                            error=error,
                        )
                        failed += 1
                    if progress:
                        progress()
                if attempted < limit:
                    row, lease_token = self._claim_next(session, current)
        finally:
            if smtp is not None:
                try:
                    smtp.quit()
                except (OSError, smtplib.SMTPException):
                    pass
        return EmailDeliverySummary(attempted=attempted, sent=sent, failed=failed)

    def requeue_failed(
        self,
        session: Session,
        outbox_id: str,
        expected_attempt_count: int,
    ) -> EmailOutboxRecord | None:
        statement = (
            update(EmailOutboxRecord)
            .where(
                EmailOutboxRecord.id == outbox_id,
                EmailOutboxRecord.status == "failed",
                EmailOutboxRecord.attempt_count == expected_attempt_count,
            )
            .values(
                status="queued",
                attempt_count=0,
                last_attempt_at=None,
                next_attempt_at=None,
                sent_at=None,
                delivery_lease_token=None,
                delivery_lease_expires_at=None,
                error=None,
            )
            .returning(EmailOutboxRecord)
        )
        row = session.scalars(statement.execution_options(populate_existing=True)).first()
        if row is None:
            existing = session.get(EmailOutboxRecord, outbox_id)
            if existing is None:
                return None
            raise ValueError("The outbox message changed and can no longer be requeued.")
        session.flush()
        return row

    def _claim_next(
        self,
        session: Session,
        current: datetime,
    ) -> tuple[EmailOutboxRecord | None, str | None]:
        row = session.scalars(
            select(EmailOutboxRecord)
            .where(self._due_filter(current))
            .order_by(EmailOutboxRecord.created_at)
            .limit(1)
            .with_for_update(skip_locked=True)
        ).first()
        if row is None:
            return None, None
        lease_token = str(uuid4())
        row.status = "sending"
        row.attempt_count += 1
        row.last_attempt_at = current
        row.next_attempt_at = None
        row.delivery_lease_token = lease_token
        row.delivery_lease_expires_at = current + timedelta(seconds=self.lease_seconds)
        session.commit()
        return row, lease_token

    @staticmethod
    def _due_filter(current: datetime):
        return or_(
            and_(
                EmailOutboxRecord.status.in_(("queued", "retrying")),
                or_(
                    EmailOutboxRecord.next_attempt_at.is_(None),
                    EmailOutboxRecord.next_attempt_at <= current,
                ),
            ),
            and_(
                EmailOutboxRecord.status == "sending",
                or_(
                    EmailOutboxRecord.delivery_lease_expires_at.is_(None),
                    EmailOutboxRecord.delivery_lease_expires_at <= current,
                ),
            ),
        )

    def _finish_attempt(
        self,
        session: Session,
        outbox_id: str,
        lease_token: str,
        attempted_at: datetime,
        *,
        error: BaseException | None = None,
    ) -> None:
        row = session.scalars(
            select(EmailOutboxRecord)
            .where(
                EmailOutboxRecord.id == outbox_id,
                EmailOutboxRecord.delivery_lease_token == lease_token,
            )
            .with_for_update()
        ).first()
        if row is None:
            session.rollback()
            return
        if error is None:
            row.status = "sent"
            row.sent_at = attempted_at
            row.next_attempt_at = None
            row.error = None
        else:
            self._mark_failed_attempt(row, error, attempted_at)
        row.delivery_lease_token = None
        row.delivery_lease_expires_at = None
        session.commit()

    def _mark_failed_attempt(
        self,
        row: EmailOutboxRecord,
        error: BaseException,
        attempted_at: datetime,
    ) -> None:
        row.error = str(error)[:2000]
        if row.attempt_count >= self.max_attempts:
            row.status = "failed"
            row.next_attempt_at = None
            return
        retry_seconds = min(
            self.retry_base_seconds * (2 ** (row.attempt_count - 1)),
            21_600,
        )
        row.status = "retrying"
        row.next_attempt_at = attempted_at + timedelta(seconds=retry_seconds)
