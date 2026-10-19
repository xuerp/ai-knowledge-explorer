"""One authoritative, versioned recommendation for the page and every export."""

import re

from .decision_dialogue import clarification_for, unsupported_task
from .decision_intent import CATALOG
from .decision_task import daily_workload, understand_task
from .schemas import (
    DecisionClarification,
    DecisionClarificationOption,
    DecisionGuidance,
    DecisionGuidanceRecommendation,
    DecisionGuidanceUnknown,
    DecisionIntentField,
    DecisionNextAction,
    DecisionTradeoff,
)


def build_guidance(result, context, snapshot, language):
    t = lambda zh, en: zh if language == "zh" else en
    entities = {entity.id: entity for entity in snapshot.entities}
    name = lambda key: getattr(entities[key].name, language) if key in entities else key
    question = clarification_for(context, language)
    if (
        not question
        and result.missing_inputs
        and len(context.intent_answers) < 2
        and not any(answer.option_id == "unknown" for answer in context.intent_answers)
        and not any(answer.question_id == "cost-basis" for answer in context.intent_answers)
    ):
        question = DecisionClarification(
            id="cost-basis",
            question=t(
                "这次需要核验预算，还是先确定功能路线？",
                "Do you need a budget decision now, or a functional route first?",
            ),
            reason=t(
                "预算要求会保留。核验费用需要同一渠道、币种及工作量；未知不会按免费处理。",
                "Your budget requirement stays. Cost verification needs a common channel, currency and workload; unknown is not free.",
            ),
            options=[
                DecisionClarificationOption(
                    id="keep-budget",
                    label=t("保留预算，查看缺少什么", "Keep the budget; show missing inputs"),
                    description=t(
                        "不降低上限，列出核算所缺的输入。",
                        "Retain the ceiling and list inputs needed for an estimate.",
                    ),
                ),
                DecisionClarificationOption(
                    id="functional-route",
                    label=t("先看功能路线", "See the functional route first"),
                    description=t(
                        "只判断已知功能；费用是否符合仍保持未确认。",
                        "Consider documented features; budget fit remains unverified.",
                    ),
                ),
            ],
        )
    if (
        question
        and question.id == "cost-basis"
        and daily_workload(context.task)
        and not any(answer.question_id == "monthly-days" for answer in context.intent_answers)
        and any(key.startswith("monthly-") for key in result.missing_inputs)
    ):
        question = DecisionClarification(
            id="monthly-days",
            question=t(
                "每月按多少个运行日核算这笔预算？",
                "How many active days per month should this budget cover?",
            ),
            reason=t(
                "已保留每天调用量、每次输入输出和预算上限。只需确认月运行日；不会默认汇率或把未知费用当免费。",
                "Daily calls, per-call tokens and budget are retained. Confirm active days; exchange rates and unknown costs will not be assumed.",
            ),
            options=[
                DecisionClarificationOption(
                    id=f"days-{days}",
                    label=t(f"按 {days} 天核算", f"Use {days} days"),
                    description=t(
                        "这是你选择的工作量口径，不代表费用已通过。",
                        "This selects workload assumptions, not a verified cost.",
                    ),
                )
                for days in (22, 30)
            ],
        )
    intent = [DecisionIntentField(field="goal", value=context.task, source="user-input")]
    intent.extend(
        DecisionIntentField(
            field="condition",
            value=value,
            source="assumption"
            if any(word in value for word in ("balanced", "undecided", "unknown"))
            else "user-input",
        )
        for value in result.conditions
        if not value.startswith(("任务：", "Task:"))
    )
    intent.extend(
        DecisionIntentField(
            field=answer.question_id,
            value=answer.text or answer.option_id or "",
            source="user-input" if answer.text else "user-choice",
        )
        for answer in context.intent_answers
    )
    task = understand_task(context.task)
    materials = task.materials
    intent.extend(
        DecisionIntentField(field="constraint", value=limit, source="user-input")
        for limit in task.limits
    )
    if task.time_limit:
        intent.append(
            DecisionIntentField(field="time-limit", value=task.time_limit, source="user-input")
        )
    if materials:
        intent.append(
            DecisionIntentField(
                field="materials", value="、".join(dict.fromkeys(materials)), source="user-input"
            )
        )
    ready = list(result.plan.trial_candidate_ids) if result.plan else []
    rows = {row.entity_id: row for row in result.candidates}
    all_excluded = bool(rows) and all(row.eligibility == "excluded" for row in rows.values())
    if all_excluded:
        question = None
    unknowns = []
    for row in rows.values():
        for gap in row.gaps:
            unknowns.append(
                DecisionGuidanceUnknown(
                    candidate_id=row.entity_id,
                    requirement=gap.dimension,
                    kind="not-tested" if gap.reason == "requires-poc" else gap.reason,
                    decisive=row.entity_id not in ready and gap.reason != "requires-poc",
                    detail=gap.detail,
                    affects=t("此候选的必要条件判断", "This candidate's required-condition fit")
                    if row.entity_id not in ready
                    else t(
                        "对应维度的比较，其他已知功能仍可参考",
                        "Comparison on this dimension; other documented features remain useful",
                    ),
                    recovery=t(
                        "在实际产品完成任务后，可选择记录结果。",
                        "Optionally record the outcome after using the actual product.",
                    )
                    if gap.reason == "requires-poc"
                    else t(
                        "系统资料需核对具体版本与适用范围；当前保留未知。",
                        "The knowledge base needs exact-version and scope verification; this remains unknown.",
                    ),
                    claim_ids=gap.claim_ids,
                    checked_at=result.as_of,
                )
            )
    primary = (
        result.recommendation.primary_entity_id
        if result.recommendation.primary_entity_id in ready
        else None
    )
    existing = []
    if re.search(
        r"已有|已经|目前|正在用|只有|在用|using|already|currently|have", context.task, re.IGNORECASE
    ):
        existing = [
            key
            for key in ready
            if any(
                len(label) > 1 and label.casefold() in context.task.casefold()
                for label in [
                    entities[key].name.zh,
                    entities[key].name.en,
                    *(entities[key].aliases or []),
                ]
            )
        ]
    if len(existing) == 1:
        primary = existing[0]
        intent.append(
            DecisionIntentField(field="existing-tool", value=name(primary), source="user-input")
        )
    reasons = list(result.recommendation.reasons or [])
    if primary and rows[primary].strengths:
        reasons = list(rows[primary].strengths[:2])
    if len(existing) == 1:
        reasons.append(
            DecisionTradeoff(
                dimension="switching-effort",
                finding=t(
                    "你已在使用此工具；在满足必要条件的范围内，可减少重新配置和迁移。",
                    "You already use this tool; within verified requirements this avoids setup and migration.",
                ),
                claim_ids=[],
            )
        )
    boundary = t(
        "公开资料支持功能和条件判断；实际效果、你的账户权限及最终费用仍以实际使用为准。",
        "Public evidence supports feature and condition checks; actual results, account access and final charges remain unmeasured.",
    )
    if context.budget.mode == "unknown":
        boundary += t(" 费用未估算，不表示免费。", " Cost is not estimated, not assumed free.")
    headline = (
        t(f"建议先用 {name(primary)}", f"Start with {name(primary)}")
        if primary
        else t("这些方案满足已核验的必要功能", "These options meet the verified required features")
    )
    summary = result.recommendation.summary
    kind, label = "start", t("查看上手步骤", "See how to start")
    instruction = (
        result.plan.trial.procedure[0]
        if result.plan and result.plan.trial
        else t(
            "先准备一份与你任务相关、可以使用的材料，核对所选产品的使用入口。",
            "Prepare one authorized task sample and check the selected product's interface.",
        )
    )
    starter = {
        "knowledge-workspace": (
            "先按操作资料配置模型与文档知识库，确认数据去向。导入一份允许使用的文档，问一个原文中有答案的问题，再打开引用核对出处；无依据时应明确说不知道。",
            "Configure a model and document knowledge base using the linked documentation; check data destinations. Import one authorized document, ask an answerable question and verify its cited passage. Missing evidence should be reported as unknown.",
        ),
        "coding-workspace": (
            "在你已有的编码工具中打开相关仓库，提供一个真实报错、相关文件和测试命令。先让工具完成一个小修复，检查补丁并运行测试；不要从完整重构开始。",
            "Open the repository in your existing coding tool. Supply one real error, relevant files and a test command. Start with one small fix, inspect the patch and run the tests.",
        ),
        "general-text": (
            "提供一份可以使用的材料，说明读者和需要的格式，先生成一个短初稿。逐项核对原文事实，保留缺失信息，不让工具补造。",
            "Provide authorized material, the audience and desired format, then produce a short first draft. Check every factual statement against the source and leave missing information unknown.",
        ),
        "document-extraction": (
            "准备一份脱敏文件和需要提取的字段，在所选模型的实际入口提交一个样本，要求缺失字段留空并标出原文位置。核对字段和格式后再扩大处理量。",
            "Prepare one redacted file and required fields. Submit one sample at the chosen model's interface, leaving missing fields empty and locating source passages. Check fields and format before scaling up.",
        ),
    }.get(result.scenario.id)
    if starter:
        instruction = t(*starter)
    if result.scenario.id == "coding-workspace" and result.plan and result.plan.trial:
        instruction = " ".join(result.plan.trial.procedure)
    outcome = "advice" if ready else "conditional"
    tradeoff = None
    if ready and not primary:
        summary = t(
            f"{'、'.join(name(key) for key in ready[:3])} 有本次必要功能的资料依据。目前没有足够差异证据指定唯一优先方案。先比较与你相关的使用方式和限制；无需逐个测试才能继续。",
            f"{', '.join(name(key) for key in ready[:3])} have evidence for the required features. Available differences do not establish one preferred option. Compare relevant interfaces and limits; testing every option is not required.",
        )
        reasons = [
            DecisionTradeoff(
                dimension=feature,
                finding=t(
                    f"本次需要{CATALOG['features'][feature]['name']['zh']}；这些方案的已审核资料覆盖这项功能。",
                    f"This task needs {CATALOG['features'][feature]['name']['en']}; these options have reviewed evidence for that feature.",
                ),
                claim_ids=list(
                    dict.fromkeys(
                        claim
                        for entity in ready
                        for strength in rows[entity].strengths
                        if strength.dimension == feature
                        for claim in strength.claim_ids
                    )
                ),
            )
            for feature in result.scenario.required_features[:3]
        ]
        kind, label = "compare", t("比较使用方式与限制", "Compare interfaces and limits")
        instruction = t(
            "查看下面的已知差异；有现成入口时可先从该方案开始，尚未核验的条件仍保留。",
            "Inspect the documented differences below. An existing interface can reduce setup; unverified conditions remain unknown.",
        )
    elif primary:
        summary = t(
            f"先用 {name(primary)} 处理本次的{result.scenario.name}任务。现有资料覆盖必要功能。",
            f"Use {name(primary)} for this {result.scenario.name} task. Current evidence covers the required features.",
        )
        if len(existing) == 1:
            summary = t(
                f"可以先继续用 {name(primary)}，目前没有依据要求你为这件工作换工具。它满足本次已核验的必要条件；遇到明确功能限制或实际任务不通过时，再考虑替换。",
                f"Continue with {name(primary)} for now. There is no evidence here requiring a switch for this job. It meets verified requirements; reconsider if a concrete feature limit or task failure appears.",
            )
        if result.scenario.id == "knowledge-workspace":
            tradeoff = t(
                "这是需要配置模型与知识库的应用平台；自托管平台不代表模型也在本地。",
                "This platform needs model and knowledge-base configuration; self-hosting the platform does not make its model local.",
            )
        elif result.scenario.id in {
            "coding-model",
            "knowledge-assistant",
            "document-extraction",
            "career-assistant",
            "general-text",
        }:
            tradeoff = t(
                "当前对象是模型，接入应用仍需代码或现有工具；型号资料不能证明你的账户已开通。",
                "These are models; application access requires integration or an existing tool. Model documentation does not establish account access.",
            )
        if result.recommendation.basis == "comparable-cost":
            # Keep the server's scoped price range and calculation assumptions.
            summary = result.recommendation.summary
            reasons = list(result.recommendation.reasons or reasons)
    if not ready:
        headline = t(
            "先按已知功能确定路线，必要条件仍待核验",
            "Choose a route from known features; required conditions remain unverified",
        )
        summary = t(
            "当前资料库尚不能确认这批候选完整满足你的要求。已有功能依据可以参考；未收录不表示不支持。",
            "The current knowledge base cannot establish full fit for these candidates. Documented features remain useful; missing records do not mean unsupported.",
        )
        decisive = [gap for gap in unknowns if gap.decisive]
        if decisive:
            summary += " " + " ".join(dict.fromkeys(gap.detail for gap in decisive[:2]))
        kind, label = "routes", t("查看已知功能与限制", "View known features and limits")
        instruction = t(
            "保留当前要求，查看具体缺口与可成立的局部判断；资料维护在依据详情中按需查看。",
            "Keep the requirements and inspect specific gaps and bounded findings; maintenance is optional in evidence details.",
        )
        # Partial feature evidence remains useful, but does not qualify a
        # candidate against the user's unchanged budget or other hard gates.
        reasons = [
            DecisionTradeoff(
                dimension=strength.dimension,
                finding=f"{name(row.entity_id)}：{strength.finding}",
                claim_ids=strength.claim_ids,
            )
            for row in rows.values()
            if row.eligibility != "excluded"
            for strength in row.strengths[:1]
            if strength.claim_ids
        ][:3]
        if any(answer.option_id == "functional-route" for answer in context.intent_answers):
            summary = (
                t(
                    "可以先依据下列已核验功能缩小接入路线；这些局部依据尚不能证明候选满足预算。原预算上限和其他必要条件保持不变，费用结论仍未确认。",
                    "Use the documented features below to narrow the integration route. Partial feature evidence does not establish budget fit. Your budget ceiling and other requirements remain unchanged; cost remains unverified.",
                )
                if reasons
                else summary
            )
    if all_excluded:
        outcome, kind, label = (
            "blocked",
            "edit",
            t("修改条件或候选", "Edit requirements or candidates"),
        )
        headline = t("这批候选不符合必要条件", "These candidates fail the required conditions")
        summary = "；".join(
            dict.fromkeys(reason for row in rows.values() for reason in row.reasons)
        )
        instruction = t(
            "查看明确排除原因。只有你主动修改要求后，才按新条件重新分析。",
            "Inspect the verified exclusions. Requirements change only when you explicitly edit them.",
        )
    uncertain = any(answer.option_id == "unknown" for answer in context.intent_answers)
    personal_career = any(answer.option_id == "use-career" for answer in context.intent_answers)
    novice_writing = (
        result.scenario.id == "general-text"
        and context.task_type == "unspecified"
        and not re.search(r"模型|API|model", context.task, re.IGNORECASE)
    )
    unresolved = result.scenario.id == "unspecified" and bool(context.intent_answers)
    if (
        not question
        and not all_excluded
        and (uncertain or personal_career or novice_writing or unresolved)
    ):
        outcome, primary, ready, reasons = "conditional", None, [], []
        headline = t(
            "先从现成工具的一件小任务开始", "Start with one small task in an existing tool"
        )
        summary = t(
            "如果是自己使用，先用已有对话或写作工具处理一份材料；如果要给多人使用并自动处理，才进入应用搭建与模型接入路线。当前尚不能据此指定具体产品。",
            "For personal use, start with one document in an existing chat or writing tool. For shared automated use, consider building an application and integrating a model. A specific product is not established yet.",
        )
        if personal_career:
            summary = t(
                "建议先走现成工具路线，整理一份脱敏简历与一条岗位说明，让工具列出匹配项和缺失信息，再由你确认事实。暂时不需要开发求职产品或先选 API。当前没有核验具体成品的账户入口。",
                "Start with an existing tool: supply a redacted resume and one job description, ask for matches and missing information, then check facts. You do not need to build a product or choose an API first. A specific finished-product interface has not been verified.",
            )
        instruction = t(
            "准备一份可使用的材料，在你已有工具中说明想得到的结果；核对原文，不让工具编造缺失事实。硬条件尚未核验时，不发送受限制材料。",
            "Prepare one authorized document and describe the desired result in your existing tool. Check against the source and leave missing facts unknown. Do not send restricted material while mandatory conditions remain unverified.",
        )
        kind, label = "start", t("查看上手步骤", "See how to start")
        tradeoff = t(
            "这是一条有前提的使用路线，尚未确认具体工具满足所有条件。",
            "This is a conditional route, not confirmation that a specific tool meets every requirement.",
        )
    if unsupported_task(context):
        outcome, primary, ready, reasons = "unsupported", None, [], []
        headline = t(
            "这类任务尚未纳入可核验选型范围", "This task is outside the verified selection scope"
        )
        summary = t(
            f"已保留「{context.task}」。当前覆盖文档问答、文本处理、编码与 Agent 开发，不能用这些候选替代你的任务。可以先明确材料、输出形式及使用限制，后续据此核验对应产品。",
            f"Your request “{context.task}” is retained. Current coverage includes document Q&A, text processing, coding and agent development; those candidates cannot substitute for this task. Define materials, output and use constraints for a later product evaluation.",
        )
        kind, label = "routes", t("查看支持范围", "View supported scope")
        instruction = t(
            "如果你的工作还包含文案、资料整理或代码开发，可以单独为这些部分分析；原任务仍未完成选型。",
            "If the job also includes writing, document organization or coding, those parts can be evaluated separately; selection for the original task remains unresolved.",
        )
    if question:
        outcome, primary, ready, reasons = "clarify", None, [], []
        headline, summary = question.question, question.reason
        kind, label, instruction = (
            "answer",
            t("选择方向继续", "Choose a direction"),
            t(
                "原题与条件已保留，选择后在这里继续。",
                "Your original task and requirements are retained; continue here after choosing.",
            ),
        )
    return DecisionGuidance(
        outcome=outcome,
        intent=intent,
        tasks=[
            part.strip()
            for part in re.split(
                r"[；;\n]|同时|还要|还想|也想|以及|\band also\b",
                context.task,
                flags=re.IGNORECASE,
            )
            if part.strip()
        ]
        or [context.task],
        answered=context.intent_answers,
        clarification=question,
        recommendation=DecisionGuidanceRecommendation(
            headline=headline,
            summary=summary,
            entity_ids=ready,
            primary_entity_id=primary,
            reasons=reasons[:3],
            tradeoff=tradeoff,
            premises=[boundary],
        ),
        unknowns=unknowns,
        next_action=DecisionNextAction(
            kind=kind,
            label=label,
            target_ids=ready,
            location="this-page" if kind != "start" else "selected-product",
            instruction=instruction,
        ),
    )
