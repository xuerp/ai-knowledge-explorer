"""Product contract regressions; authored engineering cases, not human user research."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def api(tmp_path):
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'guidance.db').as_posix()}",
        seed_snapshot_path=Path(__file__).resolve().parents[1] / "data/demo_snapshot.json",
        cors_origins=("http://localhost:3000",),
        environment="test",
        jwt_secret="guidance-isolated-test-secret-at-least-32",
        admin_token="guidance-test-admin",
        rag_generation_enabled=False,
        embedding_provider="none",
        auto_extraction_max_snapshots_per_cycle=0,
    )
    with TestClient(create_app(settings)) as client:
        auth = []
        for owner in ("owner", "other"):
            response = client.post(
                "/api/v2/auth/register",
                json={
                    "email": owner + "@example.com",
                    "password": "isolated guidance test password",
                },
            )
            assert response.status_code == 201
            auth.append({"Authorization": "Bearer " + response.json()["accessToken"]})
        yield client, *auth


def create(api, task, **conditions):
    client, owner, _ = api
    response = client.post(
        "/api/v2/research",
        headers=owner,
        json={
            "question": task,
            "language": "zh",
            "decisionContext": {
                "workflowVersion": 2,
                "task": task,
                "priority": "balanced",
                "deployment": "undecided",
                **conditions,
            },
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def answer(api, result, option, **extra):
    client, owner, _ = api
    payload = {
        "question": result["question"],
        "language": "zh",
        "parentResearchId": result["id"],
        "clarificationAnswer": {
            "questionId": result["decision"]["guidance"]["clarification"]["id"],
            "optionId": option,
        },
        **extra,
    }
    return client.post("/api/v2/research", headers=owner, json=payload)


def test_office_clarification_saved_revision_preserves_original_and_constraints(api):
    original = create(
        api, "想用 AI 提高办公效率", deployment="private", exclusions=["不能上传个人资料"]
    )
    assert original["decision"]["guidance"]["outcome"] == "clarify"
    response = answer(api, original, "knowledge-workspace")
    assert response.status_code == 200, response.text
    revised = response.json()
    assert revised["decisionContext"]["task"] == original["decisionContext"]["task"]
    assert revised["decisionContext"]["deployment"] == "private"
    assert revised["decisionContext"]["exclusions"] == ["不能上传个人资料"]
    assert revised["decisionContext"]["parentResearchId"] == original["id"]
    assert revised["decision"]["scenario"]["id"] == "knowledge-workspace"
    assert revised["decision"]["guidance"]["clarification"] is None
    assert answer(api, original, "knowledge-workspace").json()["id"] == revised["id"]
    client, owner, other = api
    assert (
        client.get("/api/v2/research/" + revised["id"], headers=owner).json()["decision"]
        == revised["decision"]
    )
    assert (
        client.get("/api/v2/research/" + original["id"], headers=owner).json()["decision"][
            "guidance"
        ]["outcome"]
        == "clarify"
    )
    assert client.get("/api/v2/research/" + revised["id"], headers=other).status_code == 404
    assert (
        client.post(
            "/api/v2/research",
            headers=other,
            json={
                "question": "unrelated request",
                "parentResearchId": original["id"],
                "clarificationAnswer": {"questionId": "work-direction", "optionId": "general-text"},
            },
        ).status_code
        == 404
    )
    assert answer(api, original, "forged-option").status_code == 422


def test_career_route_and_unknown_do_not_repeat_question(api):
    original = create(api, "做一个求职助手")
    assert original["decision"]["guidance"]["clarification"]["id"] == "career-route"
    personal = answer(api, original, "use-career").json()
    assert personal["decision"]["guidance"]["clarification"] is None
    assert "脱敏简历" in personal["decision"]["guidance"]["recommendation"]["summary"]
    unknown = answer(api, original, "unknown").json()
    assert unknown["decision"]["guidance"]["outcome"] == "conditional"
    assert unknown["decision"]["guidance"]["clarification"] is None
    assert unknown["decision"]["guidance"]["recommendation"]["primaryEntityId"] is None


def test_clear_task_direct_advice_and_multi_task_preservation(api):
    clear = create(api, "我想让同事查询公司的 PDF 文档，回答能找到出处")
    assert clear["decision"]["guidance"]["clarification"] is None
    multi = create(api, "我想做文档问答；同时写文章")
    assert multi["decision"]["guidance"]["clarification"]["id"] == "task-focus"
    assert len(multi["decision"]["guidance"]["tasks"]) == 2


def test_raw_strict_requirements_are_enforced_by_server(api):
    result = create(api, "合同摘要必须完全离线，上下文至少200万 token，允许商用")
    context = result["decisionContext"]
    assert context["deployment"] == "on-device"
    assert context["minimumContextTokens"] == 2000000
    assert context["commercialUseRequired"] is True
    assert not result["decision"]["guidance"]["recommendation"]["primaryEntityId"]


def test_client_cannot_forge_answer_history(api):
    client, owner, _ = api
    response = client.post(
        "/api/v2/research",
        headers=owner,
        json={
            "question": "想提高办公效率",
            "decisionContext": {
                "task": "想提高办公效率",
                "workflowVersion": 2,
                "priority": "balanced",
                "deployment": "undecided",
                "intentAnswers": [{"questionId": "work-direction", "optionId": "general-text"}],
            },
        },
    )
    assert response.status_code == 422


def test_free_answer_matches_personal_route_and_keeps_user_words(api):
    original = create(api, "做一个求职助手")
    response = answer(
        api,
        original,
        None,
        clarificationAnswer={"questionId": "career-route", "text": "我自己用，先准备简历"},
    )
    assert response.status_code == 200
    result = response.json()
    assert result["decisionContext"]["intentAnswers"][0]["text"] == "我自己用，先准备简历"
    assert "脱敏简历" in result["decision"]["guidance"]["recommendation"]["summary"]


def test_frozen_new_phrasings(api):
    import json

    cases = json.loads(
        (Path(__file__).resolve().parents[1] / "data/decision_guidance_holdout.v1.json").read_text(
            "utf-8"
        )
    )["cases"]
    for case in cases:
        result = create(api, case["task"])
        guidance = result["decision"]["guidance"]
        if case["expected"] in {"clarify", "unsupported"}:
            assert guidance["outcome"] == case["expected"], case["id"]
        elif case["expected"] == "direct":
            assert guidance["clarification"] is None, case["id"]
            assert guidance["outcome"] in {"advice", "conditional"}, case["id"]
        else:
            assert guidance["recommendation"]["primaryEntityId"] is None, case["id"]
        assert guidance["recommendation"]["summary"] and guidance["nextAction"]["instruction"]


def test_unknown_budget_answer_stops_questions_and_keeps_requirements(api):
    original = create(api, "想提高办公效率，每月不超过100元")
    revised = answer(api, original, "unknown").json()
    assert revised["decision"]["guidance"]["clarification"] is None
    assert revised["decisionContext"]["budget"]["max"] == 100


def test_functional_route_keeps_cited_features_without_claiming_budget_fit(api):
    original = create(api, "为编程选择模型 API，每月不超过100元")
    revised = answer(api, original, "functional-route").json()
    guidance = revised["decision"]["guidance"]
    assert guidance["clarification"] is None
    assert guidance["recommendation"]["primaryEntityId"] is None
    assert guidance["recommendation"]["reasons"]
    assert all(reason["claimIds"] for reason in guidance["recommendation"]["reasons"])
    assert "尚不能证明候选满足预算" in guidance["recommendation"]["summary"]
    assert revised["decisionContext"]["budget"]["max"] == 100


def test_unrecognized_subtask_is_retained(api):
    result = create(api, "我想做文档问答；同时整理办公室设备的维护排班")
    assert "整理办公室设备的维护排班" in result["decision"]["guidance"]["tasks"]


def test_structured_choice_cannot_silently_weaken_raw_offline_requirement(api):
    client, owner, _ = api
    response = client.post(
        "/api/v2/research",
        headers=owner,
        json={
            "question": "合同摘要必须完全离线",
            "decisionContext": {
                "workflowVersion": 2,
                "task": "合同摘要必须完全离线",
                "priority": "privacy",
                "deployment": "cloud-api",
            },
        },
    )
    assert response.status_code == 422
    assert "离线" in response.json()["detail"]
