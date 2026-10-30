from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import PlainTextResponse

from ..schemas import (
    PublishedResearchView,
)
from .dependencies import ServicesDependency, SessionDependency

router = APIRouter()


@router.get("/api/v2/share/{slug}/report")
def shared_report(
    services: ServicesDependency,
    slug: str,
    session: SessionDependency,
    file_format: Literal["pdf", "md"] = Query("pdf", alias="format"),
    language: Literal["zh", "en"] = "zh",
):
    result = services.engagement.get_research(session, "", public_slug=slug)
    if not result:
        raise HTTPException(status_code=404, detail="Published research not found.")
    return services.export_report_response(result, session, file_format, language)


@router.get("/api/v2/share/{slug}", response_model=PublishedResearchView)
def public_research(
    services: ServicesDependency, slug: str, session: SessionDependency
) -> PublishedResearchView:
    result = services.engagement.get_research(session, "", public_slug=slug)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Published research not found.",
        )
    return services.published_research_view(services.visible_research(result), session)


@router.get("/api/v2/share/{slug}/markdown", response_class=PlainTextResponse)
def public_research_markdown(
    services: ServicesDependency, slug: str, session: SessionDependency
) -> str:
    result = services.engagement.get_research(session, "", public_slug=slug)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Published research not found.",
        )
    published = services.published_research_view(result, session)
    citations = "\n".join(
        f"- `{item.claim.id}` — "
        + ", ".join(f"[{source.publisher}]({source.url})" for source in item.evidence)
        for item in published.citations
    )
    return f"# {result.question}\n\n{result.summary}\n\n## Sources\n\n{citations}\n"
