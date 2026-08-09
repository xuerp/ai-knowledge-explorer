from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select

from app.database import Database, EmailOutboxRecord, NotificationRecord, UserRecord
from app.email_delivery import EmailDeliveryService
from app.engagement import EngagementService
from app.fetching import SafeHttpFetcher
from app.ingestion import IngestionService
from app.scheduler import IngestionScheduler
from app.worker import run_cycle


def _seed_digest_user(database: Database) -> None:
    with database.session() as session:
        session.add(
            UserRecord(
                id="digest-user",
                email="reader@example.com",
                password_hash="unused",
                role="viewer",
                active=True,
                daily_digest_enabled=True,
                digest_hour="08:30",
                created_at=datetime(2026, 8, 1, tzinfo=UTC),
            )
        )
        session.add(
            NotificationRecord(
                id="notification-first",
                user_id="digest-user",
                entity_id="e-gpt",
                change_id="change-first",
                title="First reviewed update",
                priority="normal",
                created_at=datetime(2026, 8, 9, 0, 0, tzinfo=UTC),
            )
        )
        session.commit()


def test_daily_digest_is_due_once_and_only_includes_new_notifications(tmp_path: Path):
    database = Database(f"sqlite:///{(tmp_path / 'digest.db').as_posix()}")
    database.create_all()
    _seed_digest_user(database)
    service = EngagementService()

    with database.session() as session:
        before = service.queue_daily_digests(
            session,
            now=datetime(2026, 8, 9, 0, 29, tzinfo=UTC),
            timezone_name="Asia/Shanghai",
            due_only=True,
        )
        assert before.model_dump() == {"recipients": 0, "messages_queued": 0}

        first = service.queue_daily_digests(
            session,
            now=datetime(2026, 8, 9, 0, 30, tzinfo=UTC),
            timezone_name="Asia/Shanghai",
            due_only=True,
        )
        duplicate = service.queue_daily_digests(
            session,
            now=datetime(2026, 8, 9, 0, 45, tzinfo=UTC),
            timezone_name="Asia/Shanghai",
            due_only=True,
        )
        assert first.model_dump() == {"recipients": 1, "messages_queued": 1}
        assert duplicate.model_dump() == {"recipients": 1, "messages_queued": 0}

        session.add(
            NotificationRecord(
                id="notification-second",
                user_id="digest-user",
                entity_id="e-gpt",
                change_id="change-second",
                title="Second reviewed update",
                priority="important",
                created_at=datetime(2026, 8, 9, 12, 0, tzinfo=UTC),
            )
        )
        session.commit()
        second = service.queue_daily_digests(
            session,
            now=datetime(2026, 8, 10, 0, 30, tzinfo=UTC),
            timezone_name="Asia/Shanghai",
            due_only=True,
        )
        assert second.model_dump() == {"recipients": 1, "messages_queued": 1}

        outbox = session.scalars(
            select(EmailOutboxRecord).order_by(EmailOutboxRecord.created_at)
        ).all()
        assert [row.delivery_key for row in outbox] == [
            "daily:digest-user:2026-08-09",
            "daily:digest-user:2026-08-10",
        ]
        assert "First reviewed update" in outbox[0].body_text
        assert "Second reviewed update" in outbox[1].body_text
        assert "First reviewed update" not in outbox[1].body_text
    database.dispose()


def test_worker_cycle_queues_digest_without_smtp(tmp_path: Path):
    database = Database(f"sqlite:///{(tmp_path / 'worker.db').as_posix()}")
    database.create_all()
    _seed_digest_user(database)

    with database.session() as session:
        result = run_cycle(
            session,
            IngestionScheduler(SafeHttpFetcher((), 2_000_000), IngestionService()),
            EngagementService(),
            EmailDeliveryService(None, 587, None, None, None, True),
            digest_timezone="Asia/Shanghai",
            now=datetime(2026, 8, 9, 0, 30, tzinfo=UTC),
        )

        assert result["ingestion"] == {
            "due": 0,
            "succeeded": 0,
            "unchanged": 0,
            "failed": 0,
        }
        assert result["digests"] == {"recipients": 1, "messagesQueued": 1}
        assert result["emailDelivery"] == {
            "configured": False,
            "attempted": 0,
            "sent": 0,
            "failed": 0,
        }
    database.dispose()
