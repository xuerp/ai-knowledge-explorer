"""Explicit candidate dispositions; evidence coverage is never a capability score."""

import json

from .decision_comparison import PRIORITY, fields_for_claim
from .decision_constraints import (
    api_price_basis,
    api_price_value,
    constraint_failures,
    context_values,
)
from .decision_licenses import commercial_status, service_billing_mismatch
from .schemas import Claim, DecisionCandidate, DecisionContext, KnowledgeSnapshot

REASONS = {
    "billing-channel-mismatch": (
        "实际服务与预算计费渠道不一致，不能沿用其他渠道报价",
        "Actual service and billing channels differ; another channel's quote cannot establish budget fit",
    ),
    "commercial-use-prohibited": ("已核验许可禁止商用", "Verified terms prohibit commercial use"),
    "commercial-authorization-required": (
        "当前许可明确要求商用前取得书面授权；尚未提供本项目授权",
        "The current license requires prior written commercial authorization; authorization for this project is missing",
    ),
    "infrastructure-cost-unverified": (
        "私有、端侧或混合部署的硬件与运维总成本尚未核验；API 单价不能替代",
        "Hardware and operating cost for private, on-device or hybrid deployment is unverified; API prices cannot substitute",
    ),
    "price-conditions-unverified": (
        "价格包含额外适用条件，尚未核验本次工作量是否满足",
        "Price has additional conditions not verified against this workload",
    ),
    "excluded": ("符合排除条件", "Matches an exclusion"),
    "different-task-type": ("对象类型不符合选型任务", "Wrong selection type"),
    "unavailable-version": ("版本尚不可用或已退出当前目录", "Version unavailable or retired"),
    "concrete-version-required": (
        "请选择具体版本；家族不能证明版本适配",
        "Select a concrete version; family evidence does not prove version fit",
    ),
    "deployment-unverified": ("部署方式缺少核验证据", "Deployment not verified"),
    "region-unverified": ("部署地区缺少核验证据", "Region not verified"),
    "open-weights-unverified": ("开放权重缺少核验证据", "Open weights not verified"),
    "exclusion-needs-clarification": ("排除条件需要澄清", "Clarify the exclusion"),
    "budget-assumptions-missing": (
        "预算上限、币种或渠道未明确",
        "Specify budget ceiling, currency and channel",
    ),
    "workload-missing": ("月输入或输出工作量未明确", "Specify monthly input and output workload"),
    "price-unverified-or-conflicting": (
        "价格缺少核验证据或存在冲突",
        "Price unverified or conflicting",
    ),
    "over-budget": ("按指定工作量计算超过预算", "Exceeds budget at the stated workload"),
    "context-unverified-or-conflicting": (
        "上下文容量缺少核验证据或存在冲突",
        "Context capacity unverified or conflicting",
    ),
    "context-too-small": (
        "已核验上下文容量低于要求",
        "Verified context capacity is below the minimum",
    ),
    "input-modality-unverified": (
        "所需输入模态缺少核验证据",
        "Required input modality not verified",
    ),
    "commercial-use-unverified": ("商用许可缺少核验证据", "Commercial use not verified"),
    "no-current-evidence": ("没有当前已审核且有日期的引用", "No current reviewed, dated citations"),
    "candidate-unavailable": (
        "候选对象不在当前公开目录",
        "Candidate absent from the current public catalog",
    ),
    "conflict": ("当前事实存在冲突，需要核对来源", "Current facts conflict; inspect their sources"),
}
EXCLUDED = {
    "commercial-use-prohibited",
    "excluded",
    "different-task-type",
    "unavailable-version",
    "over-budget",
    "context-too-small",
}


