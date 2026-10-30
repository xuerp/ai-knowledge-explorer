from fastapi import Response
from sqlalchemy.orm import Session

from ..engagement import revalidate_research
from ..rag import (
    grounded_retrieval_citations,
)
from ..research_report import build_report, report_markdown, report_pdf
from ..schemas import (
    PublishedResearchView,
    ResearchView,
    RetrievalDiagnostics,
)


class ReportsServices:
    def visible_research(self, result: ResearchView, role: str | None = None) -> ResearchView:
        if role == "admin":
            return result
        return result.model_copy(update={"retrieval_diagnostics": RetrievalDiagnostics()})

    def export_report_response(
        self, result: ResearchView, session: Session, file_format: str, language: str
    ):
        snapshot = self.get_public_snapshot(session)
        document = build_report(revalidate_research(result, snapshot), snapshot, language)
        content = report_pdf(document) if file_format == "pdf" else report_markdown(document)
        return Response(
            content,
            media_type="application/pdf"
            if file_format == "pdf"
            else "text/markdown; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="ai-radar-{result.id}.{file_format}"',
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )

    def published_research_view(
        self,
        result: ResearchView,
        session: Session,
    ) -> PublishedResearchView:
        snapshot = self.get_public_snapshot(session)
        result = revalidate_research(result, snapshot)
        citations_by_id = {item.claim.id: item for item in grounded_retrieval_citations(snapshot)}
        citations = [
            citations_by_id[claim_id]
            for claim_id in result.claim_ids
            if claim_id in citations_by_id
        ]
        return PublishedResearchView.model_validate(
            {
                **result.model_dump(mode="json", by_alias=True),
                "citations": [item.model_dump(mode="json", by_alias=True) for item in citations],
            }
        )
