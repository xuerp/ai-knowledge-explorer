"""Remembering is explicit, bounded, revocable and independent of passwords."""

from contextlib import contextmanager
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth import Principal
from app.config import Settings
from app.database import RememberedSessionRecord, UserRecord
from app.main import create_app
from app.security import _current_account_principal


@pytest.fixture
def client(tmp_path):
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'auth.db').as_posix()}",
        seed_snapshot_path=Path(__file__).parents[1] / "data/demo_snapshot.json",
        admin_token=None,
        cors_origins=("http://localhost:3000",),
        environment="test",
        jwt_secret="isolated-remember-login-regression-secret-over-32-chars",
    )
    with TestClient(create_app(settings)) as client:
        yield client


def sign_in(client, remember=False):
    credentials = {
        "email": "remember-fixture@example.com",
        "password": "fixture password, not an account secret",
    }
    registration = client.post("/api/v2/auth/register", json=credentials)
    assert registration.status_code in {201, 409}
    response = client.post("/api/v2/auth/login", json={**credentials, "rememberMe": remember})
    assert response.status_code == 200
    return response.json()


def test_default_login_does_not_extend_or_create_persistent_sessions(client):
    result = sign_in(client)
    assert result["expiresIn"] == 30 * 60
    with client.app.state.database.session() as session:
        assert session.scalars(select(RememberedSessionRecord)).all() == []


def test_remembered_login_survives_requests_and_logout_revokes_only_that_device(client):
    first = sign_in(client, True)
    other = sign_in(client, True)
    assert first["expiresIn"] == 7 * 86400
    assert "password" not in first
    headers = {"Authorization": "Bearer " + first["accessToken"]}
    assert client.get("/api/v2/auth/me", headers=headers).status_code == 200
    assert client.post("/api/v2/auth/logout", headers=headers).status_code == 204
    assert client.get("/api/v2/auth/me", headers=headers).status_code == 401
    assert (
        client.get(
            "/api/v2/auth/me", headers={"Authorization": "Bearer " + other["accessToken"]}
        ).status_code
        == 200
    )


@pytest.mark.parametrize("state", ["revoked", "expired", "disabled", "role-changed", "missing"])
def test_remembered_token_checks_current_account_and_server_session(client, state):
    result = sign_in(client, True)
    with client.app.state.database.session() as session:
        remembered = session.scalars(select(RememberedSessionRecord)).one()
        user = session.get(UserRecord, remembered.user_id)
        if state == "revoked":
            remembered.revoked_at = datetime.now(UTC)
        elif state == "expired":
            remembered.expires_at = datetime.now(UTC) - timedelta(minutes=1)
        elif state == "disabled":
            user.active = False
        elif state == "role-changed":
            user.role = "admin"
        else:
            session.delete(remembered)
        session.commit()
    assert (
        client.get(
            "/api/v2/auth/me", headers={"Authorization": "Bearer " + result["accessToken"]}
        ).status_code
        == 401
    )


def test_remember_checkbox_does_not_extend_privileged_access(client):
    result = sign_in(client)
    with client.app.state.database.session() as session:
        session.get(UserRecord, result["user"]["id"]).role = "admin"
        session.commit()
    assert sign_in(client, True)["expiresIn"] == 30 * 60


@pytest.mark.parametrize("offset", [-10, 10])
def test_database_session_timezone_preserves_the_actual_expiry_instant(offset):
    user = SimpleNamespace(
        id="fixture-user", email="timezone@example.com", role="viewer", active=True
    )
    remembered = SimpleNamespace(
        user_id=user.id,
        revoked_at=None,
        expires_at=(datetime.now(UTC) + timedelta(minutes=10)).astimezone(
            timezone(timedelta(hours=offset))
        ),
    )

    @contextmanager
    def session():
        yield SimpleNamespace(get=lambda model, key: user if model is UserRecord else remembered)

    request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(database=SimpleNamespace(session=session)))
    )
    principal = Principal(
        subject=user.id, email=user.email, role=user.role, session_id="fixture-session"
    )
    assert _current_account_principal(request, principal) is not None
