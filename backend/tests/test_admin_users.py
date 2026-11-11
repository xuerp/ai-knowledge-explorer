import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url

from app.config import Settings
from app.database import AuditLogRecord, FollowRecord, UserRecord
from app.main import create_app

SECRET = "isolated-admin-user-tests-secret-at-least-32-characters"
PASSWORD = "original isolated account password"
NEW_PASSWORD = "replacement isolated account password"


@pytest.fixture
def client(tmp_path, request):
    database_url = f"sqlite:///{(tmp_path / 'accounts.db').as_posix()}"
    postgres = None
    schema = None
    if getattr(request, "param", "sqlite") == "postgres":
        url = os.getenv("AI_RADAR_USER_TEST_DATABASE_URL")
        if not url:
            pytest.skip("Dedicated PostgreSQL account test database is not configured.")
        schema = "qa_accounts_" + uuid4().hex
        postgres = create_engine(url)
        with postgres.begin() as connection:
            connection.execute(text(f"CREATE SCHEMA {schema}"))
        database_url = (
            make_url(url)
            .update_query_dict({"options": f"-csearch_path={schema}"})
            .render_as_string(hide_password=False)
        )
    settings = Settings(
        database_url=database_url,
        seed_snapshot_path=Path(__file__).parents[1] / "data/demo_snapshot.json",
        environment="test",
        admin_token="isolated-admin-token",
        jwt_secret=SECRET,
        cors_origins=("http://localhost:4184",),
    )
    try:
        application = create_app(settings)
        if postgres is not None:
            application.state.database.create_all()
        with TestClient(application) as instance:
            yield instance
    finally:
        if postgres is not None:
            with postgres.begin() as connection:
                connection.execute(text(f"DROP SCHEMA {schema} CASCADE"))
            postgres.dispose()


def login(client, email, password=PASSWORD, remembered=False):
    result = client.post(
        "/api/v2/auth/login",
        json={
            "email": email,
            "password": password,
            "rememberMe": remembered,
        },
    )
    assert result.status_code == 200, result.text
    return {"Authorization": "Bearer " + result.json()["accessToken"]}


def admin(client):
    result = client.post(
        "/api/v2/auth/bootstrap",
        headers={"X-Admin-Token": "isolated-admin-token"},
        json={"email": "owner@example.com", "password": PASSWORD},
    )
    assert result.status_code == 200, result.text
    return login(client, "owner@example.com")


def create(client, headers, email="person@example.com", role="viewer"):
    result = client.post(
        "/api/v2/admin/users",
        headers=headers,
        json={"email": email, "password": PASSWORD, "role": role},
    )
    assert result.status_code == 201, result.text
    return result.json()


def row(client, headers, email):
    result = client.get("/api/v2/admin/users", headers=headers, params={"q": email})
    assert result.status_code == 200, result.text
    return next(item for item in result.json()["items"] if item["email"] == email)


def change(client, headers, user, **updates):
    return client.patch(
        "/api/v2/admin/users/" + user["id"],
        headers=headers,
        json={"expectedVersion": user["version"], **updates},
    )


@pytest.mark.parametrize("role", [None, "viewer", "reviewer"])
def test_every_user_management_operation_requires_admin(client, role):
    owner = admin(client)
    target = create(client, owner)
    headers = {}
    if role:
        create(client, owner, f"{role}@example.com", role)
        headers = login(client, f"{role}@example.com")
    operations = [
        ("get", "/api/v2/admin/users", None),
        ("post", "/api/v2/admin/users", {"email": "bad@example.com", "password": PASSWORD}),
        ("patch", "/api/v2/admin/users/" + target["id"], {"expectedVersion": 0, "role": "admin"}),
        (
            "post",
            "/api/v2/admin/users/" + target["id"] + "/reset-password",
            {"expectedVersion": 0, "password": NEW_PASSWORD},
        ),
    ]
    for method, path, body in operations:
        response = client.request(method, path, headers=headers, **({"json": body} if body else {}))
        assert response.status_code == (403 if role else 401), response.text


