from __future__ import annotations

import argparse
import getpass
from datetime import UTC, datetime

from pwdlib import PasswordHash
from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import select

from .config import Settings
from .database import AuditLogRecord, Database, UserRecord

EMAIL_ADAPTER = TypeAdapter(EmailStr)


def reset_password(
    database: Database,
    email: str,
    password: str,
    new_email: str | None = None,
) -> bool:
    normalized_email = email.strip().casefold()
    normalized_new_email = (
        str(EMAIL_ADAPTER.validate_python(new_email)).casefold() if new_email else None
    )
    with database.session() as session:
        user = session.scalar(select(UserRecord).where(UserRecord.email == normalized_email))
        if user is None:
            return False
        user.password_hash = PasswordHash.recommended().hash(password)
        user.active = True
        if normalized_new_email:
            user.email = normalized_new_email
        session.add(
            AuditLogRecord(
                actor="local-user-management-cli",
                action="user.password-reset",
                target_type="user",
                target_id=user.id,
                detail_json='{"method":"local-cli"}',
                created_at=datetime.now(UTC),
            )
        )
        session.commit()
        return True


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage local AI Radar users safely.")
    subcommands = parser.add_subparsers(dest="command", required=True)
    reset = subcommands.add_parser("reset-password", help="Reset an existing user's password.")
    reset.add_argument("--email", required=True)
    reset.add_argument(
        "--new-email",
        help="Optionally replace the sample login email while preserving the user record.",
    )
    return parser


def main() -> int:
    args = _build_parser().parse_args()
    settings = Settings.from_env()
    database = Database(settings.database_url)
    try:
        if args.command == "reset-password":
            password = getpass.getpass("New password (at least 12 characters): ")
            confirmation = getpass.getpass("Repeat new password: ")
            if len(password) < 12:
                print("Password must contain at least 12 characters.")
                return 2
            if password != confirmation:
                print("Passwords do not match.")
                return 2
            try:
                changed = reset_password(database, args.email, password, args.new_email)
            except ValidationError:
                print("The new email address is not valid.")
                return 2
            if not changed:
                print(f"No user exists for {args.email.strip().casefold()}.")
                return 1
            login_email = args.new_email or args.email
            print(f"Account updated. Sign in as {login_email.strip().casefold()}.")
            return 0
    finally:
        database.dispose()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
