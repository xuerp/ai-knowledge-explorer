"""Different ordered deliverables survive method selection and persisted output."""

import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.decision_guidance import build_guidance
from app.decision_plan import build_plan
from app.decision_resolution import reconcile_resolution
from app.decision_semantics import SourceItem, TaskMeaning, TaskMeaningReceipt, task_digest
from app.decision_stages import ordered_task_stages
from app.main import create_app
from app.schemas import DecisionContext

from .test_decision_plan import candidate, result


def context(task, *, role="goal", state="understood", method="classification"):
    return DecisionContext(
        task=task,
        workflow_version=2,
        priority="balanced",
        deployment="undecided",
        task_meaning=TaskMeaningReceipt(
            status="validated",
            meaning=TaskMeaning(
                version=1,
                source_sha256=task_digest(task),
                state=state,
                scenario="general-text",
                method=method,
                ambiguity="Choose the output" if state == "ambiguous" else None,
                items=[SourceItem(quote=task, role=role)],
            ),
        ),
    )


SEQUENCES = [
    ("我想先把七段评论分成三组，再按分组写出有原文编号的总结。", 2),
    ("先把德文通知翻成中文，然后从译文提取日期，最后生成待办清单。", 3),
    ("首先核对两份合成说明的差异；随后将差异整理成审阅表。", 2),
    ("First read fixture.csv, then normalize 1.25 kg values, finally write a checked summary.", 3),
    ("First translate the supplied excerpt. Then produce a glossary with source locations.", 2),
]


@pytest.mark.parametrize("task,count", SEQUENCES)
@pytest.mark.parametrize("language", ["zh", "en"])
def test_explicit_stages_are_separate_executable_and_not_a_product_qualification(
    task, count, language
):
    ctx = context(task)
    stages = ordered_task_stages(ctx)
    assert len(stages) == count
    assert all(stage in task for stage in stages)
    assert stages[0].find("fixture.csv") >= 0 if "fixture.csv" in task else True
    if "1.25" in task:
        assert any("1.25 kg" in stage for stage in stages)
    value = result(candidate("alpha"), candidate("beta"), status="ready")
    snapshot = SimpleNamespace(
        entities=[
            SimpleNamespace(id=key, name=SimpleNamespace(zh=key, en=key), aliases=[])
            for key in ["alpha", "beta"]
        ]
    )
    value.plan = build_plan(value, ctx, language)
    value.guidance = build_guidance(value, ctx, snapshot, language)
    reconcile_resolution(value, ctx, language)
    assert value.guidance.outcome == "conditional"
    assert value.guidance.recommendation.primary_entity_id is None
    assert value.guidance.recommendation.entity_ids == []
    assert value.plan.trial_candidate_ids == []
    assert value.guidance.next_action.kind == "start"
    assert value.guidance.next_action.instruction == " ".join(value.plan.trial.procedure)
    for index, quote in enumerate(stages, 1):
        assert f"{index}. {quote}" in value.guidance.recommendation.summary
        assert any(quote in step for step in value.plan.trial.procedure)
        assert quote in value.guidance.next_action.execution_prompt
    assert len(value.plan.trial.acceptance) >= 2
    assert value.plan.trial.executed is False


@pytest.mark.parametrize(
    "task,role,state",
    [
        ("不要先修改文件，然后执行发布。", "goal", "understood"),
        ("Never first upload records, then send emails.", "goal", "understood"),
        ("先翻译，然后分类。", "prohibition", "understood"),
        ("先翻译，然后分类。", "unavailable-material", "understood"),
        ("先翻译，然后分类。", "condition", "understood"),
        ("先翻译，然后分类。", "goal", "ambiguous"),
        ("翻译和分类都需要，先后没决定。", "goal", "understood"),
        ("优先保留原文，再人工审阅。", "goal", "understood"),
        ("把通知翻成英文，再由我决定是否发布。", "goal", "understood"),
    ],
)
def test_do_not_invent_order_from_negation_materials_or_unresolved_goals(task, role, state):
    assert ordered_task_stages(context(task, role=role, state=state)) == ()


