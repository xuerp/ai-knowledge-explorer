"""Owner-scoped research history: newest first, never another user's records."""

from tests.test_decision_guidance import api, create  # noqa: F401


def test_history_lists_only_the_owners_records_newest_first(api):  # noqa: F811
    client, owner, other = api
    first = create(api, "我想让同事查询公司的 PDF 文档，回答能找到出处")
    second = create(api, "为编程选择模型 API，每月不超过100元")
    response = client.get("/api/v2/research", headers=owner)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    rows = response.json()
    assert [row["id"] for row in rows[:2]] == [second["id"], first["id"]]
    assert rows[0]["question"] == "为编程选择模型 API，每月不超过100元"
    assert rows[0]["headline"] and rows[0]["status"] in {"ready", "insufficient-evidence"}
    assert "citations" not in rows[0] and "decision" not in rows[0]
    assert client.get("/api/v2/research", headers=other).json() == []


def test_history_requires_sign_in_and_bounds_the_limit(api):  # noqa: F811
    client, owner, _ = api
    create(api, "我想让同事查询公司的 PDF 文档，回答能找到出处")
    assert client.get("/api/v2/research").status_code == 401
    assert len(client.get("/api/v2/research", params={"limit": 1}, headers=owner).json()) == 1
    assert client.get("/api/v2/research", params={"limit": 0}, headers=owner).status_code == 422


def test_owner_can_delete_a_record_and_its_share_stops_working(api):  # noqa: F811
    client, owner, other = api
    kept = create(api, "我想让同事查询公司的 PDF 文档，回答能找到出处")
    removed = create(api, "为编程选择模型 API，每月不超过100元")
    slug = client.post(f"/api/v2/research/{removed['id']}/publish", headers=owner).json()[
        "publishedSlug"
    ]
    assert client.get(f"/api/v2/share/{slug}/markdown").status_code == 200

    # Another account can neither see nor delete it.
    assert client.delete(f"/api/v2/research/{removed['id']}", headers=other).status_code == 404
    assert client.delete(f"/api/v2/research/{removed['id']}").status_code == 401

    assert client.delete(f"/api/v2/research/{removed['id']}", headers=owner).status_code == 204
    assert client.get(f"/api/v2/research/{removed['id']}", headers=owner).status_code == 404
    assert client.get(f"/api/v2/share/{slug}/markdown").status_code == 404
    ids = [row["id"] for row in client.get("/api/v2/research", headers=owner).json()]
    assert removed["id"] not in ids and kept["id"] in ids
    assert client.delete(f"/api/v2/research/{removed['id']}", headers=owner).status_code == 404
