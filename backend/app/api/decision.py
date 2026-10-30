from fastapi import APIRouter, Response

from .dependencies import AdminDependency, ServicesDependency, UserDependency

router = APIRouter()


@router.get("/api/v2/decision-interpretation")
def own_decision_interpretation(
    services: ServicesDependency, response: Response, principal: UserDependency
):
    response.headers["Cache-Control"] = "no-store"
    allows_user = getattr(services.task_interpreter, "allows_user", None)
    if not allows_user or not allows_user(principal.subject):
        return {"enabled": False}
    diagnostics = services.task_interpreter.diagnostics()
    return {
        key: diagnostics[key]
        for key in (
            "enabled",
            "limitCalls",
            "usedCalls",
            "remainingCalls",
            "blocked",
            "inFlightOrInterrupted",
        )
    }


@router.get("/api/v2/admin/decision-interpretation")
def decision_interpretation_diagnostics(
    services: ServicesDependency, response: Response, _: AdminDependency
):
    response.headers["Cache-Control"] = "no-store"
    diagnostics = getattr(services.task_interpreter, "diagnostics", None)
    return diagnostics() if diagnostics else {"enabled": False}
