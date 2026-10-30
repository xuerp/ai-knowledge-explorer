from fastapi import APIRouter, HTTPException, status

from ..database import (
    UserRecord,
)
from ..schemas import (
    DigestPreference,
    FollowCreate,
    FollowView,
    NotificationView,
    UserView,
)
from .dependencies import ServicesDependency, SessionDependency, UserDependency

router = APIRouter()


@router.post("/api/v2/following", response_model=FollowView)
def follow_entity(
    services: ServicesDependency,
    payload: FollowCreate,
    principal: UserDependency,
    session: SessionDependency,
) -> FollowView:
    result = services.engagement.follow(
        session,
        principal.subject,
        payload,
        services.get_public_snapshot(session),
    )
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found.")
    return result


@router.get("/api/v2/following", response_model=list[FollowView])
def following(
    services: ServicesDependency,
    principal: UserDependency,
    session: SessionDependency,
) -> list[FollowView]:
    return services.engagement.list_follows(session, principal.subject)


@router.delete("/api/v2/following/{follow_id}", status_code=status.HTTP_204_NO_CONTENT)
def unfollow_entity(
    services: ServicesDependency,
    follow_id: str,
    principal: UserDependency,
    session: SessionDependency,
) -> None:
    if not services.engagement.unfollow(session, principal.subject, follow_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Follow not found.")


@router.get("/api/v2/notifications", response_model=list[NotificationView])
def notifications(
    services: ServicesDependency,
    principal: UserDependency,
    session: SessionDependency,
) -> list[NotificationView]:
    return services.engagement.list_notifications(session, principal.subject)


@router.post(
    "/api/v2/notifications/{notification_id}/read",
    response_model=NotificationView,
)
def mark_notification_read(
    services: ServicesDependency,
    notification_id: str,
    principal: UserDependency,
    session: SessionDependency,
) -> NotificationView:
    result = services.engagement.mark_notification_read(session, principal.subject, notification_id)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found.",
        )
    return result


@router.post("/api/v2/notification-preferences", response_model=UserView)
def update_notification_preferences(
    services: ServicesDependency,
    payload: DigestPreference,
    principal: UserDependency,
    session: SessionDependency,
) -> UserView:
    user = session.get(UserRecord, principal.subject)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    user.daily_digest_enabled = payload.enabled
    user.digest_hour = payload.hour
    session.commit()
    return services.auth.to_user_view(user)
