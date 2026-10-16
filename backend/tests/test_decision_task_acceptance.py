"""Frozen six-task evidence/logic regression; never a business benchmark."""

import importlib.util
import json
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app import decision_constraints
from app.decision_candidates import discover_candidates, interpret_scenario
from app.decision_constraints import constraint_failures, current_claims
from app.decision_explanation import cost_choice
from app.decision_facts import normalized_facts
from app.repository import KnowledgeRepository
from app.schemas import DecisionContext

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "task_audit", ROOT / "scripts/audit_decision_tasks.py"
)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


@pytest.fixture
def catalog(monkeypatch):
    class FrozenClock(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2026, 10, 16, 3, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant.replace(tzinfo=None)

    # Publication regression at a declared date. The actual audit uses the real
    # clock and will surface source expiry rather than claiming evergreen data.
    monkeypatch.setattr(decision_constraints, "datetime", FrozenClock)
    return KnowledgeRepository(ROOT / "backend/data/demo_snapshot.json").load_seed()


def google_scope(catalog, task):
    context = DecisionContext(
        workflow_version=2,
        task=task,
        task_type="model-api",
        priority="quality",
        deployment="undecided",
    )
    by_entity = defaultdict(list)
    for claim in current_claims(catalog.claims, catalog):
        by_entity[claim.entity_id].append(claim)
    return discover_candidates(context, catalog, by_entity, "zh")[0]


def test_vendor_scope_uses_children_without_turning_company_into_a_candidate(catalog):
    ids = google_scope(catalog, "通过 Google 原厂 API 批量提取工单字段")
    assert {"e-gemini-3-1-pro", "e-gemini-3-8-flash"} <= set(ids)
    assert "e-google" not in ids
    assert not {"e-gpt-61-sol", "e-gemini-31-flash-tts"}.intersection(ids)


def test_specific_version_remains_narrower_than_its_provider(catalog):
    assert google_scope(catalog, "用 Google Gemini 3.8 Flash 批量提取字段") == [
        "e-gemini-3-8-flash"
    ]


def test_known_provider_does_not_fall_back_to_unrelated_products(catalog):
    google = next(entity for entity in catalog.entities if entity.id == "e-google")
    google.name.en = "FixtureProvider"
    google.name.zh = "合成供应商"
    google.aliases = []
    assert google_scope(catalog, "FixtureProvider 批量提取工单字段") == []


def test_six_original_tasks_keep_existing_evidence_and_hard_constraints(catalog):
    before = catalog.model_dump_json()
    report = audit.evaluate(catalog)
    cases = {case["id"]: case for case in report["cases"]}
    for key in ("task-1", "task-2", "task-3", "task-4", "task-5", "task-6"):
        assert cases[key]["passed"], cases[key]["checks"]
    workspace = cases["task-4"]["decision"]
    assert workspace["recommendation"]["primaryEntityId"] == "e-dify"
    trial = workspace["plan"]["trial"]
    assert "启用引用展示" in trial["procedure"][0]
    assert "本轮选择回答模型" not in trial["procedure"][0]
    assert "无权访问" in trial["procedure"][1]
    assert "维护" in trial["metrics"][0]
    assert "15 USD" in cases["task-3"]["summary"]
    assert "44–76 USD" in cases["task-3"]["summary"]
    assert cases["task-5"]["decision"]["candidates"]
    assert "完全离线" in cases["task-5"]["summary"]
    assert "不必先理解模型" in cases["task-6"]["summary"]
    assert not cases["task-6"]["gaps"]
    assert report["paidCalls"] == 0 and not report["privateRecordsRead"]
    assert catalog.model_dump_json() == before


def test_product_and_underlying_model_are_distinct_routes():
    raw = {
        "task": "公司知识库问答，需要引用原文和权限控制",
        "priority": "quality",
        "deployment": "undecided",
    }
    product = interpret_scenario(DecisionContext(**raw), "zh")
    model = interpret_scenario(DecisionContext(**raw, task_type="model-api"), "zh")
    assert product.id == "knowledge-workspace"
    assert "workspace-permissions" in product.required_features
    assert model.id == "knowledge-assistant"
    assert "workspace-permissions" not in model.required_features


@pytest.mark.parametrize(
    "task_type,task,required",
    [
        ("coding-product", "为现有仓库选择可以编辑文件并运行测试的编码工具", "e-claude-code"),
        ("model-api", "为中文简历抽取选择模型，输出固定 JSON 字段", "e-gpt-61-sol"),
        ("knowledge-product", "为 PDF 文档问答选择知识库平台，回答须引用原文", "e-dify"),
    ],
)
def test_general_tasks_do_not_inherit_a_personal_channel_or_require_a_second_account(
    catalog, task_type, task, required
):
    from app.engagement import EngagementService

    context = DecisionContext(
        workflow_version=2,
        task=task,
        task_type=task_type,
        priority="quality",
        deployment="undecided",
    )
    current = current_claims(catalog.claims, catalog)
    by_entity = defaultdict(list)
    for claim in current:
        by_entity[claim.entity_id].append(claim)
    ids, _ = discover_candidates(context, catalog, by_entity, "zh")
    decision = EngagementService._build_decision(
        context, [claim for claim in current if claim.entity_id in ids], ids, catalog, "zh"
    )
    assert required in decision.plan.trial_candidate_ids
    assert decision.plan.state == "ready-to-validate"
    assert not context.budget.channel
    assert not decision.missing_inputs
    assert "CCSub" not in decision.recommendation.summary
    assert not any("CCSub" in action.instruction for action in decision.plan.actions)


@pytest.mark.parametrize(
    "task", ["保密合同必须完全离线运行", "不需要图像输入，保密合同必须完全离线运行"]
)
def test_local_deployment_does_not_establish_fully_offline_execution(catalog, task):
    entity = next(entity for entity in catalog.entities if entity.id == "e-gpt-61-sol")
    base = next(claim for claim in catalog.claims if claim.entity_id == entity.id)
    claim = base.model_copy(update={"predicate": "deployment", "object_or_value": "on-device"})
    context = DecisionContext(
        workflow_version=2,
        task=task,
        task_type="model-api",
        priority="privacy",
        deployment="on-device",
    )
    assert "deployment-unverified" in constraint_failures(entity, [claim], context)
    explicit = claim.model_copy(update={"object_or_value": "fully-offline"})
    assert "deployment-unverified" not in constraint_failures(entity, [explicit], context)


def test_cost_interval_choice_requires_strict_dominance_and_matching_scope(catalog):
    cases = json.loads(audit.TASKS.read_text("utf-8"))["cases"]
    context = DecisionContext.model_validate(cases[2]["context"])
    by_entity = defaultdict(list)
    for claim in current_claims(catalog.claims, catalog):
        by_entity[claim.entity_id].append(claim)
    ids = ["e-gemini-3-1-pro", "e-gemini-3-8-flash"]
    assert cost_choice(context, ids, by_entity)[0] == "e-gemini-3-8-flash"
    assert cost_choice(context, [*ids, "missing-quote"], by_entity) == (None, [])
    context.budget.channel = "CCSub"
    assert cost_choice(context, ids, by_entity) == (None, [])


def test_overlapping_intervals_never_establish_a_cost_winner(catalog):
    cases = json.loads(audit.TASKS.read_text("utf-8"))["cases"]
    context = DecisionContext.model_validate(cases[2]["context"])
    price = next(
        claim
        for claim in catalog.claims
        if claim.predicate == "api_price" and claim.entity_id == "e-gemini-3-1-pro"
    )
    assert cost_choice(context, ["a", "b"], {"a": [price], "b": [price]}) == (None, [])


@pytest.mark.parametrize(
    "predicate,value,expected",
    [
        ("has-max-context", "1M", 1000000),
        ("has-context-window", "1M-token context window", 1000000),
        ("has-max-context", "up to 1M", None),
        ("has-max-context", "1M or 2M depending on mode", None),
        ("has-default-context", "272k", None),
    ],
)
def test_exact_ingested_contexts_are_used_without_conflating_defaults_or_ranges(
    catalog, predicate, value, expected
):
    base = catalog.claims[0].model_copy(update={"predicate": predicate, "object_or_value": value})
    capacities = [fact.value for fact in normalized_facts(base) if fact.dimension == "context"]
    assert capacities == ([expected] if expected else [])
