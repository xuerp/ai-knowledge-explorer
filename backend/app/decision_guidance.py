"""One authoritative, versioned recommendation for the page and every export."""

import re

from .decision_dialogue import clarification_for, task_descriptions, unsupported_task
from .decision_intent import CATALOG, scenario_definition, task_workflow
from .decision_semantics import context_meaning
from .decision_stages import ordered_task_stages, parallel_task_deliverables
from .decision_task import daily_workload, understand_context
from .decision_tool_context import tool_context
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
    task = understand_context(context)
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
    user_tools = tool_context(context, entities.values())
    existing = [key for key in ready if key in user_tools.entity_ids]
    preferred_existing = existing if user_tools.reuse else []
    intent.extend(
        DecisionIntentField(field="existing-tool", value=quote, source="user-input")
        for quote in user_tools.references
    )
    intent.extend(
        DecisionIntentField(field="existing-tool", value=quote, source="assumption")
        for quote in user_tools.interpreted_references
    )
    if len(preferred_existing) == 1:
        primary = preferred_existing[0]
    reasons = list(result.recommendation.reasons or [])
    if primary and rows[primary].strengths:
        reasons = list(rows[primary].strengths[:2])
    if len(preferred_existing) == 1:
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
        if result.plan and result.plan.trial:
            # A tie in product evidence does not block the user's actual task.
            # Keep every qualified option and avoid inventing a winner, while
            # making the same scoped protocol available before product choice.
            headline = t("先按本次任务做小范围验证", "Start with a bounded trial of your task")
            summary = t(
                f"{'、'.join(name(key) for key in ready[:3])} 有本次必要功能的资料依据。先确认其中一个你能使用的入口，再执行下方任务；无需逐个比较或测试才能开始。",
                f"{', '.join(name(key) for key in ready[:3])} have evidence for the required features. Confirm one interface you can use, then follow the task below; comparing or testing every option is not required to start.",
            )
            tradeoff = t(
                "现有差异证据不足以指定唯一优先方案；实际任务效果和你的账户可用性尚未核验。候选差异可在依据详情中按需查看。",
                "Available differences do not establish one preferred option; task results and your account access are unverified. Candidate differences remain available in the optional evidence details.",
            )
            kind, label = "start", t("查看上手步骤", "See how to start")
            instruction = " ".join(result.plan.trial.procedure)
        else:
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
        if len(preferred_existing) == 1:
            summary = t(
                f"可以先继续用 {name(primary)}，目前没有依据要求你为这件工作换工具。它满足本次已核验的必要条件；遇到明确功能限制或实际任务不通过时，再考虑替换。",
                f"Continue with {name(primary)} for now. There is no evidence here requiring a switch for this job. It meets verified requirements; reconsider if a concrete feature limit or task failure appears.",
            )
        if result.scenario.id == "knowledge-workspace":
            tradeoff = t(
                "这是需要配置模型与知识库的应用平台；自托管平台不代表模型也在本地。",
                "This platform needs model and knowledge-base configuration; self-hosting the platform does not make its model local.",
            )
            if re.search(
                r"权限|部门|旧版|新版|过期|access|department|version", context.task, re.IGNORECASE
            ):
                outcome = "conditional"
                headline = t(
                    f"先在 {name(primary)} 验证权限与生效版本",
                    f"Verify access and effective versions in {name(primary)} first",
                )
                summary = t(
                    f"可以先在 {name(primary)} 做隔离试点。当前资料支持文档导入与检索，但不能据此确认你要求的逐文档访问隔离和版本生效控制已经满足；先用指定的虚构样本核验这两项门槛，通过前不接入真实受限文档。",
                    f"Pilot {name(primary)} in isolation. Document import and retrieval evidence does not establish the requested document-level access isolation or version controls. Verify both gates with the requested fictional samples before connecting restricted documents.",
                )
                if primary in existing:
                    summary = (
                        t("沿用你已说明的现有平台。", "Reuse the platform you identified. ")
                        + summary
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
    workflow = task_workflow(context.task, context_meaning(context))
    if (
        result.plan
        and result.plan.trial
        and not question
        and not all_excluded
        and (workflow or primary)
    ):
        # The main action and exports must describe the same executable plan.
        instruction = " ".join(result.plan.trial.procedure)
        kind, label = "start", t("查看上手步骤", "See how to start")
        if workflow:
            outcome, primary, ready, reasons = "conditional", None, [], []
            headline = (
                t("先按这条路线小范围验证：", "Start with a bounded route: ")
                + workflow["name"][int(language == "en")]
            )
            summary = workflow["route"][int(language == "en")]
    if (
        result.scenario.id == "knowledge-workspace"
        and user_tools.reuse
        and not existing
        and not question
        and not all_excluded
        and result.plan
        and result.plan.trial
    ):
        outcome, primary, ready = "conditional", None, []
        headline = t("先验收你描述的问答服务", "Validate the Q&A service you described first")
        summary = t(
            "先确认所述服务的获准测试入口，按原题范围准备材料、问题和人工预期，再执行下方验收步骤；能力缺失记录为待整改，尚不能宣称服务通过验收。",
            "Confirm an authorized test interface for the described service. Prepare materials, questions and human expectations within the requested scope, then run the acceptance steps below. Record missing capabilities for remediation; the service has not passed acceptance yet.",
        )
        reasons = [
            DecisionTradeoff(
                dimension="existing-workflow",
                finding=t(
                    "按本次要求组织服务验收，不增加更换平台或新建知识库的前提。",
                    "Organize service acceptance around this request without requiring a platform switch or a new knowledge base.",
                ),
                claim_ids=[],
            )
        ]
        unknowns = [
            DecisionGuidanceUnknown(
                requirement="existing-service-capabilities",
                kind="not-tested",
                decisive=False,
                detail=t(
                    "未核验该服务的权限、版本及引用实现。",
                    "The service's access, version and citation implementation is unverified.",
                ),
                affects=t("本服务的验收结论", "Acceptance of this service"),
                recovery=t(
                    "按下方矩阵检查并保留实际结果；缺项记录待整改。",
                    "Run the matrix below, retain actual results and record gaps for remediation.",
                ),
                checked_at=result.as_of,
            )
        ]
        tradeoff = t(
            "现有服务是否满足要求取决于实际验收，不能由其他平台的公开资料代证。",
            "Other platforms' public documentation cannot establish this service's acceptance.",
        )
        instruction = " ".join(result.plan.trial.procedure)
        kind, label = "start", t("查看上手步骤", "See how to start")
    if (
        user_tools.reuse
        and result.scenario.id in {"general-text", "coding-workspace"}
        and not preferred_existing
        and not question
        and not all_excluded
        and result.plan
        and result.plan.trial
    ):
        # A request to operate an existing interface is not product selection.
        # Catalog competitors cannot prove that interface's capabilities.
        outcome, primary, ready, reasons = "conditional", None, [], []
        headline = t("先在你现有的工具中完成这项任务", "Start in your existing tool")
        summary = (
            workflow["route"][int(language == "en")]
            if workflow
            else t(
                "沿用你指定的入口，按下方原题步骤处理获准材料，逐项保留实际交付与依据；先检查文件输入和操作边界，能力缺失时记录具体阻塞，再考虑更换工具。",
                "Use your stated interface and the steps below on authorized inputs, retaining each deliverable and source. Check input support and operation boundaries first; record concrete capability gaps before considering a switch.",
            )
        )
        tradeoff = t(
            "尚未核验你当前入口的能力和账户权限；这份任务说明没有执行，也不代表其他工具更好。",
            "Your interface's capabilities and account access remain unverified. This task has not run and does not establish another product's superiority.",
        )
        instruction = " ".join(result.plan.trial.procedure)
        kind, label = "start", t("复制任务到现有工具", "Copy the task to your existing tool")
    if (
        primary
        and result.scenario.id == "knowledge-workspace"
        and re.search(r"扫描|OCR|scanned", context.task, re.IGNORECASE)
    ):
        outcome = "conditional"
        headline = t(
            f"先在 {name(primary)} 验证扫描件与问答边界",
            f"Verify scans and Q&A boundaries in {name(primary)} first",
        )
        summary += t(
            " 扫描件的 OCR、原页定位与识别正确性尚未实测；先检查下方解析步骤，文档导入能力不能代证扫描件已可用。",
            " OCR, original-page locations and recognition accuracy remain untested. Follow the parsing checks below; document ingestion alone does not establish scan usability.",
        )
        unknowns.append(
            DecisionGuidanceUnknown(
                candidate_id=primary,
                requirement="scan-parsing",
                kind="not-tested",
                decisive=True,
                detail=t(
                    "扫描件解析及页码对应尚未实测。",
                    "Scan parsing and page alignment are untested.",
                ),
                affects=t("扫描件问答的适用性", "Scan Q&A suitability"),
                recovery=t(
                    "核验 OCR 入口，对照原页检查文字与定位；不可读页待处理。",
                    "Verify OCR and check text and positions against original pages; isolate unreadable pages.",
                ),
                checked_at=result.as_of,
            )
        )
    if (
        user_tools.comparison
        and not question
        and not all_excluded
        and result.plan
        and result.plan.trial
    ):
        outcome, primary = "conditional", None
        headline = t(
            "先比较候选的功能与使用条件", "Compare candidate features and usage conditions"
        )
        summary = (
            t(
                f"{'、'.join(name(key) for key in ready[:3])} 有本次必要功能的资料依据。先核对使用方式、权限与缺项；这些依据不构成性能排名，也不要求逐个实测才能开始。",
                f"{', '.join(name(key) for key in ready[:3])} have evidence for the required features. Check interfaces, access and gaps first; this is not a performance ranking and testing every candidate is not required to start.",
            )
            if ready
            else t(
                "按你的任务核对各方案的功能、使用方式和缺项，再用相同材料与验收标准验证；公开功能依据不能证明哪个实际效果更好。",
                "Compare features, interfaces and gaps against your task, then validate with the same inputs and criteria. Documented features do not establish a real-world quality winner.",
            )
        )
        tradeoff = t(
            "配置投入、功能依据和实测效果分别记录；预算与未测效果保持未知。",
            "Record setup effort, documented features and measured outcomes separately; unknown budgets and untested quality stay unknown.",
        )
        instruction = " ".join(result.plan.trial.procedure)
        kind, label = "start", t("查看同口径验证步骤", "See comparable validation steps")
    stages = ordered_task_stages(context)
    if (
        stages
        and result.plan
        and result.plan.trial
        and outcome in {"advice", "conditional"}
        and not question
        and not all_excluded
    ):
        # One catalog method cannot establish qualification for the entire
        # requested chain. Retain each explicit goal while keeping the route
        # conditional and refusing to invent a full-workflow product winner.
        outcome, primary, ready, reasons = "conditional", None, [], []
        headline = t(
            f"按原题顺序完成这 {len(stages)} 步",
            f"Complete the requested {len(stages)} stages in order",
        )
        summary = " → ".join(f"{i}. {quote}" for i, quote in enumerate(stages, 1))
        tradeoff = t(
            "步骤来自你的任务要求，尚未实测一个具体工具能完成整条链路。先在现有入口确认各步所需能力；缺少材料或能力时，保留阻塞及恢复要求。",
            "These steps follow your task requirements; no specific tool has been tested for the entire chain. Confirm each required capability in your existing interface; retain blockers and recovery requirements when materials or capabilities are missing.",
        )
        instruction = " ".join(result.plan.trial.procedure)
        kind, label = "start", t("查看分步任务", "See the staged task")
    deliverables = parallel_task_deliverables(context)
    if deliverables and result.plan and result.plan.trial and not question and not all_excluded:
        outcome, primary, ready, reasons = "conditional", None, [], []
        headline = t("分别完成原题的全部交付", "Complete every requested deliverable")
        summary = "；".join(deliverables)
        instruction = " ".join(result.plan.trial.procedure)
        kind, label = "start", t("查看完整任务", "See the complete task")
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
        if workflow:
            headline = (
                t(
                    "已识别任务，当前缺少对应工具依据：",
                    "Task identified; tool evidence is missing: ",
                )
                + workflow["name"][int(language == "en")]
            )
            index = int(language == "en")
            summary = workflow.get("route", workflow["steps"][0])[index]
            instruction = " ".join(step[index] for step in workflow["steps"])
            instruction += t(" 重点检查：", " Check: ") + workflow["metrics"][index]
            instruction += " " + workflow["acceptance"][index]
    receipt = context.task_meaning
    if (
        receipt
        and receipt.status in {"failed", "invalid"}
        and not workflow
        and scenario_definition(context) is None
    ):
        # A parser outage is not an ambiguity in the user's task. Never silently
        # turn provider failure into a request to repeat a complete description.
        question = None
        outcome, primary, ready, reasons = "blocked", None, [], []
        headline = t("本次需求解析未完成", "Task interpretation did not complete")
        summary = t(
            "原题与条件已保留，当前不能确认选型路线；没有生成可采用的建议。",
            "Your task and conditions are retained; a reliable selection route was not established.",
        )
        kind, label = "routes", t("保留任务后重试", "Retain the task and retry")
        instruction = t(
            "稍后重新分析；无需为系统解析失败重新编写需求。",
            "Reanalyze later; you do not need to rewrite the task because parsing failed.",
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
        tasks=task_descriptions(context),
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
