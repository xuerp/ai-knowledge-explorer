from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import Header, HTTPException, Request, status


def require_admin_token(
    request: Request,
    x_admin_token: Annotated[str | None, Header()] = None,
) -> str:
    configured_token = request.app.state.settings.admin_token
    if not configured_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Administrative writes are disabled until AI_RADAR_ADMIN_TOKEN is configured.",
        )
    if not x_admin_token or not secrets.compare_digest(x_admin_token, configured_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid administrative token.",
            headers={"WWW-Authenticate": "X-Admin-Token"},
        )
    return "token-admin"
