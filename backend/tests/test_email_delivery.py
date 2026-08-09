import smtplib
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from pathlib import Path

import pytest

from app.database import Database, EmailOutboxRecord, UserRecord
from app.email_delivery import EmailDeliveryService


class FakeSmtp:
    def __init__(self, host: str, port: int, timeout: float):
        self.connection = (host, port, timeout)
        self.messages: list[EmailMessage] = []
        self.started_tls = False

    def starttls(self, *, context: object) -> None:
        self.started_tls = context is not None

    def login(self, username: str, password: str) -> None:
        assert (username, password) == ("smtp-user", "smtp-password")

    def send_message(self, message: EmailMessage) -> None:
        self.messages.append(message)

    def quit(self) -> None:
        pass


class FailingSmtp(FakeSmtp):
    def send_message(self, message: EmailMessage) -> None:
        raise smtplib.SMTPServerDisconnected("Temporary SMTP outage")


def test_email_outbox_delivery_marks_rows_sent(tmp_path: Path):
    database = Database(f"sqlite:///{(tmp_path / 'email.db').as_posix()}")
    database.create_all()
    fake_instances: list[FakeSmtp] = []

    def factory(host: str, port: int, timeout: float) -> FakeSmtp:
        instance = FakeSmtp(host, port, timeout)
        fake_instances.append(instance)
        return instance

    with database.session() as session:
        session.add(
            UserRecord(
                id="user-email",
                email="reader@example.com",
                password_hash="unused",
                role="viewer",
                active=True,
                created_at=datetime.now(UTC),
            )
        )
        session.add(
            EmailOutboxRecord(
                id="outbox-email",
                user_id="user-email",
                to_email="reader@example.com",
                subject="AI Radar digest",
                body_text="- One verified update",
                status="queued",
                created_at=datetime.now(UTC),
            )
        )
        session.commit()
        service = EmailDeliveryService(
            "smtp.example.com",
            587,
            "smtp-user",
            "smtp-password",
            "radar@example.com",
            True,
            smtp_factory=factory,
        )

        result = service.send_queued(session)

        assert result.model_dump() == {"attempted": 1, "sent": 1, "failed": 0}
        assert session.get(EmailOutboxRecord, "outbox-email").status == "sent"
        assert fake_instances[0].started_tls is True
        assert fake_instances[0].messages[0]["To"] == "reader@example.com"
        assert fake_instances[0].messages[0]["Message-ID"] == (
            "<ai-radar-outbox-email@example.com>"
        )
    database.dispose()


def test_email_delivery_retries_with_backoff_and_allows_manual_requeue(tmp_path: Path):
    database = Database(f"sqlite:///{(tmp_path / 'email-retry.db').as_posix()}")
    database.create_all()
    started = datetime(2026, 8, 9, 4, 0, tzinfo=UTC)

    with database.session() as session:
        session.add(
            UserRecord(
                id="retry-user",
                email="retry@example.com",
                password_hash="unused",
                role="viewer",
                active=True,
                created_at=started,
            )
        )
        session.add(
            EmailOutboxRecord(
                id="retry-email",
                user_id="retry-user",
                to_email="retry@example.com",
                subject="Retry digest",
                body_text="- One verified update",
                status="queued",
                created_at=started,
            )
        )
        session.commit()

        failing = EmailDeliveryService(
            "smtp.example.com",
            587,
            None,
            None,
            "radar@example.com",
            False,
            max_attempts=2,
            retry_base_seconds=60,
            smtp_factory=FailingSmtp,
        )
        first = failing.send_queued(session, now=started)
        row = session.get(EmailOutboxRecord, "retry-email")
        assert first.model_dump() == {"attempted": 1, "sent": 0, "failed": 1}
        assert row is not None
        assert row.status == "retrying"
        assert row.attempt_count == 1
        assert row.next_attempt_at is not None
        assert row.next_attempt_at.replace(tzinfo=UTC) == started + timedelta(seconds=60)

        early = failing.send_queued(session, now=started + timedelta(seconds=30))
        assert early.attempted == 0
        terminal = failing.send_queued(session, now=started + timedelta(seconds=60))
        assert terminal.failed == 1
        assert row.status == "failed"
        assert row.attempt_count == 2
        assert row.next_attempt_at is None

        requeued = failing.requeue_failed(session, row.id, expected_attempt_count=2)
        assert requeued is row
        assert row.status == "queued"
        assert row.attempt_count == 0
        assert row.error is None
        with pytest.raises(ValueError, match="changed"):
            failing.requeue_failed(session, row.id, expected_attempt_count=2)

        recovered = EmailDeliveryService(
            "smtp.example.com",
            587,
            None,
            None,
            "radar@example.com",
            False,
            smtp_factory=FakeSmtp,
        ).send_queued(session, now=started + timedelta(minutes=2))
        assert recovered.sent == 1
        assert row.status == "sent"
        assert row.attempt_count == 1

    database.dispose()


def test_email_delivery_recovers_expired_sending_lease(tmp_path: Path):
    database = Database(f"sqlite:///{(tmp_path / 'expired-email-lease.db').as_posix()}")
    database.create_all()
    current = datetime(2026, 8, 9, 5, 0, tzinfo=UTC)

    with database.session() as session:
        session.add(
            UserRecord(
                id="lease-user",
                email="lease@example.com",
                password_hash="unused",
                role="viewer",
                active=True,
                created_at=current,
            )
        )
        session.add(
            EmailOutboxRecord(
                id="leased-email",
                user_id="lease-user",
                to_email="lease@example.com",
                subject="Recovered lease digest",
                body_text="- Recover this message",
                status="sending",
                attempt_count=1,
                last_attempt_at=current - timedelta(minutes=3),
                delivery_lease_token="abandoned-lease",
                delivery_lease_expires_at=current - timedelta(minutes=1),
                created_at=current - timedelta(minutes=5),
            )
        )
        session.commit()

        result = EmailDeliveryService(
            "smtp.example.com",
            587,
            None,
            None,
            "radar@example.com",
            False,
            smtp_factory=FakeSmtp,
        ).send_queued(session, now=current)
        row = session.get(EmailOutboxRecord, "leased-email")
        assert result.model_dump() == {"attempted": 1, "sent": 1, "failed": 0}
        assert row is not None
        assert row.status == "sent"
        assert row.attempt_count == 2
        assert row.delivery_lease_token is None
        assert row.delivery_lease_expires_at is None

    database.dispose()
