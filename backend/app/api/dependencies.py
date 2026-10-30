"""Shared request-scoped session and existing authorization dependencies."""

from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from ..auth import Principal
from ..runtime import ApplicationServices
from ..security import require_admin, require_automation, require_reviewer, require_user


def get_services(request: Request) -> ApplicationServices:
    return request.app.state.services


def get_session(request: Request):
    session = request.app.state.database.session()
    try:
        yield session
    finally:
        session.close()


ServicesDependency = Annotated[ApplicationServices, Depends(get_services)]
SessionDependency = Annotated[Session, Depends(get_session)]
UserDependency = Annotated[Principal, Depends(require_user)]
ReviewerDependency = Annotated[Principal, Depends(require_reviewer)]
AdminDependency = Annotated[Principal, Depends(require_admin)]
AutomationDependency = Annotated[None, Depends(require_automation)]