def test_search_filters_pagination_and_safe_responses(client):
    owner = admin(client)
    create(client, owner, "alice@example.com")
    create(client, owner, "bob@example.com", "reviewer")
    create(client, owner, "literal_under@example.com")
    alice = row(client, owner, "alice@example.com")
    assert change(client, owner, alice, active=False).status_code == 200
    all_users = client.get("/api/v2/admin/users", headers=owner, params={"limit": 2}).json()
    next_users = client.get(
        "/api/v2/admin/users", headers=owner, params={"limit": 2, "offset": 2}
    ).json()
    assert all_users["total"] == 4
    assert {item["id"] for item in all_users["items"]}.isdisjoint(
        {item["id"] for item in next_users["items"]}
    )
    for params, expected in [
        ({"q": "ALICE"}, ["alice@example.com"]),
        ({"role": "reviewer"}, ["bob@example.com"]),
        ({"status": "disabled"}, ["alice@example.com"]),
        ({"q": "_"}, ["literal_under@example.com"]),
        ({"q": "%"}, []),
    ]:
        response = client.get("/api/v2/admin/users", headers=owner, params=params)
        assert response.headers["cache-control"] == "no-store"
        assert [item["email"] for item in response.json()["items"]] == expected
        assert "password" not in response.text.lower()
    for params in [{"limit": 101}, {"offset": -1}, {"role": "root"}, {"status": "unknown"}]:
        assert client.get("/api/v2/admin/users", headers=owner, params=params).status_code == 422


def test_create_validation_duplicate_email_and_audit(client):
    owner = admin(client)
    create(client, owner, "Mixed@example.com")
    response = client.post(
        "/api/v2/admin/users",
        headers=owner,
        json={"email": "mixed@example.com", "password": PASSWORD},
    )
    assert response.status_code == 409
    for update in [{"password": "short"}, {"role": "root"}, {"email": "bad-email"}]:
        response = client.post(
            "/api/v2/admin/users",
            headers=owner,
            json={"email": "valid@example.com", "password": PASSWORD, **update},
        )
        assert response.status_code == 422
        assert update.get("password", "not-a-password") not in response.text
    with client.app.state.database.session() as session:
        logs = session.scalars(
            select(AuditLogRecord).where(AuditLogRecord.action == "user.create")
        ).all()
        assert len(logs) == 1
        assert PASSWORD not in logs[0].detail_json


def test_all_new_account_entry_points_accept_six_character_passwords(client):
    new_password = "Q7d9!s"
    cases = [
        ("/api/v2/auth/bootstrap", "six-admin@example.com", 200),
        ("/api/v2/auth/register", "six-self@example.com", 201),
        ("/api/v2/admin/users", "six-managed@example.com", 201),
    ]
    admin_headers = {"X-Admin-Token": "isolated-admin-token"}
    for path, email, expected_status in cases:
        headers = admin_headers if path != "/api/v2/auth/register" else {}
        short = client.post(
            path, headers=headers, json={"email": email, "password": new_password[:-1]}
        )
        assert short.status_code == 422
        accepted = client.post(
            path, headers=headers, json={"email": email, "password": new_password}
        )
        assert accepted.status_code == expected_status, accepted.text
        assert (
            client.get("/api/v2/auth/me", headers=login(client, email, new_password)).status_code
            == 200
        )


@pytest.mark.parametrize("remembered", [False, True])
def test_disable_restore_invalidates_sessions_and_preserves_user_data(client, remembered):
    owner = admin(client)
    create(client, owner)
    before = login(client, "person@example.com", remembered=remembered)
    user = row(client, owner, "person@example.com")
    with client.app.state.database.session() as session:
        session.add(
            FollowRecord(
                id="kept-follow",
                user_id=user["id"],
                entity_id="e-openai",
                intensity="digest",
                created_at=datetime.now(UTC),
            )
        )
        session.commit()
    disabled = change(client, owner, user, active=False)
    assert disabled.status_code == 200
    assert client.get("/api/v2/auth/me", headers=before).status_code == 401
    assert (
        client.post(
            "/api/v2/auth/login", json={"email": user["email"], "password": PASSWORD}
        ).status_code
        == 401
    )
    restored = change(client, owner, disabled.json(), active=True)
    assert restored.status_code == 200
    assert client.get("/api/v2/auth/me", headers=before).status_code == 401
    assert client.get("/api/v2/auth/me", headers=login(client, user["email"])).status_code == 200
    with client.app.state.database.session() as session:
        assert session.get(FollowRecord, "kept-follow").user_id == user["id"]


