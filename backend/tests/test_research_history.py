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
