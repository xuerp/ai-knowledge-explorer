"""Compose actionable, conditional decisions without converting coverage to quality."""

from datetime import UTC, datetime

from .decision_candidates import CATALOG, described_features, interpret_scenario
from .decision_constraints import api_price_value, date_value, token_quote_bounds
from .decision_licenses import commercial_scope_missing
from .decision_plan import build_plan
from .schemas import (
    Claim,
    DecisionComparison,
    DecisionComparisonCell,
    DecisionContext,
    DecisionGap,
    DecisionResult,
    DecisionTradeoff,
    KnowledgeSnapshot,
)

HINTS = {
    "deployment": r"部署|deployment|API|权重|weights",
    "region": r"地区|区域|region|territor",
    "api-price": r"价格|定价|计费|price|pricing|billing|cost",
    "context": r"上下文|context",
    "input-modalities": r"模态|输入|modalit|input",
    "commercial-use": r"许可|商用|license|commercial",
    "access": r"权重|weights|open.source",
}


def cost_choice(
    context: DecisionContext, eligible: list[str], claims_by_entity: dict[str, list[Claim]]
) -> tuple[str | None, list[str]]:
    """Same complete basis, identical input/output workload; otherwise no ranking."""
    if (
        context.priority != "cost"
        or len(eligible) < 2
        or context.deployment in {"private", "on-device", "hybrid"}
    ):
        return None, []
    rates = {}
    bases = set()
    for entity_id in eligible:
        prices = [
            (claim, price)
            for claim in claims_by_entity.get(entity_id, [])
            if (price := api_price_value(claim)) is not None
        ]
        prices = [
            (claim, price)
            for claim, price in prices
            if set(price) == {"input", "output", "currency", "channel", "unit"}
            and (not context.budget.currency or price["currency"] == context.budget.currency)
            and (not context.budget.channel or price["channel"] == context.budget.channel)
        ]
        if len(prices) != 1:
            return None, []
        claim, price = prices[0]
        bases.add((price["currency"], price["channel"], price["unit"]))
        rates[entity_id] = (price["input"], price["output"], claim.id)
    if len(bases) != 1:
        return None, []
    budget = context.budget
    if budget.monthly_input_tokens is not None and budget.monthly_output_tokens is not None:
        costs = {
            key: item[0] * budget.monthly_input_tokens + item[1] * budget.monthly_output_tokens
            for key, item in rates.items()
        }
        minimum = min(costs.values())
        winners = [key for key, cost in costs.items() if cost == minimum]
    else:
        winners = [
            key
            for key, price in rates.items()
            if all(
                price[0] <= other[0] and price[1] <= other[1] and (price[:2] != other[:2])
                for other_key, other in rates.items()
                if key != other_key
            )
        ]
    return (winners[0] if len(winners) == 1 else None, [item[2] for item in rates.values()])