def test_stage_plan_cannot_override_exclusions_or_unsupported_work():
    ctx = context("先整理素材，再生成视频。")
    value = result(candidate("alpha"))
    snapshot = SimpleNamespace(entities=[])
    value.plan = build_plan(value, ctx, "zh")
    value.guidance = build_guidance(value, ctx, snapshot, "zh")
    reconcile_resolution(value, ctx)
    assert value.guidance.outcome == "unsupported"
    assert value.plan.trial is None
    ctx = context("先翻译通知，再整理词表。")
    value = result(candidate("alpha", eligibility="excluded"))
    value.plan = build_plan(value, ctx, "zh")
    value.guidance = build_guidance(value, ctx, snapshot, "zh")
    reconcile_resolution(value, ctx)
    assert value.guidance.outcome == "blocked"
    assert value.plan.trial is None


def test_concise_separate_goal_and_output_excerpts_keep_the_source_order():
    task = "先把合成通知译成英文，再根据译文建立带编号的术语表。"
    ctx = context(task, method="translation")
    ctx.task_meaning.meaning.items = [
        SourceItem(role="goal", quote="把合成通知译成英文"),
        SourceItem(role="output", quote="根据译文建立带编号的术语表"),
    ]
    assert ordered_task_stages(ctx) == ("先把合成通知译成英文", "再根据译文建立带编号的术语表")


def test_repository_phases_keep_the_dedicated_coding_protocol():
    ctx = context("先复现问题，再做最小修改并运行已有测试。", method=None)
    ctx.task_meaning.meaning.scenario = "coding-workspace"
    assert ordered_task_stages(ctx) == ()


@pytest.mark.parametrize("language", ["zh", "en"])
def test_actual_api_saves_reopens_and_exports_every_stage(tmp_path, language):
    task = "先把十五条合成质检备注分到四组，再基于分组整理有编号依据的交接说明。仅用合成备注，不发给外部人员，无法证明的原因写未知。"

    class Interpreter:
        calls = 0

        def interpret(self, request):
            self.calls += 1
            return json.dumps(
                {
                    "version": 2,
                    "source_sha256": request["source_sha256"],
                    "state": "understood",
                    "route": "classification",
                    "items": [{"role": "goal", "quote": task.split("。")[0]}],
                    "ambiguity": None,
                },
                ensure_ascii=False,
            )

    interpreter = Interpreter()
    settings = Settings(
        database_url="sqlite:///" + (tmp_path / "stage-api.db").as_posix(),
        seed_snapshot_path=Path(__file__).parents[1] / "data/demo_snapshot.json",
        environment="test",
        admin_token=None,
        cors_origins=(),
        jwt_secret="local-staged-api-secret-at-least-32-chars",
        rag_generation_enabled=False,
        embedding_provider="none",
    )
    with TestClient(create_app(settings, task_interpreter=interpreter)) as client:
        auth = client.post(
            "/api/v2/auth/register",
            json={"email": "stages@example.com", "password": "isolated-stages-test-password"},
        )
        assert auth.status_code == 201
        headers = {"Authorization": "Bearer " + auth.json()["accessToken"]}
        response = client.post(
            "/api/v2/research",
            headers=headers,
            json={
                "question": task,
                "language": language,
                "decisionContext": {
                    "workflowVersion": 2,
                    "task": task,
                    "priority": "balanced",
                    "deployment": "undecided",
                },
            },
        )
        assert response.status_code == 200, response.text
        value = response.json()
        assert value["decisionContext"]["taskMeaning"]["status"] == "validated"
        guidance = value["decision"]["guidance"]
        assert "交接说明" in guidance["recommendation"]["summary"]
        assert "分到四组" in guidance["recommendation"]["summary"]
        assert guidance["outcome"] == "conditional"
        assert len(value["decision"]["plan"]["trial"]["procedure"]) > 2
        prompt = guidance["nextAction"]["executionPrompt"]
        assert task in prompt and "不发给外部人员" in prompt
        saved = client.get("/api/v2/research/" + value["id"], headers=headers)
        assert saved.status_code == 200 and saved.json()["decision"]["guidance"] == guidance
        report = client.get(
            "/api/v2/research/" + value["id"] + "/report?format=md&language=" + language,
            headers=headers,
        )
        assert report.status_code == 200
        assert re.sub(r"\s+", " ", prompt) in re.sub(r"\s+", " ", report.text)
    assert interpreter.calls == 1
