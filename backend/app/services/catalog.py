import json
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import (
    KnowledgeEntityRecord,
    KnowledgeRelationRecord,
    KnowledgeTimelineRecord,
    PublicationRecordRow,
)
from ..evaluation_scope import assess_evaluation
from ..schemas import (
    DataQualityReport,
    EvaluationQualityMetrics,
    GoldenQuestionReport,
    KnowledgeSnapshot,
)


class CatalogServices:
    def get_catalog_snapshot(self, session: Session) -> KnowledgeSnapshot:
        return self.repository.public_snapshot(session)

    def get_golden_question_report(self, session: Session) -> GoldenQuestionReport:
        return self.golden_questions.evaluate(
            self.get_catalog_snapshot(session),
            session=session,
            retriever=self.engagement.retriever,
        )

    def get_quality_report(
        self,
        session: Session,
        *,
        include_retrieval: bool = True,
    ) -> DataQualityReport:
        snapshot = self.get_catalog_snapshot(session)
        report = self.quality_gate.report(snapshot)
        golden = self.golden_questions.evaluate(
            snapshot,
            session=session if include_retrieval else None,
            retriever=self.engagement.retriever if include_retrieval else None,
        )
        issues = [*report.issues]
        if not include_retrieval:
            issues.append("完整 RAG 检索评估未在快速概览中执行，正式发布前必须单独运行。")
        if not golden.ready:
            issues.append(
                f"Golden question pass ratio must reach {golden.required_ratio:.0%}; "
                f"current ratio is {golden.pass_ratio:.0%}."
            )
        return report.model_copy(
            update={
                "evaluation_scope": "full" if include_retrieval else "overview",
                "golden_questions": golden,
                "live_ready": report.live_ready and golden.ready and include_retrieval,
                "issues": issues,
            }
        )

    def business_metrics_updated_at(self, session: Session) -> datetime:
        candidates = [
            session.scalar(select(func.max(KnowledgeEntityRecord.updated_at))),
            session.scalar(select(func.max(KnowledgeRelationRecord.updated_at))),
            session.scalar(select(func.max(KnowledgeTimelineRecord.updated_at))),
            session.scalar(select(func.max(PublicationRecordRow.published_at))),
        ]
        latest = max((item for item in candidates if item is not None), default=None)
        if latest is None:
            return datetime.now(UTC)
        return latest if latest.tzinfo is not None else latest.replace(tzinfo=UTC)

    def evaluation_quality_metrics(self, snapshot: KnowledgeSnapshot) -> EvaluationQualityMetrics:
        try:
            payload = json.loads(
                self.app_settings.quality_evaluation_path.read_text(encoding="utf-8")
            )
            reference = payload.pop("reference", None)
            evaluation = EvaluationQualityMetrics.model_validate(payload)
            return evaluation.model_copy(
                update={
                    "applicability": assess_evaluation(
                        evaluation, reference, snapshot, self.app_settings
                    )
                }
            )
        except (OSError, json.JSONDecodeError, ValueError) as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="The committed retrieval evaluation artifact is unavailable.",
            ) from error

    def get_public_snapshot(self, session: Session) -> KnowledgeSnapshot:
        snapshot = self.get_catalog_snapshot(session)
        if self.app_settings.data_mode == "live":
            quality = self.get_quality_report(session)
            if not quality.live_ready:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Live data quality gate is not satisfied.",
                )
        return snapshot
