from datetime import UTC, datetime
from email.message import EmailMessage
from pathlib import Path

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
    database.dispose()