def explain_decision(
    result: DecisionResult,
    context: DecisionContext,
    claims_by_entity: dict[str, list[Claim]],
    snapshot: KnowledgeSnapshot,
    language: str,
) -> DecisionResult:
    import re

    scenario = interpret_scenario(context, language)
    entities = {entity.id: entity for entity in snapshot.entities}
    name = lambda key: (
        (entities[key].name.zh if language == "zh" else entities[key].name.en)
        if key in entities
        else key
    )
    next_checks = list(scenario.clarification_checks)
    candidates = []
    for row in result.candidates:
        claims = claims_by_entity.get(row.entity_id, [])
        strengths = described_features(claims, scenario, language)
        if context.budget.mode == "range":
            for claim in claims:
                price = api_price_value(claim)
                if (
                    price is None
                    or price.get("conditions") != "standard-uncached-tokens-only"
                    or price["channel"] != context.budget.channel
                    or price["currency"] != context.budget.currency
                ):
                    continue
                bounds = token_quote_bounds(price, context)
                if bounds is None:
                    continue
                amount = (
                    f"{bounds[0]:g}" if bounds[0] == bounds[1] else f"{bounds[0]:g}–{bounds[1]:g}"
                )
                strengths.append(
                    DecisionTradeoff(
                        dimension="api-price",
                        claim_ids=[claim.id],
                        finding=(
                            f"按所填工作量，{'每月' if context.budget.period == 'month' else '每百万输入加每百万输出 token'}估算 {amount} {price['currency']}；仅 Standard 未缓存模型 token，不含其他支出，不是实际账单。"
                            if language == "zh"
                            else f"At the stated workload, estimated {'monthly' if context.budget.period == 'month' else 'per million input plus per million output tokens'} cost is {amount} {price['currency']}, for Standard uncached model tokens only; excludes other charges and is not an actual bill."
                        ),
                    )
                )
        gaps = []
        if row.eligibility == "conflict":
            gaps.append(
                DecisionGap(
                    dimension="evidence",
                    reason="conflicting",
                    detail=(
                        "当前事实互相冲突；逐条核对来源、具体版本和适用条件后再选择。"
                        if language == "zh"
                        else "Current facts conflict; reconcile sources, exact version and applicable conditions before choosing."
                    ),
                    claim_ids=row.claim_ids,
                )
            )
        if not claims:
            raw = [claim for claim in snapshot.claims if claim.entity_id == row.entity_id]
            today = datetime.now(UTC).date()
            sources = {source.id: source for source in snapshot.evidence}
            expired = any(
                date_value(claim.valid_to) and date_value(claim.valid_to) <= today for claim in raw
            )
            missing_date = any(
                not date_value(claim.valid_from)
                and not any(
                    date_value(sources[key].published_at)
                    for key in claim.source_ids
                    if key in sources
                )
                for claim in raw
            )
            detail = (
                (
                    "已有公开资料，但适用期已结束；需要当前版本的有效证据。"
                    if expired
                    else "已有公开资料，但事实生效日期或来源发布日期缺失；采集日期不能代替。"
                    if missing_date
                    else "已有资料不能通过当前审核、来源或有效期核验。"
                    if raw
                    else "当前公开目录中没有此候选的已审核事实。"
                )
                if language == "zh"
                else (
                    "Public records exist but their validity ended; current version evidence is required."
                    if expired
                    else "Public records exist but the fact effective date or source publication date is missing; collection dates cannot substitute."
                    if missing_date
                    else "Available records do not pass current review, source or validity checks."
                    if raw
                    else "This candidate has no reviewed facts in the current public catalog."
                )
            )
            gaps.append(
                DecisionGap(
                    dimension="evidence",
                    reason="not-current" if raw else "not-recorded",
                    detail=detail,
                )
            )
        for dimension in row.required_dimensions:
            if dimension in row.covered_dimensions:
                continue
            hints = [
                claim.id
                for claim in claims
                if dimension in HINTS
                and re.search(HINTS[dimension], claim.text.zh + " " + claim.text.en, re.IGNORECASE)
            ]
            performance = dimension in {"task-quality", "speed"}
            scoped_quote = (
                dimension == "api-price"
                and context.budget.mode == "range"
                and any(
                    (price := api_price_value(claim)) is not None
                    and price.get("conditions") == "standard-uncached-tokens-only"
                    and price["channel"] == context.budget.channel
                    and price["currency"] == context.budget.currency
                    for claim in claims
                )
            )
            reason = (
                "requires-poc"
                if performance
                else "needs-input"
                if (dimension == "api-price" and (result.missing_inputs or scoped_quote))
                or (dimension == "commercial-use" and commercial_scope_missing(context, claims))
                else "not-structured"
                if hints
                else "not-recorded"
            )
            detail = (
                (
                    "缺少适用于本业务、相同样本和配置的实测；现有功能描述或其他基准不能证明。"
                    if performance
                    else "已有相关资料，但未形成可用于此硬条件的完整、明确事实。"
                    if hints
                    else "当前已审核引用未收录此条件所需的明确事实。"
                )
                if language == "zh"
                else (
                    "Comparable measurements on this business, sample and configuration are missing; descriptions or other benchmarks cannot substitute."
                    if performance
                    else "Related sources exist, but do not provide a complete, explicit fact for this constraint."
                    if hints
                    else "Current reviewed citations do not record the explicit fact required by this constraint."
                )
            )
            if dimension == "commercial-use" and reason == "needs-input":
                detail = (
                    "已有带适用范围的商用条款；请明确实际直连/网关渠道、免费或付费层级、服务使用国家及部署方式。其他渠道不能继承此许可。"
                    if language == "zh"
                    else "Scoped commercial terms are available. Specify the actual service channel, free/paid tier, country of service use and deployment. Other channels cannot inherit these terms."
                )
            if scoped_quote:
                detail = (
                    "已有 Standard token 报价，但总预算还包含未核算的工具、缓存等支出。保留总预算要求时需核验这些费用；仅在原要求就是 token 预算时选择对应核算范围。"
                    if context.budget.cost_scope == "all-costs" and language == "zh"
                    else "已有分档报价，但请求长度与费用区间尚不能证明预算满足。请核对每个请求的输入上限；区间跨预算时不能按最低档认定通过。"
                    if language == "zh"
                    else "A Standard token quote exists, but all-cost budgeting also includes unverified tool, cache and other charges. Keep the total-cost requirement unless your original scope is token-only."
                    if context.budget.cost_scope == "all-costs"
                    else "Tiered quotes exist, but request lengths and cost bounds do not establish budget fit. Check the maximum input per request; do not assume the lowest tier when the range crosses the ceiling."
                )
            gaps.append(
                DecisionGap(dimension=dimension, reason=reason, detail=detail, claim_ids=hints)
            )
        for feature in scenario.required_features:
            if feature not in {finding.dimension for finding in strengths}:
                label = CATALOG["features"][feature]["name"][language]
                gaps.append(
                    DecisionGap(
                        dimension=feature,
                        reason="not-recorded",
                        detail=(
                            f"当前引用没有明确描述{label}；目录介绍仅用于发现候选。"
                            if language == "zh"
                            else f"Current citations do not explicitly describe {label}; catalog summaries are discovery hints only."
                        ),
                    )
                )
        candidates.append(
            row.model_copy(
                update={
                    "strengths": strengths,
                    "gaps": gaps,
                    "fit_state": "described" if strengths else "unverified",
                }
            )
        )
        if row.reasons:
            next_checks.append(f"{name(row.entity_id)}: " + "；".join(row.reasons))
    eligible = [row.entity_id for row in candidates if row.eligibility == "eligible"]
    validation = [row.entity_id for row in candidates if row.eligibility in {"eligible", "unknown"}]
    primary = result.recommendation.primary_entity_id
    if primary and (
        primary not in eligible
        or len(eligible) != 1
        or (
            scenario.required_features
            and not set(scenario.required_features).issubset(
                finding.dimension
                for finding in next(row for row in candidates if row.entity_id == primary).strengths
            )
        )
    ):
        primary = None
    basis = "sole-eligible" if primary else "comparison-only"
    reasons = []
    # A lower price cannot compensate for an undocumented required workflow.
    business_eligible = [
        row.entity_id
        for row in candidates
        if row.entity_id in eligible
        and set(scenario.required_features) <= {finding.dimension for finding in row.strengths}
    ]
    winner, cost_claims = cost_choice(context, business_eligible, claims_by_entity)
    if winner and result.status != "conflict":
        primary = winner
        basis = "comparable-cost"
        reasons.append(
            DecisionTradeoff(
                dimension="api-price",
                finding=(
                    "在相同币种、渠道和单位下，此候选的指定工作量 API 费用更低，或输入和输出单价均不高于其他候选。总成本与任务效果仍须验证。"
                    if language == "zh"
                    else "At the same currency, channel and unit, this candidate has lower API fees for the stated workload, or both rates are no higher than the alternatives. Total cost and task results still need validation."
                ),
                claim_ids=cost_claims,
            )
        )
    if not primary and eligible and scenario.required_features and result.status != "conflict":
        complete = [
            row.entity_id
            for row in candidates
            if row.entity_id in eligible
            and set(scenario.required_features) <= {finding.dimension for finding in row.strengths}
        ]
        if len(complete) == 1:
            primary, basis = complete[0], "validation-sequence"
    if primary:
        candidate = next(row for row in candidates if row.entity_id == primary)
        reasons.extend(candidate.strengths)
        if not reasons:
            reasons = [
                DecisionTradeoff(
                    dimension="eligibility",
                    finding=(
                        "这是本次范围中唯一通过已指定硬条件的候选；用途效果尚未实测。"
                        if language == "zh"
                        else "This is the sole candidate verified against the selected hard constraints; business results are untested."
                    ),
                    claim_ids=candidate.claim_ids,
                )
            ]
        summary = (
            f"优先验证 {name(primary)}。"
            if language == "zh"
            else f"Validate {name(primary)} first. "
        ) + reasons[0].finding
        alternatives = [key for key in eligible if key != primary]
        if alternatives:
            summary += (
                f" 备选 {'、'.join(name(key) for key in alternatives[:3])} 也通过已指定硬条件，适用功能与实际效果需按下方依据核对。"
                if language == "zh"
                else f" Alternatives {', '.join(name(key) for key in alternatives[:3])} also pass the selected constraints; inspect their described features and test actual results."
            )
    else:
        alternatives = eligible
        summary = result.recommendation.summary
        if eligible and result.status != "conflict":
            summary = (
                f"{'、'.join(name(key) for key in eligible[:3])} 可进入同一轮业务验证。已知硬条件通过，但缺少能区分主选和备选的同口径依据；按下方功能差异安排样本。"
                if language == "zh"
                else f"{', '.join(name(key) for key in eligible[:3])} can enter the same business trial. Selected constraints pass, but comparable evidence does not distinguish a primary from alternatives; design samples around the feature differences below."
            )
        if not candidates:
            summary = (
                "当前没有召回与本场景相符且具备当前审核引用的具体候选。请明确业务用途、选择对象类型或指定候选；系统不会用随机资料填充。"
                if language == "zh"
                else "No concrete candidate with current reviewed citations was retrieved for this scenario. Specify the business use, selection type or candidates; unrelated sources will not fill the result."
            )
    if scenario.id == "coding-workspace" and not primary and result.status != "conflict":
        functional = [
            row
            for row in candidates
            if row.claim_ids
            and set(scenario.required_features) <= {item.dimension for item in row.strengths}
        ]
        if functional:
            if all(row.eligibility == "eligible" for row in functional):
                summary = (
                    f"{'、'.join(name(row.entity_id) for row in functional)} 的现有引用覆盖本次要求的功能，可进入同一轮仓库验证。"
                    "其他候选的必要功能仍需补充核验。当前没有同口径实测，不能判定谁效果更好。"
                    if language == "zh"
                    else f"Current citations describe the requested features for {', '.join(name(row.entity_id) for row in functional)}; compare them in the same repository trial. "
                    "Other candidates still need required-feature verification. No comparable measurements establish a quality winner."
                )
            else:
                summary = (
                    f"就本次要求的功能，{'、'.join(name(row.entity_id) for row in functional)} 有明确引用，可先比较其工作流。"
                    "这只是功能候选清单，不是效果排名或适配推荐；已指定硬条件仍须核验，真实仓库效果尚未实测。"
                    if language == "zh"
                    else f"{', '.join(name(row.entity_id) for row in functional)} have cited descriptions for the requested features. "
                    "This is a functional shortlist, not a quality ranking or eligibility recommendation. Selected constraints and actual repository results still require verification."
                )
        next_checks.extend(
            [
                "在同一仓库比较三类任务：修复一个已有失败测试、增加功能并补测试、跨文件重构；记录补丁、实际测试命令、退出码、人工修改量与用时。"
                if language == "zh"
                else "Use the same repository for a failing-test fix, a feature with tests, and a cross-file refactor. Record patches, actual test commands, exit codes, human edits and elapsed time.",
                "确认实际使用入口和底层模型。仓库可检索不等于单次模型上下文；云端编码任务不等于模型 API。若这些门槛来自上一题，应在表单中明确修改后重新分析。"
                if language == "zh"
                else "Confirm the product interface and underlying model. Repository retrieval is not single-request context; cloud coding tasks are not model API access. Explicitly revise inherited constraints in the form before reanalysis.",
            ]
        )
    if context.priority == "cost" and not winner and set(business_eligible) != set(eligible):
        summary += (
            " 必要业务功能仍有缺口，不能仅凭价格指定成本主选。"
            if language == "zh"
            else " Required workflow features remain unverified; price alone cannot establish a cost choice."
        )
    elif context.priority == "cost" and not winner:
        summary += (
            (
                " 同口径 API 单价相同或输入输出存在取舍，尚不能确定唯一成本主选。"
                if cost_claims
                else " API 价格缺少可比依据，暂不能判定谁成本更低。"
            )
            if language == "zh"
            else (
                " Comparable API rates tie or trade off input against output; no unique cost choice is established."
                if cost_claims
                else " Comparable API prices are missing; a lower-cost choice is not established."
            )
        )
    tradeoffs = list(result.tradeoffs)
    for row in candidates:
        if row.strengths:
            tradeoffs.append(
                DecisionTradeoff(
                    dimension="business-fit",
                    finding=f"{name(row.entity_id)}: "
                    + " ".join(dict.fromkeys(item.finding for item in row.strengths)),
                    claim_ids=list(
                        dict.fromkeys(key for item in row.strengths for key in item.claim_ids)
                    ),
                )
            )
    next_checks += [
        gap.detail
        for row in candidates
        if not row.claim_ids
        for gap in row.gaps
        if gap.dimension == "evidence"
    ]
    next_checks += result.next_checks[:2]
    explained = result.model_copy(
        update={
            "scenario": scenario,
            "candidates": candidates,
            "tradeoffs": tradeoffs,
            "next_checks": list(dict.fromkeys(next_checks)),
            "comparisons": [
                *result.comparisons,
                *[
                    DecisionComparison(
                        id="feature-" + feature,
                        dimension=CATALOG["features"][feature]["name"][language],
                        cells=[
                            DecisionComparisonCell(
                                entity_id=row.entity_id,
                                state="supported"
                                if any(item.dimension == feature for item in row.strengths)
                                else "unknown",
                                facts=[item for item in row.strengths if item.dimension == feature],
                            )
                            for row in candidates
                        ],
                    )
                    for feature in scenario.required_features
                    if not (
                        feature in {"code-editing", "tool-use"}
                        and {"file-editing", "test-execution"} <= set(scenario.required_features)
                    )
                ],
            ],
            "recommendation": result.recommendation.model_copy(
                update={
                    "primary_entity_id": primary,
                    "alternative_entity_ids": alternatives,
                    "validation_entity_ids": validation,
                    "basis": basis,
                    "reasons": reasons,
                    "summary": summary,
                }
            ),
        }
    )
    plan = build_plan(explained, context, language)
    recommendation = explained.recommendation
    if plan.state != "ready-to-validate":
        # API consumers and exports must not repeat the earlier hard-condition
        # shortlist as permission to trial an unverified required workflow.
        guidance = plan.can_decide
        if plan.actions:
            guidance += (
                " " + plan.actions[0].title + "。"
                if language == "zh"
                else " " + plan.actions[0].title + "."
            )
        if context.priority == "cost" and not winner and set(business_eligible) != set(eligible):
            guidance += (
                " 必要业务功能仍有缺口，不能仅凭价格指定成本主选。"
                if language == "zh"
                else " Required workflow features remain unverified; price alone cannot establish a cost choice."
            )
        recommendation = recommendation.model_copy(
            update={
                "primary_entity_id": None,
                "alternative_entity_ids": [],
                "validation_entity_ids": [],
                "basis": "comparison-only",
                "reasons": [],
                "summary": guidance,
            }
        )
    else:
        qualified = set(plan.trial_candidate_ids)
        recommendation = recommendation.model_copy(
            update={
                "primary_entity_id": recommendation.primary_entity_id
                if recommendation.primary_entity_id in qualified
                else None,
                "alternative_entity_ids": [
                    key for key in recommendation.alternative_entity_ids if key in qualified
                ],
                "validation_entity_ids": list(plan.trial_candidate_ids),
            }
        )
        if recommendation.primary_entity_id:
            primary_name = name(recommendation.primary_entity_id)
            guidance = (
                f"优先验证 {primary_name}。现有引用覆盖必要功能；实际业务效果仍需按下方方案验证。"
                if language == "zh"
                else f"Validate {primary_name} first. Current citations cover required features; actual business results require the trial below."
            )
            if recommendation.alternative_entity_ids:
                alternative_names = [name(key) for key in recommendation.alternative_entity_ids]
                guidance += (
                    f" 可同轮验证：{'、'.join(alternative_names[:3])}。"
                    if language == "zh"
                    else f" Also qualified for the same trial: {', '.join(alternative_names[:3])}."
                )
            if {row.entity_id for row in candidates} - qualified:
                guidance += (
                    " 其他候选尚未核验必要条件或功能，不列为可试用备选。"
                    if language == "zh"
                    else " Other candidates with unverified constraints or required features are not trial alternatives."
                )
            recommendation = recommendation.model_copy(update={"summary": guidance})
        if not recommendation.primary_entity_id and scenario.id != "coding-workspace":
            recommendation = recommendation.model_copy(
                update={
                    "summary": (
                        f"{'、'.join(name(key) for key in plan.trial_candidate_ids[:3])} 的现有引用覆盖必要功能，可进入同一轮业务验证；当前没有同口径实测，不能判定谁效果最好。"
                        if language == "zh"
                        else f"Current citations cover required features for {', '.join(name(key) for key in plan.trial_candidate_ids[:3])}; they qualify for the same business trial. No comparable measurements establish a quality winner."
                    )
                }
            )
    return explained.model_copy(update={"plan": plan, "recommendation": recommendation})