@pytest.mark.parametrize("remembered", [False, True])
def test_reset_password_revokes_all_sessions_without_reactivating_account(client, remembered):
    owner = admin(client)
    create(client, owner)
    before = login(client, "person@example.com", remembered=remembered)
    user = row(client, owner, "person@example.com")
    reset = client.post(
        f"/api/v2/admin/users/{user['id']}/reset-password",
        headers=owner,
        json={"expectedVersion": user["version"], "password": NEW_PASSWORD},
    )
    assert reset.status_code == 200
    assert client.get("/api/v2/auth/me", headers=before).status_code == 401
    assert (
        client.post(
            "/api/v2/auth/login", json={"email": user["email"], "password": PASSWORD}
        ).status_code
        == 401
    )
    assert (
        client.get(
            "/api/v2/auth/me", headers=login(client, user["email"], NEW_PASSWORD)
        ).status_code
        == 200
    )
    disabled = change(client, owner, reset.json(), active=False).json()
    reset_again = client.post(
        f"/api/v2/admin/users/{user['id']}/reset-password",
        headers=owner,
        json={"expectedVersion": disabled["version"], "password": PASSWORD},
    )
    assert reset_again.status_code == 200
    assert reset_again.json()["active"] is False
    with client.app.state.database.session() as session:
        logs = session.scalars(
            select(AuditLogRecord).where(AuditLogRecord.action == "user.password-reset")
        ).all()
        assert len(logs) == 2
        assert all(json.loads(log.detail_json) == {"sessionsRevoked": True} for log in logs)


def test_role_email_changes_and_legacy_jwts(client):
    owner = admin(client)
    create(client, owner)
    signed = login(client, "person@example.com")
    payload = jwt.decode(
        signed["Authorization"][7:], SECRET, algorithms=["HS256"], audience="ai-radar-web"
    )
    payload.pop("ver")
    legacy = {"Authorization": "Bearer " + jwt.encode(payload, SECRET, algorithm="HS256")}
    assert client.get("/api/v2/auth/me", headers=legacy).status_code == 200
    user = row(client, owner, "person@example.com")
    changed = change(client, owner, user, email="renamed@example.com", role="reviewer")
    assert changed.status_code == 200
    assert client.get("/api/v2/auth/me", headers=legacy).status_code == 401
    current = login(client, "renamed@example.com")
    assert client.get("/api/v2/auth/me", headers=current).json()["role"] == "reviewer"
    assert client.get("/api/v2/admin/users", headers=current).status_code == 403
    assert change(client, owner, user, active=False).status_code == 409


def test_self_last_admin_missing_target_and_duplicate_edit(client):
    owner = admin(client)
    own = row(client, owner, "owner@example.com")
    assert change(client, owner, own, active=False).status_code == 409
    assert change(client, owner, own, role="viewer").status_code == 409
    legacy_admin = {"X-Admin-Token": "isolated-admin-token"}
    assert change(client, legacy_admin, own, active=False).status_code == 409
    assert (
        client.patch(
            "/api/v2/admin/users/missing",
            headers=owner,
            json={"expectedVersion": 0, "active": False},
        ).status_code
        == 404
    )
    create(client, owner)
    target = row(client, owner, "person@example.com")
    assert change(client, owner, target, email="owner@example.com").status_code == 409
    assert row(client, owner, target["email"])["version"] == 0
    assert (
        client.patch(
            f"/api/v2/admin/users/{target['id']}",
            headers=owner,
            json={"expectedVersion": 0, "password": "unsupported"},
        ).status_code
        == 422
    )


@pytest.mark.parametrize("client", ["sqlite", "postgres"], indirect=True)
def test_concurrent_mutual_disable_keeps_an_active_admin(client):
    owner = admin(client)
    create(client, owner, "second@example.com", "admin")
    second = login(client, "second@example.com")
    first_row = row(client, owner, "owner@example.com")
    second_row = row(client, owner, "second@example.com")
    with ThreadPoolExecutor(max_workers=2) as executor:
        a = executor.submit(change, client, owner, second_row, active=False)
        b = executor.submit(change, client, second, first_row, active=False)
        statuses = sorted([a.result().status_code, b.result().status_code])
    assert statuses == [200, 401]
    with client.app.state.database.session() as session:
        users = session.scalars(select(UserRecord)).all()
        assert sum(user.active and user.role == "admin" for user in users) == 1
