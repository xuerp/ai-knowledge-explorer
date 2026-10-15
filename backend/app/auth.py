from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
from pwdlib import PasswordHash
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .database import AuditLogRecord, RememberedSessionRecord, UserRecord
from .schemas import AuditLogView, Role, TokenResponse, UserCreate, UserView


@dataclass(frozen=True, slots=True)
class Principal:
    subject: str
    email: str
    role: Role
    legacy_token: bool = False
    session_id: str | None = None


class AuthService:
    def __init__(self, jwt_secret: str | None, access_token_minutes: int):
        self.jwt_secret = jwt_secret
        self.access_token_minutes = access_token_minutes
        self.password_hash = PasswordHash.recommended()

    @property
    def enabled(self) -> bool:
        return bool(self.jwt_secret)

    def count_users(self, session: Session) -> int:
        return session.scalar(select(func.count()).select_from(UserRecord)) or 0

    def create_user(self, session: Session, payload: UserCreate) -> UserRecord:
        record = UserRecord(
            id=str(uuid4()),
            email=str(payload.email).strip().casefold(),
            password_hash=self.password_hash.hash(payload.password),
            role=payload.role,
            active=True,
            created_at=datetime.now(UTC),
        )
        session.add(record)
        session.commit()
        return record

    def authenticate(self, session: Session, email: str, password: str) -> UserRecord | None:
        record = session.scalar(
            select(UserRecord).where(UserRecord.email == email.strip().casefold())
        )
        if not record or not record.active:
            return None
        if not self.password_hash.verify(password, record.password_hash):
            return None
        return record

    def issue_token(
        self, user: UserRecord, *, remembered_session_id: str | None = None
    ) -> TokenResponse:
        if not self.jwt_secret:
            raise RuntimeError("JWT authentication is not configured")
        now = datetime.now(UTC)
        # Remembering is opt-in. Privileged accounts retain their short lifetime.
        duration = (
            7 * 24 * 60
            if remembered_session_id and user.role == "viewer"
            else min(self.access_token_minutes, 7 * 24 * 60)
            if remembered_session_id
            else self.access_token_minutes
        )
        expires = now + timedelta(minutes=duration)
        token = jwt.encode(
            {
                "sub": user.id,
                "email": user.email,
                "role": user.role,
                "iat": now,
                "exp": expires,
                "iss": "ai-radar",
                "aud": "ai-radar-web",
                **({"sid": remembered_session_id} if remembered_session_id else {}),
            },
            self.jwt_secret,
            algorithm="HS256",
        )
        return TokenResponse(
            access_token=token,
            expires_in=duration * 60,
            user=self.to_user_view(user),
        )

    def remember_login(self, session: Session, user: UserRecord) -> TokenResponse:
        session_id = str(uuid4())
        response = self.issue_token(user, remembered_session_id=session_id)
        session.add(
            RememberedSessionRecord(
                id=session_id,
                user_id=user.id,
                expires_at=datetime.now(UTC) + timedelta(seconds=response.expires_in),
            )
        )
        session.commit()
        return response

    def decode_token(self, token: str) -> Principal | None:
        if not self.jwt_secret:
            return None
        try:
            payload = jwt.decode(
                token,
                self.jwt_secret,
                algorithms=["HS256"],
                audience="ai-radar-web",
                issuer="ai-radar",
            )
            role = payload.get("role")
            if role not in {"viewer", "reviewer", "admin"}:
                return None
            return Principal(
                subject=str(payload["sub"]),
                email=str(payload["email"]),
                role=role,
                session_id=payload.get("sid"),
            )
        except (jwt.InvalidTokenError, KeyError):
            return None

    @staticmethod
    def to_user_view(record: UserRecord) -> UserView:
        return UserView(
            id=record.id,
            email=record.email,
            role=record.role,
            active=record.active,
            daily_digest_enabled=record.daily_digest_enabled,
            digest_hour=record.digest_hour,
            created_at=record.created_at,
        )


class AuditService:
    def record(
        self,
        session: Session,
        principal: Principal,
        action: str,
        target_type: str,
        target_id: str,
        detail: dict[str, object] | None = None,
    ) -> None:
        session.add(
            AuditLogRecord(
                actor=principal.email,
                action=action,
                target_type=target_type,
                target_id=target_id,
                detail_json=json.dumps(detail or {}, ensure_ascii=False),
                created_at=datetime.now(UTC),
            )
        )

    def list(self, session: Session, limit: int = 100) -> list[AuditLogView]:
        rows = session.scalars(
            select(AuditLogRecord).order_by(AuditLogRecord.created_at.desc()).limit(limit)
        ).all()
        return [
            AuditLogView(
                id=row.id,
                actor=row.actor,
                action=row.action,
                target_type=row.target_type,
                target_id=row.target_id,
                detail=json.loads(row.detail_json),
                created_at=row.created_at,
            )
            for row in rows
        ]
