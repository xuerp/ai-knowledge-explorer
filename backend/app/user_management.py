"""Administrator account operations; private research is never included."""

from datetime import UTC, datetime
from typing import ClassVar, Literal

from fastapi import HTTPException
from pydantic import ConfigDict, EmailStr, Field, model_validator
from sqlalchemy import func, select, text, update
from sqlalchemy.orm import Session

from .auth import Principal
from .database import RememberedSessionRecord, UserRecord
from .schemas import CamelModel, Role, UserCreate, UserView


class AdminUserCreate(UserCreate):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", populate_by_name=True)


class ManagedUser(UserView):
    version: int


class UserPage(CamelModel):
    items: list[ManagedUser]
    total: int
    offset: int
    limit: int


class UserUpdate(CamelModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", populate_by_name=True)
    expected_version: int = Field(ge=0)
    email: EmailStr | None = None
    role: Role | None = None
    active: bool | None = None

    @model_validator(mode="after")
    def require_change(self):
        if self.email is None and self.role is None and self.active is None:
            raise ValueError("Choose an account change.")
        return self


class PasswordReset(CamelModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", populate_by_name=True)
    expected_version: int = Field(ge=0)
    password: str = Field(min_length=12, max_length=256)


def managed_user(services, row: UserRecord) -> ManagedUser:
    return ManagedUser(**services.auth.to_user_view(row).model_dump(), version=row.session_version)


def user_page(
    services,
    session: Session,
    q: str,
    role: Role | None,
    account_status: Literal["all", "active", "disabled"],
    offset: int,
    limit: int,
) -> UserPage:
    filters = []
    if q.strip():
        filters.append(UserRecord.email.contains(q.strip().casefold(), autoescape=True))
    if role:
        filters.append(UserRecord.role == role)
    if account_status != "all":
        filters.append(UserRecord.active == (account_status == "active"))
    total = session.scalar(select(func.count()).select_from(UserRecord).where(*filters)) or 0
    rows = session.scalars(
        select(UserRecord)
        .where(*filters)
        .order_by(UserRecord.created_at.desc(), UserRecord.id)
        .offset(offset)
        .limit(limit)
    )
    return UserPage(
        items=[managed_user(services, row) for row in rows], total=total, offset=offset, limit=limit
    )


def lock_account_changes(session: Session, principal: Principal) -> None:
    # Serialize mutations before reading roles. This also protects two admins who
    # concurrently try to disable or demote each other, across server processes.
    if session.bind.dialect.name == "postgresql":
        session.execute(text("SELECT pg_advisory_xact_lock(107104, 30)"))
    elif session.bind.dialect.name == "sqlite":
        session.execute(text("BEGIN IMMEDIATE"))
    if not principal.legacy_token:
        actor = session.get(UserRecord, principal.subject, populate_existing=True)
        if (
            not actor
            or not actor.active
            or actor.role != "admin"
            or actor.session_version != principal.session_version
        ):
            raise HTTPException(401, "管理员登录状态已变化，请重新登录。")


def target_user(session: Session, user_id: str, expected_version: int) -> UserRecord:
    row = session.get(UserRecord, user_id, populate_existing=True)
    if row is None:
        raise HTTPException(404, "账户不存在，请刷新列表。")
    if row.session_version != expected_version:
        raise HTTPException(409, "账户已被其他操作更新，请刷新后重试。")
    return row


def invalidate_sessions(session: Session, row: UserRecord) -> None:
    row.session_version += 1
    session.execute(
        update(RememberedSessionRecord)
        .where(
            RememberedSessionRecord.user_id == row.id, RememberedSessionRecord.revoked_at.is_(None)
        )
        .values(revoked_at=datetime.now(UTC))
    )


def update_user(
    services, session: Session, principal: Principal, user_id: str, payload: UserUpdate
) -> ManagedUser:
    lock_account_changes(session, principal)
    row = target_user(session, user_id, payload.expected_version)
    next_role = payload.role if payload.role is not None else row.role
    next_active = payload.active if payload.active is not None else row.active
    if row.id == principal.subject and (not next_active or next_role != "admin"):
        raise HTTPException(409, "不能停用自己的账户或移除自己的管理员权限。")
    if row.active and row.role == "admin" and (not next_active or next_role != "admin"):
        count = (
            session.scalar(
                select(func.count())
                .select_from(UserRecord)
                .where(UserRecord.role == "admin", UserRecord.active.is_(True))
            )
            or 0
        )
        if count <= 1:
            raise HTTPException(409, "至少需要保留一名启用的管理员。")
    before = {"email": row.email, "role": row.role, "active": row.active}
    email = str(payload.email).strip().casefold() if payload.email is not None else row.email
    if (email, next_role, next_active) == (row.email, row.role, row.active):
        return managed_user(services, row)
    row.email, row.role, row.active = email, next_role, next_active
    invalidate_sessions(session, row)
    services.audit.record(
        session,
        principal,
        "user.update",
        "user",
        row.id,
        {"before": before, "after": {"email": email, "role": next_role, "active": next_active}},
    )
    session.flush()
    result = managed_user(services, row)
    session.commit()
    return result


def reset_user_password(
    services, session: Session, principal: Principal, user_id: str, payload: PasswordReset
) -> ManagedUser:
    lock_account_changes(session, principal)
    row = target_user(session, user_id, payload.expected_version)
    row.password_hash = services.auth.password_hash.hash(payload.password)
    invalidate_sessions(session, row)
    services.audit.record(
        session, principal, "user.password-reset", "user", row.id, {"sessionsRevoked": True}
    )
    session.flush()
    result = managed_user(services, row)
    session.commit()
    return result