def conflicting_entities(
    claims_by_entity: dict[str, list[Claim]], context: DecisionContext | None = None
) -> set[str]:
    result = set()
    for entity_id, claims in claims_by_entity.items():
        groups: dict[str, set[str]] = {}
        # Includes normalized official-spec capacities so conflicting formats
        # cannot make a candidate appear safe to select.
        groups["context_tokens"] = {
            str(value) for value in context_values(claims, official_specs=True)
        }
        for claim in claims:
            if claim.predicate == "context_tokens":
                try:
                    value = json.loads(claim.object_or_value or "")
                    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
                        groups.setdefault("context_tokens", set()).add(str(value))
                except (ValueError, TypeError):
                    pass
            if claim.predicate == "commercial_use" and claim.object_or_value in {
                "allowed",
                "prohibited",
            }:
                groups.setdefault("commercial_use", set()).add(claim.object_or_value)
            elif context and (permission := commercial_status(claim, context)):
                groups.setdefault("commercial_use", set()).add(permission)
            if (price := api_price_value(claim)) is not None:
                basis = json.dumps(
                    api_price_basis(price),
                    sort_keys=True,
                )
                groups.setdefault("price:" + basis, set()).add(
                    json.dumps(
                        [float(price["input"]), float(price["output"]), price.get("tiers")],
                        sort_keys=True,
                    )
                )
        if any(len(values) > 1 for values in groups.values()):
            result.add(entity_id)
    return result


def missing_inputs(context: DecisionContext) -> list[str]:
    missing = []
    if service_billing_mismatch(context):
        missing.append("matching-service-channel")
    if context.budget.mode == "range":
        if context.budget.max is None:
            missing.append("budget-ceiling")
        if not context.budget.currency:
            missing.append("budget-currency")
        if not context.budget.channel:
            missing.append("billing-channel")
        if context.budget.period == "month":
            if context.budget.monthly_input_tokens is None:
                missing.append("monthly-input-tokens")
            if context.budget.monthly_output_tokens is None:
                missing.append("monthly-output-tokens")
    return missing


def candidate_dispositions(
    context: DecisionContext,
    ids: list[str],
    claims_by_entity: dict[str, list[Claim]],
    snapshot: KnowledgeSnapshot,
    conflict_ids: set[str],
    language: str,
) -> list[DecisionCandidate]:
    entities = {entity.id: entity for entity in snapshot.entities}
    required = [PRIORITY[context.priority]]
    for enabled, field in [
        (context.deployment != "undecided", "deployment"),
        (bool(context.region), "region"),
        (context.budget.mode == "range", "api-price"),
        (context.minimum_context_tokens is not None, "context"),
        (bool(context.input_modalities), "input-modalities"),
        (context.commercial_use_required, "commercial-use"),
    ]:
        if enabled and field not in required:
            required.append(field)
    rows = []
    for entity_id in dict.fromkeys(ids):
        entity = entities.get(entity_id)
        claims = claims_by_entity.get(entity_id, [])
        failures = (
            constraint_failures(entity, claims, context) if entity else ["candidate-unavailable"]
        )
        if not claims:
            failures.append("no-current-evidence")
        if entity_id in conflict_ids:
            failures.append("conflict")
        fields = {
            field[0]
            for claim in claims
            for field in fields_for_claim(claim, official_specs=context.workflow_version == 2)
        }
        # A fact for text input is not complete evidence for required audio;
        # existing fields must not hide an unverified requested subcondition.
        # Known but insufficient specs remain cited and explicitly excluded.
        for enabled, field, blockers in [
            (
                context.minimum_context_tokens is not None,
                "context",
                {"context-unverified-or-conflicting", "context-too-small"},
            ),
            (bool(context.input_modalities), "input-modalities", {"input-modality-unverified"}),
            (context.commercial_use_required, "commercial-use", {"commercial-use-unverified"}),
            (
                context.budget.mode == "range",
                "api-price",
                {
                    "budget-assumptions-missing",
                    "billing-channel-mismatch",
                    "workload-missing",
                    "price-unverified-or-conflicting",
                    "price-conditions-unverified",
                    "over-budget",
                    "infrastructure-cost-unverified",
                },
            ),
        ]:
            if enabled:
                if not blockers.intersection(failures):
                    fields.add(field)
                elif (blockers - {"context-too-small", "over-budget"}).intersection(failures):
                    fields.discard(field)
        eligibility = (
            "conflict"
            if "conflict" in failures
            else "excluded"
            if EXCLUDED.intersection(failures)
            else "unknown"
            if failures
            else "eligible"
        )
        rows.append(
            DecisionCandidate(
                entity_id=entity_id,
                eligibility=eligibility,
                reasons=[REASONS[reason][language == "en"] for reason in dict.fromkeys(failures)],
                claim_ids=[claim.id for claim in claims],
                required_dimensions=required,
                covered_dimensions=[field for field in required if field in fields],
                is_concrete_version=bool(entity and (entity.type != "model" or entity.family_id)),
            )
        )
    return rows
