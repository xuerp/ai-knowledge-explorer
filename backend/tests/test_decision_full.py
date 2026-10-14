"""Cross-scenario regression, cited normalization, and bounded conditional choice."""

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.decision_candidates import discover_candidates, interpret_scenario
from app.decision_constraints import constraint_failures, current_claims
from app.decision_explanation import cost_choice
from app.decision_facts import normalized_facts
from app.engagement import EngagementService
from app.schemas import Claim, DecisionContext, DecisionValidationItem, KnowledgeSnapshot


def fixture():
    snapshot = KnowledgeSnapshot.model_validate_json(
        (Path(__file__).resolve().parents[1] / "data/demo_snapshot.json").read_bytes()
    )
    template = next(entity for entity in snapshot.entities if entity.id == "e-gpt")
    snapshot.entities = []
    snapshot.claims = []
    date = datetime.now(UTC).date().isoformat()
    snapshot.evidence[0].published_at = date
    for index in range(25):
        entity = template.model_copy(
            update={
                "id": f"model-{index:02}",
                "slug": f"model-{index:02}",
                "name": template.name.model_copy(update={"en": f"Synthetic model {index:02}"}),
                "family_id": "family",
                "release": None,
                "status": "active",
                "summary": template.summary.model_copy(
                    update={"zh": "通用文本生成模型", "en": "General text generation model"}
                ),
            }
        )
        snapshot.entities.append(entity)
        snapshot.claims.append(
            Claim(
                id=f"claim-{index:02}",
                entity_id=entity.id,
                text={
                    "zh": "合成文本生成事实，不是实测。",
                    "en": "Synthetic text generation description, not a measurement.",
                },
                predicate="capability",
                object_or_value="text-generation",
                confidence="verified",
                source_ids=[snapshot.evidence[0].id],
                valid_from=date,
                updated_at=date,
            )
        )
    context = DecisionContext(
        workflow_version=2,
        task="Build a career assistant for resume and job search",
        task_type="model-api",
        priority="quality",
        deployment="undecided",
    )
    return snapshot, context


def by_entity(snapshot):
    groups = {}
    for claim in current_claims(snapshot.claims, snapshot):
        groups.setdefault(claim.entity_id, []).append(claim)
    return groups


@pytest.mark.parametrize("language", ["zh", "en"])
def test_recommendation_prose_does_not_name_functionally_unqualified_alternatives(language):
    snapshot, context = fixture()
    snapshot.entities = snapshot.entities[:2]
    snapshot.claims = snapshot.claims[:2]
    for index, entity in enumerate(snapshot.entities):
        entity.name.zh = f"合成候选{index}"
    snapshot.claims.append(
        snapshot.claims[0].model_copy(
            update={
                "id": "structured-output-qualified-only",
                "predicate": "workflow-feature",
                "object_or_value": "structured-output",
                "text": snapshot.claims[0].text.model_copy(
                    update={"zh": "支持结构化输出。", "en": "Supports structured output."}
                ),
            }
        )
    )
    result = EngagementService._build_decision(
        context, snapshot.claims, [entity.id for entity in snapshot.entities], snapshot, language
    )
    assert result.plan.trial_candidate_ids == ["model-00"]
    assert result.recommendation.primary_entity_id == "model-00"
    assert not result.recommendation.alternative_entity_ids
    assert getattr(snapshot.entities[1].name, language) not in result.recommendation.summary


def test_scope_checks_all_relevant_candidates_before_report_limit():
    snapshot, context = fixture()
    snapshot.claims[-1].predicate = "deployment"
    snapshot.claims[-1].object_or_value = "private"
    context.deployment = "private"
    ids, scope = discover_candidates(context, snapshot, by_entity(snapshot), "en")
    assert len(scope.considered_entity_ids) == 25
    assert len(ids) == 20 and len(scope.omitted_entity_ids) == 5
    assert ids[0] == "model-24", "A qualified late candidate must survive whole-scope qualification"
    assert set(ids).isdisjoint(scope.omitted_entity_ids)


def test_no_random_fallback_and_voice_products_do_not_match_document_tasks():
    snapshot, context = fixture()
    specialized = snapshot.entities[0]
    specialized.summary.en = "Text-to-speech for spoken output"
    specialized.summary.zh = "将文本转换为自然语音"
    ids, _ = discover_candidates(context, snapshot, by_entity(snapshot), "en")
    assert specialized.id not in ids
    context.task = "Cement chemical formulation and turbine design"
    assert discover_candidates(context, snapshot, by_entity(snapshot), "en")[0] == []
    context.task = "Coding model for code generation and tool use"
    specialized.summary.en = "Dedicated image generation with tools"
    specialized.summary.zh = "专用图像生成模型与工具"
    assert (
        specialized.id not in discover_candidates(context, snapshot, by_entity(snapshot), "en")[0]
    )


