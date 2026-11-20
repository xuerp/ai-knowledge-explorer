from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import PlainTextResponse

from ..research_report import build_report, report_markdown
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
    report = report_markdown(build_report(published, services.get_public_snapshot(session), "zh"))
    # Keep citation IDs for older download callers.
    references = "\n".join(f"- `{item.claim.id}`" for item in published.citations)
    return report + ("\n## 引用标识\n\n" + references + "\n" if references else "")
