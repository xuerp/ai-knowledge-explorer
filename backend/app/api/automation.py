from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, status

from ..automation import AutomationCycleBusyError, automation_cycle_lock
from ..schemas import (
    AutomationCycleResponse,
)
from ..worker import run_cycle
from .dependencies import AutomationDependency, ServicesDependency, SessionDependency

router = APIRouter()


@router.post("/api/v2/automation/run-cycle", response_model=AutomationCycleResponse)
def run_automation_cycle(
    services: ServicesDependency,
    _: AutomationDependency,
    session: SessionDependency,
) -> AutomationCycleResponse:
    current = datetime.now(UTC)
    worker_id = services.app_settings.worker_id
    next_cycle_at = current + timedelta(hours=1)
    try:
        with automation_cycle_lock(services.database.engine):
            try:
                run_id = services.operations.start_ephemeral_cycle(
                    session,
                    worker_id,
                    "scheduled",
                    now=current,
                    active_after_seconds=services.app_settings.automation_cycle_lease_seconds,
                )
            except RuntimeError as error:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=str(error),
                ) from error

            def cycle_heartbeat() -> None:
                with services.database.session() as heartbeat_session:
                    services.operations.heartbeat(
                        heartbeat_session,
                        worker_id,
                        state="running",
                    )

            try:
                result = run_cycle(
                    session,
                    services.scheduler,
                    services.engagement,
                    services.email_delivery,
                    digest_timezone=services.app_settings.digest_timezone,
                    now=current,
                    heartbeat=cycle_heartbeat,
                )
                automatic_extraction = services.run_automatic_extraction(session)
                result["extraction"] = automatic_extraction
                if int(automatic_extraction.get("failed", 0)) > 0:
                    errors = result.setdefault("errors", {})
                    if isinstance(errors, dict):
                        errors["extraction"] = automatic_extraction.get("errors", [])
                cycle_status = services.operations.complete_cycle(
                    session,
                    worker_id,
                    run_id,
                    result,
                    next_cycle_at=next_cycle_at,
                )
            except Exception as error:
                session.rollback()
                services.operations.fail_cycle(
                    session,
                    worker_id,
                    run_id,
                    error,
                    next_cycle_at=next_cycle_at,
                )
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Automation cycle failed.",
                ) from error
    except AutomationCycleBusyError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(error),
        ) from error

    return AutomationCycleResponse(
        cycle_id=run_id,
        worker_id=worker_id,
        status=cycle_status,
        result=result,
        next_cycle_at=next_cycle_at,
    )
