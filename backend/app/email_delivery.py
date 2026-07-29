from __future__ import annotations

import smtplib
import ssl
from datetime import UTC, datetime
from email.message import EmailMessage
from typing import Protocol

from sqlalchemy import select
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
        smtp_factory: _SmtpFactory = smtplib.SMTP,
    ):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.from_address = from_address
        self.starttls = starttls
        self.smtp_factory = smtp_factory

    @property
    def enabled(self) -> bool:
        return bool(self.host and self.from_address)

    def send_queued(self, session: Session, limit: int = 50) -> EmailDeliverySummary:
        if not self.enabled:
            raise EmailDeliveryUnavailableError(
                "Configure AI_RADAR_SMTP_HOST and AI_RADAR_SMTP_FROM before delivery."
            )
        rows = session.scalars(
            select(EmailOutboxRecord)
            .where(EmailOutboxRecord.status == "queued")
            .order_by(EmailOutboxRecord.created_at)
            .limit(limit)
        ).all()
        sent = failed = 0
        if not rows:
            return EmailDeliverySummary(attempted=0, sent=0, failed=0)
        smtp = self.smtp_factory(self.host or "", self.port, timeout=20.0)
        try:
            if self.starttls:
                smtp.starttls(context=ssl.create_default_context())
            if self.username:
                smtp.login(self.username, self.password or "")
            for row in rows:
                message = EmailMessage()
                message["From"] = self.from_address
                message["To"] = row.to_email
                message["Subject"] = row.subject
                message.set_content(row.body_text)
                try:
                    smtp.send_message(message)
                    row.status = "sent"
                    row.sent_at = datetime.now(UTC)
                    row.error = None
                    sent += 1
                except (OSError, smtplib.SMTPException) as error:
                    row.status = "failed"
                    row.error = str(error)[:2000]
                    failed += 1
                session.commit()
        finally:
            try:
                smtp.quit()
            except (OSError, smtplib.SMTPException):
                pass
        return EmailDeliverySummary(attempted=len(rows), sent=sent, failed=failed)
