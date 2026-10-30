from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy.exc import IntegrityError

from ..auth import Principal
from ..database import (
    RememberedSessionRecord,
    UserRecord,
)
from ..schemas import (
    BootstrapUser,
    LoginRequest,
    TokenResponse,
    UserCreate,
    UserView,
)
from .dependencies import AdminDependency, ServicesDependency, SessionDependency, UserDependency

router = APIRouter()


@router.post("/api/v2/auth/bootstrap", response_model=TokenResponse)
def bootstrap_user(
    services: ServicesDependency,
    payload: BootstrapUser,
    principal: AdminDependency,
    session: SessionDependency,
) -> TokenResponse:
    if not services.auth.enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI_RADAR_JWT_SECRET must be configured before bootstrapping users.",
        )
    if services.auth.count_users(session):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Bootstrap is only available before the first user is created.",
        )
    user = services.auth.create_user(
        session,
        UserCreate(email=payload.email, password=payload.password, role="admin"),
    )
    services.audit.record(session, principal, "user.bootstrap", "user", user.id, {"role": "admin"})
    session.commit()
    return services.auth.issue_token(user)


@router.post("/api/v2/auth/login", response_model=TokenResponse)
def login(
    services: ServicesDependency, payload: LoginRequest, session: SessionDependency
) -> TokenResponse:
    if not services.auth.enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="JWT authentication is not configured.",
        )
    user = services.auth.authenticate(session, str(payload.email), payload.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )
    return (
        services.auth.remember_login(session, user)
        if payload.remember_me
        else services.auth.issue_token(user)
    )


@router.post("/api/v2/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    services: ServicesDependency, principal: UserDependency, session: SessionDependency
) -> Response:
    from sqlalchemy import delete
    from sqlalchemy.dialects.postgresql import insert as postgres_insert
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert

    from ..database import RevokedAccessTokenRecord

    now = datetime.now(UTC)
    session.execute(
        delete(RevokedAccessTokenRecord).where(RevokedAccessTokenRecord.expires_at <= now)
    )
    if principal.token_fingerprint and principal.expires_at:
        insert = sqlite_insert if session.bind.dialect.name == "sqlite" else postgres_insert
        session.execute(
            insert(RevokedAccessTokenRecord)
            .values(
                fingerprint=principal.token_fingerprint,
                expires_at=principal.expires_at,
            )
            .on_conflict_do_nothing(index_elements=["fingerprint"])
        )
    if principal.session_id:
        remembered = session.get(RememberedSessionRecord, principal.session_id)
        if remembered and remembered.user_id == principal.subject:
            remembered.revoked_at = datetime.now(UTC)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/api/v2/auth/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
)
def register(
    services: ServicesDependency, payload: BootstrapUser, session: SessionDependency
) -> TokenResponse:
    if not services.auth.enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="JWT authentication is not configured.",
        )
    try:
        user = services.auth.create_user(
            session,
            UserCreate(email=payload.email, password=payload.password, role="viewer"),
        )
    except IntegrityError as error:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        ) from error
    services.audit.record(
        session,
        Principal(subject=user.id, email=user.email, role="viewer"),
        "user.register",
        "user",
        user.id,
        {"role": "viewer"},
    )
    session.commit()
    return services.auth.issue_token(user)


@router.get("/api/v2/auth/me", response_model=UserView)
def me(
    services: ServicesDependency, principal: UserDependency, session: SessionDependency
) -> UserView:
    user = session.get(UserRecord, principal.subject)
    if not user or not user.active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return services.auth.to_user_view(user)
