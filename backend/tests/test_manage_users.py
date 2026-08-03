from sqlalchemy import select

from app.auth import AuthService
from app.database import AuditLogRecord, Database
from app.manage_users import reset_password
from app.schemas import UserCreate


def test_reset_password_reactivates_user_and_records_audit():
    database = Database("sqlite://")
    database.create_all()
    auth = AuthService("test-secret-that-is-long-enough-for-tests", 30)
    try:
        with database.session() as session:
            user = auth.create_user(
                session,
                UserCreate(
                    email="admin@example.com",
                    password="original-password",
                    role="admin",
                ),
            )
            user.active = False
            session.commit()

        assert (
            reset_password(
                database,
                " ADMIN@example.com ",
                "replacement-password",
                "owner@example.com",
            )
            is True
        )

        with database.session() as session:
            assert auth.authenticate(session, "admin@example.com", "original-password") is None
            assert (
                auth.authenticate(session, "owner@example.com", "replacement-password") is not None
            )
            audit = session.scalar(select(AuditLogRecord))
            assert audit is not None
            assert audit.action == "user.password-reset"
    finally:
        database.dispose()


def test_reset_password_returns_false_for_unknown_user():
    database = Database("sqlite://")
    database.create_all()
    try:
        assert reset_password(database, "missing@example.com", "replacement-password") is False
    finally:
        database.dispose()
