"""Evidence in explicit fields, with unmatched dimensions retained as unknown.

No textual keyword, model size, source count or benchmark name proves speed,
quality, budget or task suitability. Facts remain verbatim, individually cited.
"""

import hashlib
import json

from .decision_constraints import api_price_basis, api_price_value, explicit_spec_fields
from .decision_facts import normalized_facts
from .schemas import (
    Claim,
    DecisionComparison,
    DecisionComparisonCell,
    DecisionContext,
    DecisionTradeoff,
)

LABELS = {
    "product-entry": ("编码产品使用入口", "Coding product entry points"),
    "workflow-qualification": ("产品适用条件", "Product qualifications"),
    "task-quality": ("任务效果（同口径测试）", "Task quality (comparable tests)"),
    "speed": ("速度（同口径测试）", "Speed (comparable tests)"),
    "api-price": ("API 价格", "API price"),
    "deployment": ("部署方式", "Deployment"),
    "access": ("权重获取", "Weight access"),
    "region": ("部署地区", "Hosting region"),
    "license": ("许可说明", "License terms"),
    "context": ("上下文容量", "Context capacity"),
    "input-modalities": ("输入模态", "Input modalities"),
    "commercial-use": ("商用许可", "Commercial use"),
    "total-parameters": ("总参数量", "Total parameters"),
    "active-parameters": ("每 token 激活参数", "Active parameters per token"),
}
PRIORITY = {
    "balanced": "task-quality",
    "quality": "task-quality",
    "cost": "api-price",
    "speed": "speed",
    "privacy": "deployment",
    "control": "access",
}
PREDICATES = {
    "licensed-under": "license",
    "uses-license": "license",
    "total parameters": "total-parameters",
    "total-parameters": "total-parameters",
    "active parameters": "active-parameters",
    "active-parameters": "active-parameters",
}
ENUMS = {
    "deployment": {"cloud-api", "private", "on-device", "hybrid"},
    "access": {"open-weights", "closed-weights"},
}


def field_for_claim(claim: Claim) -> tuple[str, str | None] | None:
    """Return an explicit field and, for prices, its complete comparison basis.

    Raw benchmark prose lacks a machine-verifiable metric/test setup; it stays
    additional evidence rather than being labelled task quality or speed.
    """
    predicate = (claim.predicate or "").strip().lower()
    value = claim.object_or_value
    if not value:
        return None
    if predicate == "context_tokens":
        try:
            tokens = json.loads(value)
            return (
                ("context", None)
                if isinstance(tokens, int) and not isinstance(tokens, bool) and tokens > 0
                else None
            )
        except (ValueError, TypeError):
            return None
    if predicate == "input_modality" and value in {"text", "image", "audio", "video"}:
        return "input-modalities", None
    if predicate == "commercial_use" and value in {"allowed", "prohibited"}:
        return "commercial-use", None
    if predicate in PREDICATES:
        return PREDICATES[predicate], None
    if predicate in ENUMS and value in ENUMS[predicate]:
        return predicate, None
    if predicate == "region" and value.strip():
        return "region", None
    price = api_price_value(claim)
    if price is None:
        return None
    # Additional conditions, tiers, currencies and channels never get folded
    # into an apparently common price row. Their quoted terms remain visible.
    basis = api_price_basis(price)
    return "api-price", json.dumps(basis, sort_keys=True, ensure_ascii=False)


def build_comparisons(
    context: DecisionContext,
    entity_ids: list[str],
    claims_by_entity: dict[str, list[Claim]],
    language: str,
) -> tuple[list[DecisionComparison], set[str]]:
    """Consume only current public/eligible facts already validated by the caller."""
    if not entity_ids:
        return [], set()
    priority = PRIORITY[context.priority]
    groups: dict[tuple[str, str | None], dict[str, list[Claim]]] = {}
    for entity_id in entity_ids:
        for claim in claims_by_entity.get(entity_id, []):
            for field in fields_for_claim(claim, official_specs=context.workflow_version == 2):
                groups.setdefault(field, {}).setdefault(entity_id, []).append(claim)
    # The requested priority remains visible even when no matching fact exists.
    if not any(field == priority for field, _ in groups):
        groups[(priority, None)] = {}
    for enabled, field in [
        (context.minimum_context_tokens is not None, "context"),
        (bool(context.input_modalities), "input-modalities"),
        (context.commercial_use_required, "commercial-use"),
        (bool(context.region), "region"),
        (context.deployment != "undecided", "deployment"),
    ]:
        if enabled:
            groups.setdefault((field, None), {})
    order = list(LABELS)
    keys = sorted(groups, key=lambda key: (key[0] != priority, order.index(key[0]), key[1] or ""))
    comparisons = []
    compared_claim_ids = set()
    for field, basis in keys:
        label = LABELS[field][language == "en"]
        row_id = field
        if basis:
            parts = json.loads(basis)
            channel = {
                "official": "官方" if language == "zh" else "official",
                "reseller": "第三方" if language == "zh" else "reseller",
            }.get(parts["channel"], parts["channel"])
            label += f" ({parts['currency']} · {channel} · " + (
                "每百万 token)" if language == "zh" else "per million tokens)"
            )
            if parts.get("conditions") == "standard-uncached-tokens-only":
                label += " · Standard 未缓存" if language == "zh" else " · Standard uncached"
                if parts.get("tiers"):
                    limits = [
                        str(tier["upToInputTokens"])
                        for tier in parts["tiers"]
                        if tier.get("upToInputTokens") is not None
                    ]
                    label += (
                        " · 按请求输入分档（" + " / ".join(limits) + " token）"
                        if language == "zh"
                        else " · Request-input tiers (" + " / ".join(limits) + " tokens)"
                    )
                else:
                    label += " · 单一费率" if language == "zh" else " · Flat rate"
            row_id += "-" + hashlib.sha256(basis.encode()).hexdigest()[:16]
        cells = []
        for entity_id in entity_ids:
            claims = groups[(field, basis)].get(entity_id, [])
            facts = [
                DecisionTradeoff(
                    dimension=field,
                    finding=comparison_finding(
                        claim, field, language, context.workflow_version == 2
                    ),
                    claim_ids=[claim.id],
                )
                for claim in claims
            ]
            compared_claim_ids.update(claim.id for claim in claims)
            cells.append(
                DecisionComparisonCell(
                    entity_id=entity_id, state="supported" if facts else "unknown", facts=facts
                )
            )
        comparisons.append(DecisionComparison(id=row_id, dimension=label, cells=cells))
    return comparisons, compared_claim_ids


def fields_for_claim(claim: Claim, *, official_specs: bool = False) -> list[tuple[str, str | None]]:
    field = field_for_claim(claim)
    fields = [field] if field else []
    if official_specs:
        fields.extend((fact.dimension, None) for fact in normalized_facts(claim))
    return list(dict.fromkeys(fields))


def comparison_finding(claim: Claim, field: str, language: str, official_specs: bool) -> str:
    fields = explicit_spec_fields(claim) if official_specs else {}
    if field == "context" and "context" in fields:
        return (
            f"输入上下文：{fields['context']:,} token"
            if language == "zh"
            else f"Input context: {fields['context']:,} tokens"
        )
    if field == "deployment" and fields.get("deployment") == "cloud-api":
        return claim.text.zh if language == "zh" else claim.text.en
    return claim.text.zh if language == "zh" else claim.text.en
