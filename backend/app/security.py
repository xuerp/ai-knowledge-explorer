from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import Header, HTTPException, Request, status

from .auth import Principal


def _resolve_principal(
    request: Request,
    authorization: str | None,
    x_admin_token: str | None,
) -> Principal:
    configured_admin_token = request.app.state.settings.admin_token
    if (
        configured_admin_token
        and x_admin_token
        and secrets.compare_digest(x_admin_token, configured_admin_token)
    ):
        return Principal(
            subject="legacy-admin-token",
            email="legacy-admin@local",
            role="admin",
            legacy_token=True,
        )

    if authorization and authorization.lower().startswith("bearer "):
        principal = request.app.state.auth.decode_token(authorization[7:].strip())
        if principal:
            return principal

    if not configured_admin_token and not request.app.state.auth.enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication is disabled until an admin token or JWT secret is configured.",
        )
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Valid authentication is required.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_user(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> Principal:
    if not authorization or not authorization.lower().startswith("bearer "):
        if not request.app.state.auth.enabled:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="JWT authentication is not configured.",
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A bearer token is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    principal = request.app.state.auth.decode_token(authorization[7:].strip())
    if not principal:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return principal


def require_reviewer(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    x_admin_token: Annotated[str | None, Header()] = None,
) -> Principal:
    principal = _resolve_principal(request, authorization, x_admin_token)
    if principal.role not in {"reviewer", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Reviewer role required.")
    return principal


def require_admin(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    x_admin_token: Annotated[str | None, Header()] = None,
) -> Principal:
    principal = _resolve_principal(request, authorization, x_admin_token)
    if principal.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required.")
    return principal
