from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Response, status

from ..decision_evidence_requests import (
    DecisionEvidenceRequestCreate,
    DecisionEvidenceRequestView,
    create_evidence_request,
    evidence_requests,
)
from ..decision_validation import save_validation, validation_view
from ..engagement import revalidate_research
from ..knowledge_checks import (
    KnowledgeCheckCreate,
    KnowledgeCheckView,
    create_knowledge_check,
    knowledge_checks,
)
from ..schemas import (
    DecisionValidationSave,
    DecisionValidationView,
    ResearchCreate,
    ResearchHistoryPage,
    ResearchView,
)
from .dependencies import ServicesDependency, SessionDependency, UserDependency

router = APIRouter()


@router.post("/api/v2/research", response_model=ResearchView)
def create_research(
    services: ServicesDependency,
    payload: ResearchCreate,
    principal: UserDependency,
    session: SessionDependency,
) -> ResearchView:
    result = services.engagement.research(
        session,
        principal.subject,
        payload,
        services.get_public_snapshot(session),
    )
    return services.visible_research(
        revalidate_research(result, services.get_public_snapshot(session)), principal.role
    )


@router.get("/api/v2/research", response_model=ResearchHistoryPage)
def research_history(
    services: ServicesDependency,
    principal: UserDependency,
    session: SessionDependency,
    response: Response,
    limit: int = Query(5, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> ResearchHistoryPage:
    """One page of the signed-in owner's research; every record stays reachable."""
    response.headers["Cache-Control"] = "no-store"
    engagement = services.engagement
    return ResearchHistoryPage(
        items=engagement.list_research(session, principal.subject, limit=limit, offset=offset),
        total=engagement.count_research(session, principal.subject),
        offset=offset,
        limit=limit,
    )


@router.get("/api/v2/research/{research_id}", response_model=ResearchView)
def research_detail(
    services: ServicesDependency,
    research_id: str,
    principal: UserDependency,
    session: SessionDependency,
) -> ResearchView:
    result = services.engagement.get_research(
        session,
        research_id,
        user_id=principal.subject,
    )
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Research not found.")
    return services.visible_research(
        revalidate_research(result, services.get_public_snapshot(session)), principal.role
    )


@router.delete("/api/v2/research/{research_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_research(
    services: ServicesDependency,
    research_id: str,
    principal: UserDependency,
    session: SessionDependency,
) -> None:
    if not services.engagement.delete_research(session, research_id, principal.subject):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Research not found.")


@router.get("/api/v2/research/{research_id}/validation", response_model=DecisionValidationView)
def research_validation(
    services: ServicesDependency,
    research_id: str,
    principal: UserDependency,
    session: SessionDependency,
) -> DecisionValidationView:
    return validation_view(
        session, research_id, principal.subject, services.get_public_snapshot(session)
    )


@router.get(
    "/api/v2/research/{research_id}/evidence-requests",
    response_model=list[DecisionEvidenceRequestView],
)
def research_evidence_requests(
    services: ServicesDependency,
    research_id: str,
    principal: UserDependency,
    session: SessionDependency,
):
    return evidence_requests(
        session, research_id, principal.subject, services.get_public_snapshot(session)
    )


@router.post(
    "/api/v2/research/{research_id}/evidence-requests",
    response_model=DecisionEvidenceRequestView,
    status_code=201,
)
def request_decision_evidence(
    services: ServicesDependency,
    research_id: str,
    payload: DecisionEvidenceRequestCreate,
    principal: UserDependency,
    session: SessionDependency,
):
    return create_evidence_request(
        session, research_id, principal.subject, payload, services.get_public_snapshot(session)
    )


@router.get(
    "/api/v2/research/{research_id}/knowledge-checks", response_model=list[KnowledgeCheckView]
)
def research_knowledge_checks(
    research_id: str,
    principal: UserDependency,
    session: SessionDependency,
):
    return knowledge_checks(session, research_id, principal.subject)


@router.post(
    "/api/v2/research/{research_id}/knowledge-checks",
    response_model=KnowledgeCheckView,
    status_code=201,
)
def request_knowledge_check(
    services: ServicesDependency,
    research_id: str,
    payload: KnowledgeCheckCreate,
    principal: UserDependency,
    session: SessionDependency,
):
    return create_knowledge_check(
        session, research_id, principal.subject, payload, services.get_public_snapshot(session)
    )


@router.get("/api/v2/research/{research_id}/report")
def private_report(
    services: ServicesDependency,
    research_id: str,
    principal: UserDependency,
    session: SessionDependency,
    file_format: Literal["pdf", "md"] = Query("pdf", alias="format"),
    language: Literal["zh", "en"] = "zh",
):
    result = services.engagement.get_research(session, research_id, user_id=principal.subject)
    if not result:
        raise HTTPException(status_code=404, detail="Research not found.")
    return services.export_report_response(result, session, file_format, language)


@router.put("/api/v2/research/{research_id}/validation", response_model=DecisionValidationView)
def update_research_validation(
    services: ServicesDependency,
    research_id: str,
    payload: DecisionValidationSave,
    principal: UserDependency,
    session: SessionDependency,
) -> DecisionValidationView:
    return save_validation(
        session, research_id, principal.subject, payload, services.get_public_snapshot(session)
    )


@router.post("/api/v2/research/{research_id}/publish", response_model=ResearchView)
def publish_research(
    services: ServicesDependency,
    research_id: str,
    principal: UserDependency,
    session: SessionDependency,
) -> ResearchView:
    result = services.engagement.publish_research(session, research_id, principal.subject)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Research not found.")
    return services.visible_research(
        revalidate_research(result, services.get_public_snapshot(session)), principal.role
    )