def test_knowledge_model_selection_does_not_require_a_native_retriever():
    snapshot, context = fixture()
    context.task = "Choose an answering model for knowledge base document questions"
    result = EngagementService._build_decision(
        context, snapshot.claims[:2], [e.id for e in snapshot.entities[:2]], snapshot, "en"
    )
    assert result.scenario.required_features == ["text-generation"]
    assert result.plan.state == "ready-to-validate"
    assert "Fix retrieved excerpts" in result.plan.trial.procedure[0]
    assert "permissions separately" in result.plan.trial.procedure[0]
    context.task = "Choose a knowledge base model with built-in retrieval"
    strict = EngagementService._build_decision(
        context, snapshot.claims[:2], [e.id for e in snapshot.entities[:2]], snapshot, "en"
    )
    assert "retrieval" in strict.scenario.required_features
    assert strict.plan.state == "needs-evidence"
    assert not strict.recommendation.validation_entity_ids


def test_reviewed_features_discover_a_product_with_a_sparse_catalog_summary():
    snapshot, context = fixture()
    product = snapshot.entities[0]
    product.type = "tool"
    product.summary.zh = "终端开发工作台"
    product.summary.en = "Terminal development workspace"
    product.tags = []
    fact = snapshot.claims[0]
    fact.predicate = "workflow-feature"
    fact.object_or_value = "file-editing"
    fact.text.zh = "这个工作台可以编辑文件。"
    fact.text.en = "This workspace edits files."
    context.task_type = "coding-product"
    context.task = "Choose a coding product to edit files and run tests"
    ids, _ = discover_candidates(context, snapshot, by_entity(snapshot), "en")
    assert product.id in ids
    fact.confidence = "unverified"
    assert product.id not in discover_candidates(context, snapshot, by_entity(snapshot), "en")[0]


def test_named_family_expansion_and_requested_scope_are_preserved():
    snapshot, context = fixture()
    context.candidate_entity_ids = ["missing-id", snapshot.entities[-1].id]
    ids, scope = discover_candidates(context, snapshot, by_entity(snapshot), "en")
    assert ids == context.candidate_entity_ids and scope.explicit
    assert not scope.omitted_entity_ids


def test_specific_version_does_not_expand_parent_family_or_ambiguous_alias():
    snapshot, context = fixture()
    family = snapshot.entities[0].model_copy(
        update={
            "id": "family",
            "family_id": None,
            "name": snapshot.entities[0].name.model_copy(
                update={"zh": "Synthetic", "en": "Synthetic"}
            ),
            "aliases": [],
            "slug": "synthetic",
        }
    )
    snapshot.entities.append(family)
    context.task = "Compare Synthetic model 24 for text generation"
    ids, _ = discover_candidates(context, snapshot, by_entity(snapshot), "en")
    assert ids == ["model-24"]
    context.task = "Compare Synthetic for text generation"
    ids, scope = discover_candidates(context, snapshot, by_entity(snapshot), "en")
    assert len(scope.considered_entity_ids) == 25 and len(ids) == 20


def test_stateful_and_approval_requirements_are_retained_without_inventing_support():
    _, context = fixture()
    context.task_type = "agent-development"
    context.task = "有状态 Agent 框架，需要人工审批和中断恢复"
    scenario = interpret_scenario(context, "zh")
    assert set(scenario.required_features) >= {
        "persistent-state",
        "human-approval",
        "failure-recovery",
    }
    context.task = "Agent framework; no need for persistent state; human approval not required"
    assert "persistent-state" not in interpret_scenario(context, "en").required_features
    assert "human-approval" not in interpret_scenario(context, "en").required_features


@pytest.mark.parametrize(
    "task,kind,scene",
    [
        ("企业知识库文档问答", "model-api", "knowledge-assistant"),
        ("处理简历和岗位匹配", "model-api", "career-assistant"),
        ("Choose a coding assistant IDE", "coding-product", "coding-workspace"),
        ("构建有状态多智能体", "agent-development", "agent-orchestration"),
        ("Extract data from invoices", "model-api", "document-extraction"),
    ],
)
def test_business_scenarios_are_deterministic_and_do_not_conflate_types(task, kind, scene):
    _, context = fixture()
    context.task, context.task_type = task, kind
    parsed = interpret_scenario(context, "en")
    assert parsed.id == scene and parsed.clarification_checks


@pytest.mark.parametrize(
    "predicate,value,text,dimension,expected",
    [
        ("context-window", "256k", "Version context is 256k", "context", 256000),
        ("catalog-review", "reviewed", "官方 API 文档列出 400K 上下文", "context", 400000),
        (
            "official-model-specification",
            "fixture-api; context=128000",
            "API ID 为 fixture-api",
            "deployment",
            "cloud-api",
        ),
        (None, None, "该型号接受文本和图像输入、输出文本", "input-modalities", "image"),
    ],
)
def test_reviewed_formats_share_a_cited_normalization(predicate, value, text, dimension, expected):
    snapshot, _ = fixture()
    claim = snapshot.claims[0].model_copy(update={"predicate": predicate, "object_or_value": value})
    claim.text.zh, claim.text.en = text, ""
    facts = normalized_facts(claim)
    assert any(
        fact.dimension == dimension and fact.value == expected and fact.claim_id == claim.id
        for fact in facts
    )


