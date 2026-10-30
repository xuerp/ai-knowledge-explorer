from fastapi import APIRouter, HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from ..application_rules import DATABASE_SCHEMA_REVISION
from ..schemas import (
    HealthResponse,
    RelationBackfillStatus,
)
from .dependencies import ServicesDependency, SessionDependency

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health(
    services: ServicesDependency,
) -> HealthResponse:
    return services.health()


@router.head("/ready", include_in_schema=False)
@router.get("/ready", response_model=HealthResponse)
def ready(services: ServicesDependency, session: SessionDependency) -> HealthResponse:
    try:
        if not services.golden_questions.questions_path.is_file():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Golden question runtime data is not ready.",
            )
        session.execute(text("SELECT 1"))
        if services.database.engine.dialect.name != "sqlite":
            revision = session.scalar(text("SELECT version_num FROM alembic_version"))
            if revision != DATABASE_SCHEMA_REVISION:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Database schema revision is not ready.",
                )
        if services.app_settings.data_mode == "live":
            quality = services.get_quality_report(session)
            if not quality.live_ready:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Live data quality gate is not satisfied.",
                )
    except HTTPException:
        raise
    except SQLAlchemyError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database readiness check failed.",
        ) from error
    return services.health()


@router.get(
    "/api/v2/public/relation-backfill-status",
    response_model=RelationBackfillStatus,
)
def public_relation_backfill_status(
    services: ServicesDependency,
    session: SessionDependency,
) -> RelationBackfillStatus:
    return services.get_relation_backfill_status(session)
