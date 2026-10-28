"""Real isolated endpoints: logout revokes one token across protected resources."""

from datetime import UTC, datetime, timedelta

import jwt
import pytest

from .test_remembered_login import client, sign_in  # noqa: F401


@pytest.mark.parametrize("remember", [False, True])
def test_logout_revokes_current_token_only(client, remember):  # noqa: F811
    first = sign_in(client, remember)
    second = sign_in(client, remember)
    assert first["accessToken"] != second["accessToken"]
    headers = {"Authorization": "Bearer " + first["accessToken"]}
    assert client.get("/api/v2/auth/me", headers=headers).status_code == 200
    assert client.post("/api/v2/auth/logout", headers=headers).status_code == 204
    for path in (
        "/api/v2/auth/me",
        "/api/v2/research/missing",
        "/api/v2/following",
        "/api/v2/notifications",
    ):
        assert client.get(path, headers=headers).status_code == 401
    assert (
        client.get(
            "/api/v2/auth/me", headers={"Authorization": "Bearer " + second["accessToken"]}
        ).status_code
        == 200
    )
    assert client.post("/api/v2/auth/logout", headers=headers).status_code == 401


def test_pre_jti_short_token_can_be_revoked(client):  # noqa: F811
    current = sign_in(client)
    user = current["user"]
    now = datetime.now(UTC)
    token = jwt.encode(
        {
            "sub": user["id"],
            "email": user["email"],
            "role": user["role"],
            "iss": "ai-radar",
            "aud": "ai-radar-web",
            "iat": now,
            "exp": now + timedelta(minutes=15),
        },
        client.app.state.settings.jwt_secret,
        algorithm="HS256",
    )
    headers = {"Authorization": "Bearer " + token}
    assert client.get("/api/v2/auth/me", headers=headers).status_code == 200
    assert client.post("/api/v2/auth/logout", headers=headers).status_code == 204
    assert client.get("/api/v2/auth/me", headers=headers).status_code == 401