@pytest.mark.parametrize(
    "predicate,value,text",
    [
        ("context", "Vendor model-line description: 256K context", "模型线说明列出256K上下文"),
        ("catalog-review", "reviewed", "不支持128K上下文"),
        ("catalog-review", "reviewed", "支持至少128K上下文"),
        (
            "official-model-specification",
            "fixture-api; context=128000",
            "API ID 为 fixture-api-old",
        ),
        ("access", "Official API link; current API unverified", "提到API关键词不能证明部署"),
    ],
)
def test_ambiguous_scope_negation_and_api_mentions_never_prove_deployment(predicate, value, text):
    snapshot, context = fixture()
    claim = snapshot.claims[0].model_copy(update={"predicate": predicate, "object_or_value": value})
    claim.text.zh, claim.text.en = text, ""
    facts = normalized_facts(claim)
    assert not any(fact.dimension == "deployment" for fact in facts)
    if predicate != "official-model-specification":
        assert not any(fact.dimension == "context" for fact in facts)
    context.deployment = "cloud-api"
    assert "deployment-unverified" in constraint_failures(snapshot.entities[0], [claim], context)


def test_no_current_date_is_explained_without_promoting_collection_date():
    snapshot, context = fixture()
    entity_id = snapshot.entities[0].id
    snapshot.claims[0].valid_from = None
    snapshot.evidence[0].published_at = ""
    context.candidate_entity_ids = [entity_id]
    decision = EngagementService._build_decision(
        context, snapshot.claims[:1], [entity_id], snapshot, "en"
    )
    assert decision.candidates[0].eligibility == "unknown"
    assert any(
        gap.reason == "not-current" and "publication date" in gap.detail
        for gap in decision.candidates[0].gaps
    )
    assert not decision.claim_ids and not decision.recommendation.primary_entity_id


def test_equal_qualifications_do_not_become_a_false_primary_or_quality_score():
    snapshot, context = fixture()
    ids = [entity.id for entity in snapshot.entities[:2]]
    context.candidate_entity_ids = ids
    result = EngagementService._build_decision(context, snapshot.claims[:2], ids, snapshot, "en")
    assert result.recommendation.primary_entity_id is None
    # Text generation alone cannot satisfy resume structured-output requirements.
    assert result.recommendation.validation_entity_ids == []
    assert result.plan.state == "needs-evidence"
    assert "can enter" not in result.recommendation.summary
    assert all("task-quality" not in row.covered_dimensions for row in result.candidates)
    assert all(any(gap.reason == "requires-poc" for gap in row.gaps) for row in result.candidates)


def test_prices_require_same_basis_and_do_not_add_rates_without_workload():
    snapshot, context = fixture()
    context.priority = "cost"
    ids = [entity.id for entity in snapshot.entities[:2]]
    prices = [{"input": 1, "output": 5}, {"input": 2, "output": 3}]
    for claim, price in zip(snapshot.claims[:2], prices):
        claim.predicate = "api_price"
        claim.object_or_value = json.dumps(
            {**price, "currency": "USD", "channel": "official", "unit": "per-million-tokens"}
        )
    groups = by_entity(snapshot)
    assert cost_choice(context, ids, groups)[0] is None
    context.budget.monthly_input_tokens, context.budget.monthly_output_tokens = 1000000, 100
    assert cost_choice(context, ids, groups)[0] == ids[0]
    context.deployment = "private"
    assert cost_choice(context, ids, groups)[0] is None


def test_new_poc_conditions_are_required_for_measured_results_but_old_notes_load():
    legacy = DecisionValidationItem(
        id="legacy",
        title="Historical note",
        status="passed",
        result="Historical fixture result with its conditions",
    )
    assert "testConditions" not in legacy.model_dump(by_alias=True)
    with pytest.raises(ValidationError):
        DecisionValidationItem(
            id="new",
            title="New measured record",
            status="passed",
            result="Synthetic result",
            test_conditions={"modelVersion": "fixture"},
        )
    complete = DecisionValidationItem(
        id="new",
        title="New measured record",
        status="passed",
        result="Synthetic result",
        test_conditions={
            "modelVersion": "fixture-v1",
            "configuration": "offline fixture",
            "sampleCount": 10,
            "testedAt": "2026-10-10",
            "scope": "Synthetic tests, not a real model measurement",
        },
    )
    assert complete.test_conditions.sample_count == 10
