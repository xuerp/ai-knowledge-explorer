"""Evidence-gated actions and reproducible, unexecuted business trial protocols.

Uses the same candidate dispositions/gaps as the recommendation, without
network calls, guessed product facts, implicit approval or evidence-count ranking.
"""

import re

from .decision_intent import task_workflow
from .decision_semantics import context_meaning
from .decision_task import understand_context
from .schemas import DecisionAction, DecisionContext, DecisionPlan, DecisionResult, DecisionTrial

# Method guidance only, never a claimed benchmark or an automatic invocation.
PROTOCOLS = {
    "knowledge-assistant": (
        (
            "同一批授权文档；包含可回答、文档无答案、相互矛盾和过期条款的提问。",
            "Use the same authorized documents, with answerable, unanswerable, contradictory and outdated questions.",
        ),
        (
            "固定切分、检索、提示词和文档版本；保留检索片段与最终答案。",
            "Fix chunking, retrieval, prompts and document versions; retain retrieved passages and final answers.",
        ),
        (
            "逐句核对答案和出处，检查无答案时是否明确拒答；用无权访问的文档验证隔离。",
            "Check each answer against its cited passage, abstention on missing answers and isolation of unauthorized documents.",
        ),
        (
            "答案正确率、引用支持率、应拒答时的拒答率、越权披露次数。",
            "Answer accuracy, citation support, correct abstention and unauthorized disclosures.",
        ),
        (
            "越权披露和虚构来源必须为零；业务准确率门槛由你在试测前确定。",
            "Require zero unauthorized disclosures and fabricated sources; set the business accuracy threshold before testing.",
        ),
    ),
    "career-assistant": (
        (
            "同一批脱敏简历与岗位说明；包含缺失信息、技能不匹配和不能从简历推断的经历。",
            "Use the same anonymized resumes and job descriptions, including missing fields, mismatched skills and unsupported experience.",
        ),
        (
            "先人工标注事实和必须字段，再执行抽取、匹配及解释。",
            "Label facts and required fields first, then run extraction, matching and explanations.",
        ),
        (
            "核对经历、日期和技能是否保真，匹配理由是否有原文依据。",
            "Check experience, dates and skills for fidelity and matching explanations for textual support.",
        ),
        (
            "字段准确率、漏填率、虚构经历次数、匹配理由可追溯率。",
            "Field accuracy, omissions, invented experience and traceable matching explanations.",
        ),
        (
            "不能编造经历；先确定哪些缺失字段应返回未知，再设准确率门槛。",
            "Do not invent experience; define which missing fields must remain unknown and set an accuracy threshold.",
        ),
    ),
    "coding-workspace": (
        (
            "同一仓库快照的三题：修复失败测试、新增功能并补测试、跨文件重构。",
            "Three tasks on the same repository snapshot: fix a failing test, add a feature with tests, and refactor across files.",
        ),
        (
            "每题使用独立工作副本与新会话，固定模型、入口、权限及时间上限。",
            "Use a separate copy and fresh session per task; fix model, interface, permissions and time limit.",
        ),
        (
            "保存补丁、真实测试命令和退出码；独立运行验收，记录人工修改及中断。",
            "Retain patches, actual test commands and exit codes; independently verify acceptance, human edits and interruptions.",
        ),
        (
            "独立验收通过题数、回归失败、人工修改量、完成用时。",
            "Independently accepted tasks, regression failures, human edits and completion time.",
        ),
        (
            "通过任务验收且不破坏原测试；未交付、未运行或人工补写不可记作自主通过。",
            "Pass task acceptance without regressions; missing delivery, unrun tests or human-written fixes do not count as autonomous success.",
        ),
    ),
    "coding-model": (
        (
            "同一组代码输入及隐藏验收测试；包含缺陷修复、边界条件和接口兼容题。",
            "Use identical code inputs and hidden acceptance tests for bug fixes, edge cases and interface compatibility.",
        ),
        (
            "固定 API 渠道、模型版本、提示词、工具和上下文；每题独立执行。",
            "Fix API channel, model version, prompts, tools and context; run tasks independently.",
        ),
        (
            "在隔离环境执行生成代码和隐藏测试，保留全部失败及人工修改。",
            "Execute generated code and hidden tests in isolation; retain all failures and human edits.",
        ),
        (
            "验收通过率、回归、无效代码次数、人工修改量。",
            "Acceptance rate, regressions, invalid code and human edits.",
        ),
        (
            "仅可执行且通过独立验收的代码算成功；不要把其他基准成绩换算成本业务胜率。",
            "Count only executable code passing independent acceptance; do not convert unrelated benchmarks into a business success rate.",
        ),
    ),
    "agent-orchestration": (
        (
            "同一工具链的正常任务、工具失败、进程中断、人工拒绝和越权请求。",
            "Use normal tasks, tool failures, process interruption, human rejection and unauthorized requests on the same toolchain.",
        ),
        (
            "固定状态存储与工具权限；在写操作前中断，再恢复相同任务。",
            "Fix state storage and tool permissions; interrupt before a write, then resume the same task.",
        ),
        (
            "核对恢复后的状态、审批边界、重复副作用和失败日志。",
            "Inspect recovered state, approval boundaries, duplicate side effects and failure logs.",
        ),
        (
            "恢复成功次数、状态丢失、重复写入、绕过审批次数。",
            "Successful recoveries, state loss, duplicate writes and approval bypasses.",
        ),
        (
            "越权或绕过审批必须为零；恢复不能重复执行已完成的外部写入。",
            "Require zero permission or approval bypasses; recovery must not repeat completed external writes.",
        ),
    ),
    "document-extraction": (
        (
            "同一批授权文档：清晰文本、扫描件、缺字段、模糊和版式变化；事先标注正确字段。",
            "Use the same authorized documents: text, scans, missing fields, blur and layout variation; label correct fields in advance.",
        ),
        (
            "固定预处理、输出 schema 和提示词；使用相同页数与文件版本。",
            "Fix preprocessing, output schema and prompts; use identical pages and file versions.",
        ),
        (
            "逐字段检查正确值、缺失处理和类型；检查无法读取时是否保持未知。",
            "Check field values, missing-field handling and types; preserve unknowns when content is unreadable.",
        ),
        (
            "字段准确率、必需字段漏填率、schema 合格率、虚构字段次数。",
            "Field accuracy, required-field omissions, schema validity and invented fields.",
        ),
        (
            "不能补造看不清或未提供的字段；试测前确定必需字段和容许错误率。",
            "Do not invent unreadable or absent fields; define required fields and tolerated error rate before testing.",
        ),
    ),
    "general-text": (
        (
            "按原题范围准备同一组获准使用的请求，可用真实或合成样本；先确认接受标准，包含正常、歧义、无资料和边界请求。",
            "Prepare identical authorized requests within the stated scope, using real or synthetic samples. Define acceptance criteria first, including ordinary, ambiguous, unsupported and edge requests.",
        ),
        (
            "固定模型、提示词和可用资料，匿名混排候选答案。",
            "Fix model, prompts and available sources; anonymously mix candidate answers.",
        ),
        (
            "按事实正确、指令遵守和目标用户可接受性逐条评分，保留失败案例。",
            "Evaluate factual correctness, instruction following and audience acceptance; retain failures.",
        ),
        (
            "事实错误率、任务完成率、格式合格率、人工修订量。",
            "Factual error rate, task completion, format validity and human revisions.",
        ),
        (
            "先写清必需事实、输出格式和不可接受错误，再判断合格；文风偏好不替代事实正确性。",
            "Define required facts, format and unacceptable errors before judging acceptance; style preference does not replace factual correctness.",
        ),
    ),
}


def build_plan(result: DecisionResult, context: DecisionContext, language: str) -> DecisionPlan:
    index = int(language == "en")
    t = lambda zh, en: (zh, en)[index]
    rows = result.candidates
    active = [row for row in rows if row.eligibility != "excluded"]
    features = set(result.scenario.required_features)
    qualified = [
        row.entity_id
        for row in active
        if row.eligibility == "eligible"
        and features
        and features <= {item.dimension for item in row.strengths}
    ]
    actions = []

    def add(key, kind, title, instruction, unlocks, candidates=(), dimensions=(), claims=()):
        actions.append(
            DecisionAction(
                id=key,
                kind=kind,
                title=title,
                instruction=instruction,
                unlocks=unlocks,
                candidate_ids=list(dict.fromkeys(candidates)),
                dimensions=list(dict.fromkeys(dimensions)),
                claim_ids=list(dict.fromkeys(claims)),
            )
        )

    inputs = {
        "matching-service-channel": (
            "一致的实际服务与预算计费渠道",
            "matching actual service and billing channels",
        ),
        "budget-ceiling": ("预算上限", "budget ceiling"),
        "budget-currency": ("币种", "currency"),
        "billing-channel": ("计费渠道", "billing channel"),
        "monthly-input-tokens": ("月输入 token 数", "monthly input tokens"),
        "monthly-output-tokens": ("月输出 token 数", "monthly output tokens"),
    }
    if result.status == "failed":
        return DecisionPlan(
            state="failed",
            can_decide=t(
                "本次分析失败，没有形成可用判断；保留条件后重新分析。",
                "Analysis failed; preserve conditions and reanalyze before deciding.",
            ),
        )
    if result.missing_inputs:
        names = [inputs.get(key, (key, key))[index] for key in result.missing_inputs]
        add(
            "complete-input",
            "clarify",
            t("先补齐影响筛选的条件", "Complete decision-critical inputs first"),
            t("在条件表单补齐：", "Complete in the conditions form: ") + "、".join(names),
            t(
                "补齐后重新分析，才能核验预算；不要先把未知价格当免费。",
                "Reanalyze to verify budget; do not treat unknown prices as free.",
            ),
            dimensions=result.missing_inputs,
        )
        # Sources and trials cannot settle an unspecified workload/currency.
        # Resolve the user's inputs once before expanding downstream gaps.
        if active or not rows:
            return DecisionPlan(
                state="needs-input",
                can_decide=t(
                    "先补齐决定性条件；已有事实和排除原因仍可查看。",
                    "Complete decision-critical inputs first; known facts and exclusions remain available.",
                ),
                actions=actions,
            )
    if rows and active and result.scenario.id == "unspecified":
        contract = "合同" in context.task or "contract" in context.task.casefold()
        add(
            "clarify-business",
            "clarify",
            t("说明要用候选完成的具体任务", "Specify the actual task for these candidates"),
            t(
                "在原任务中补充合同需要做摘要、条款核对还是信息抽取，以及希望得到的成品；离线、容量和商用必要条件继续保留。"
                if contract
                else "已指定的产品和规格可以比较；请补充业务输入、期望输出与合格标准，例如代码修复、文档问答或信息抽取。",
                "Selected products and specifications can be compared; add business inputs, expected outputs and acceptance criteria, such as code fixes, document answers or extraction.",
            ),
            t(
                "明确业务后重新分析，才能选择相关功能与测试标准；型号名称和上下文容量不能证明任务效果。",
                "Reanalyze with a business task to choose relevant features and testing criteria; names and context size do not prove task quality.",
            ),
            [row.entity_id for row in active],
        )
    if not rows:
        unknown = result.scenario.id == "unspecified"
        office = unknown and any(
            word in context.task.casefold() for word in ("excel", "周报", "spreadsheet")
        )
        add(
            "clarify-scope",
            "clarify" if unknown else "source",
            t(
                "先选一件最想完成的工作"
                if office
                else "明确业务输入与输出"
                if unknown
                else "补充相关候选与当前来源",
                "Specify business inputs and outputs"
                if unknown
                else "Add relevant candidates and current sources",
            ),
            t(
                "先从整理一张 Excel 表、汇总一份资料、写一篇周报中选一件。说明现在怎么做、最费时间的一步，以及希望得到的成品；不必先理解模型或 API。"
                if office
                else "说明输入、期望输出和合格标准，再选择对象类型或指定候选。"
                if unknown
                else "本次范围没有相关且有当前引用的候选；指定具体产品版本，补充可审核的来源后重新分析。",
                "Specify inputs, expected outputs and acceptance, then choose a selection type or candidates."
                if unknown
                else "No relevant candidate with current citations is in scope; select concrete versions and add reviewable sources before reanalysis.",
            ),
            t(
                "建立相关候选范围，不用随机产品填充答案。",
                "Establish a relevant scope without unrelated product filler.",
            ),
        )
    if any(
        gap.dimension == "api-price" and gap.reason == "needs-input"
        for row in active
        for gap in row.gaps
    ):
        add(
            "clarify-quote-scope",
            "clarify",
            t("核对预算范围与每次请求用量", "Check cost scope and per-request workload"),
            t(
                "在‘限制与偏好’核对预算核算范围。仅核算 Standard token 时，填写你实际确定的每次输入上限；要求全部费用时，模型报价不能替代工具、缓存等支出。不得为了得到候选而降低原预算要求。",
                "Check cost scope under preferences. For Standard token-only estimates, specify a maximum input per request you can establish. For all costs, model quotes cannot replace tool, cache and other charges. Do not weaken the original budget merely to obtain candidates.",
            ),
            t(
                "条件明确后重新分析；费用区间跨预算时仍保持未确认。",
                "Reanalyze after clarifying conditions; a range crossing the budget remains unverified.",
            ),
            candidates=[
                row.entity_id
                for row in active
                if any(
                    gap.dimension == "api-price" and gap.reason == "needs-input" for gap in row.gaps
                )
            ],
            dimensions=["api-price"],
        )
    scope_input = any(
        gap.dimension == "commercial-use" and gap.reason == "needs-input"
        for row in active
        for gap in row.gaps
    )
    if scope_input:
        add(
            "clarify-commercial-scope",
            "clarify",
            t("核对实际服务的商用适用范围", "Check the actual service scope"),
            t(
                "在高级条件的商用选项下填写实际服务渠道、免费/付费层级和服务使用国家，并核对部署方式。这些条件与数据存储地区不同，不能用原厂条款代替网关条款。",
                "Specify the service channel, free/paid tier, country of service use and deployment under commercial-use conditions. Service availability is distinct from data residency; vendor terms cannot replace gateway terms.",
            ),
            t(
                "保留原要求重新分析；不明确时继续保留未知，不代选账户或国家。",
                "Reanalyze with the original requirements; unknown account or country stays unknown.",
            ),
            candidates=[
                row.entity_id
                for row in active
                if any(
                    gap.dimension == "commercial-use" and gap.reason == "needs-input"
                    for gap in row.gaps
                )
            ],
            dimensions=["commercial-use"],
        )
    if rows and not active:
        add(
            "change-scope",
            "change-scope",
            t("保留硬条件并更换候选，或修改要求", "Change candidates or revise requirements"),
            t(
                "先核对下方每个候选的明确排除原因；必须保留的要求不应为了得到推荐而降低。",
                "Inspect each verified exclusion below; do not relax mandatory requirements merely to produce a recommendation.",
            ),
            t(
                "修改候选或条件后重新分析；这些候选不进入本轮业务试测。",
                "Reanalyze after changing candidates or conditions; excluded candidates do not enter this trial.",
            ),
            candidates=[row.entity_id for row in rows],
        )
    groups = {}
    for row in active:
        for gap in row.gaps:
            if gap.reason in {"requires-poc", "needs-input"}:
                continue
            key = (gap.reason, gap.dimension)
            group = groups.setdefault(key, {"ids": [], "claims": []})
            group["ids"].append(row.entity_id)
            group["claims"].extend(gap.claim_ids)
    methods = {
        "conflicting": (
            "reconcile",
            ("核对冲突来源", "Reconcile conflicting sources"),
            (
                "并列核对引用中的具体版本、日期和适用条件；冲突解除前不把该候选当作符合条件。",
                "Compare cited versions, dates and applicable conditions; do not qualify the candidate until the conflict is resolved.",
            ),
        ),
        "not-current": (
            "source",
            ("更新失效或缺日期的依据", "Refresh invalid or undated evidence"),
            (
                "补充当前版本的来源与有效日期，经审核后重新分析；采集时间不能替代发布日期。",
                "Add current-version sources and effective dates, review them and reanalyze; collection time cannot substitute for publication date.",
            ),
        ),
        "not-structured": (
            "source",
            ("核验已有资料中的明确条款", "Verify explicit terms in existing sources"),
            (
                "已有相关引用，先核对原文是否明确说明此条件及适用范围，再补充结构化事实；不用重复搜集泛泛介绍。",
                "Inspect existing citations for explicit conditions and scope, then add structured facts; avoid collecting more generic descriptions.",
            ),
        ),
        "not-recorded": (
            "source",
            ("补充未收录的必要依据", "Add missing required evidence"),
            (
                "为列出的候选和维度补充具体版本的官方规格、许可或功能来源，经审核后重新分析；缺失不表示不支持。",
                "Add concrete-version official specifications, terms or feature sources for the listed candidates and dimensions, review and reanalyze; absence does not mean unsupported.",
            ),
        ),
    }
    for (reason, dimension), group in sorted(
        groups.items(), key=lambda item: item[0][0] != "conflicting"
    ):
        kind, title, instruction = methods[reason]
        add(
            f"{reason}:{dimension}",
            kind,
            title[index],
            instruction[index],
            t(
                "重新核验该条件或必要功能，决定此候选能否进入业务试测。",
                "Recheck the condition or required feature to determine trial eligibility.",
            ),
            group["ids"],
            [dimension],
            group["claims"],
        )
    addressed = {key for action in actions for key in action.candidate_ids}
    for row in active:
        if row.eligibility in {"unknown", "conflict"} and row.entity_id not in addressed:
            add(
                "qualification:" + row.entity_id,
                "reconcile" if row.eligibility == "conflict" else "source",
                t("核验候选的剩余资格", "Verify remaining candidate qualifications"),
                "；".join(row.reasons)
                or t(
                    "此候选尚未通过必要条件核验，先核对具体版本与适用条款。",
                    "Required eligibility is unverified; inspect the exact version and applicable terms.",
                ),
                t(
                    "提供可核验依据后重新分析；未核验条件不能按通过处理。",
                    "Reanalyze after providing verifiable evidence; unverified conditions do not count as passed.",
                ),
                [row.entity_id],
                claims=row.claim_ids,
            )
    trial = None
    protocol = PROTOCOLS.get(
        "knowledge-assistant" if result.scenario.id == "knowledge-workspace" else result.scenario.id
    )
    if active and protocol:
        sample, procedure, check, metrics, acceptance = [pair[index] for pair in protocol]
        task = understand_context(context)
        if result.scenario.id == "coding-workspace":
            sample = t(
                "只验证本次指定的一项仓库任务：" + task.goal,
                "Validate only this requested repository task: " + task.goal,
            )
            procedure = t(
                "使用独立工作副本，先复现问题并确认修改方案，再进行最小改动；不追加新功能或重构任务。",
                "Use an isolated working copy, reproduce the issue and confirm the plan before a minimal change; do not add feature or refactoring tasks.",
            )
            if task.time_limit:
                procedure += t(
                    f" 本轮总时间上限为 {task.time_limit}；到时停止并记录未完成项，不将超时或未运行测试记为通过。",
                    f" Stop at the requested limit ({task.time_limit}) and record unfinished work; timeouts or unrun tests are not passes.",
                )
        if task.limits:
            check += t(" 原始限制：", " Original constraints: ") + "；".join(task.limits)
        if result.scenario.id == "knowledge-workspace":
            procedure = t(
                "先确认模型和嵌入服务的数据去向，再用少量授权 PDF / Word 文档创建知识库并接入 Chatbot，启用引用展示；固定文档、切分和检索配置，保留检索片段与最终答案。自托管平台不代表模型也在本地。",
                "Confirm where model and embedding services send data, create a knowledge base from a few authorized PDF / Word documents, connect it to a Chatbot and enable citations. Fix document, chunking and retrieval settings; retain retrieved passages and final answers. Self-hosting the platform does not make its models local.",
            )
            metrics += t(
                " 同时记录模型、嵌入、部署维护及人工校对成本。",
                " Also record model, embedding, hosting, maintenance and human review costs.",
            )
        elif (
            result.scenario.id == "knowledge-assistant"
            and "retrieval" not in result.scenario.required_features
        ):
            procedure = t(
                "本轮选择回答模型。固定同一批检索片段及出处后比较生成；检索召回、引用与权限链路另行核验。要求候选自带检索时，应明确加入该必要功能后重新分析。",
                "This trial selects an answering model. Fix retrieved excerpts and sources before comparing generation; verify retrieval recall, citations and permissions separately. If built-in retrieval is required, explicitly add that requirement and reanalyze.",
            )
        workflow = task_workflow(context.task, context_meaning(context))
        if workflow and workflow["scenario"]:
            sample = (
                t("按原题限定的材料与样本执行：", "Use the requested materials and sample: ")
                + context.task
            )
            procedure, check = [step[index] for step in workflow["steps"]]
            metrics = workflow["metrics"][index]
            acceptance = workflow["acceptance"][index]
        if result.scenario.id == "knowledge-workspace" and re.search(
            r"权限|部门|旧版|新版|过期|access|department|version", context.task, re.IGNORECASE
        ):
            sample = (
                t(
                    "按原题的文档、部门与版本范围建立验证样本：",
                    "Use the requested documents, departments and versions: ",
                )
                + context.task
            )
            access_procedure = t(
                "在现有平台的隔离测试空间保留指定样本，先列出“用户/部门 × 文档 × 生效版本”的允许与拒绝矩阵。旧版留档与当前检索范围分开；用不同权限身份分别提问，保存实际检索片段和回答，不以提示词代替权限控制。",
                "Use an isolated test space in the existing platform and the requested samples. Define an allow/deny matrix of users/departments, documents and effective versions. Separate archived versions from current retrieval; query under different identities and retain retrieved passages and answers. Prompts are not access controls.",
            )
            existing_platform = re.search(
                r"已有|已经|现有|正在用|在用|不迁移|不.{0,5}搬家|already|existing|currently",
                context.task,
                re.IGNORECASE,
            )
            # An existing deployment starts with its decisive access/version
            # checks. A new workspace still needs setup and citation display.
            procedure = (
                access_procedure if existing_platform else procedure + " " + access_procedure
            )
            check = t(
                "用无权访问的文档核对跨部门请求是否拒绝、当前问题是否引用生效版本、旧版是否仅按授权历史查询访问；配置或权限能力缺失时记录阻塞，不能先判通过。",
                "Use unauthorized documents to check cross-department denials, current answers citing effective versions, and authorized historical access to archives. Record missing configuration or permission capabilities as blockers, not passes.",
            )
        # Apply original requirements after selecting the method, so replacing a
        # procedure cannot silently remove the user's restrictions.
        if task.limits and workflow:
            check += t(" 原始限制：", " Original constraints: ") + "；".join(task.limits)
        if task.time_limit and result.scenario.id != "coding-workspace":
            check += t(
                f" 到 {task.time_limit} 停止，记录未完成项。",
                f" Stop at {task.time_limit} and record unfinished work.",
            )
        metric_rows = [metrics]
        accept_rows = [acceptance]
        if context.priority == "speed":
            metric_rows.append(
                t(
                    "同时记录端到端完成时延、超时和失败；保持质量门槛一致。",
                    "Record end-to-end completion latency, timeouts and failures while holding the quality threshold constant.",
                )
            )
        if context.priority == "cost":
            metric_rows.append(
                t(
                    "记录实际账单、请求量、重试与人工处理成本，使用相同币种、渠道和工作量。",
                    "Record actual bills, requests, retries and human handling cost at the same currency, channel and workload.",
                )
            )
        if context.priority in {"privacy", "control"}:
            accept_rows.append(
                t(
                    "先验证数据去向、访问权限和部署边界；未核验时不要发送敏感业务样本。",
                    "Verify data destinations, access permissions and deployment boundaries before sending sensitive samples.",
                )
            )
        trial = DecisionTrial(
            sample=sample, procedure=[procedure, check], metrics=metric_rows, acceptance=accept_rows
        )
        if qualified:
            add(
                "business-trial",
                "test",
                t("按同一标准验证业务效果", "Test business results on a common basis"),
                sample,
                t(
                    "记录版本、入口、样本、范围、测试日期和实际结果，保存到私人验证后复核；未测候选不参加效果排名。",
                    "Record version, interface, sample, scope, date and results; save private validation and review it. Untested candidates do not enter quality rankings.",
                ),
                qualified,
            )
    conflicts = result.status == "conflict" or any(row.eligibility == "conflict" for row in active)
    state = (
        "all-excluded"
        if rows and not active
        else "needs-input"
        if result.missing_inputs
        or result.scenario.id == "unspecified"
        or (scope_input and not qualified)
        else "no-candidates"
        if not rows
        else "all-excluded"
        if not active
        else "conflict"
        if conflicts
        else "ready-to-validate"
        if qualified
        else "needs-evidence"
    )
    if state in {"needs-input", "conflict"}:
        qualified = []
        actions = [action for action in actions if action.kind != "test"]
    can_decide = {
        "needs-input": t(
            "先补齐决定性条件；已有事实和排除原因仍可查看。",
            "Complete decision-critical inputs first; known facts and exclusions remain available.",
        ),
        "no-candidates": t(
            "当前范围没有可核验的相关候选，先建立候选范围。",
            "No relevant verifiable candidate is in scope; establish the candidate scope first.",
        ),
        "all-excluded": t(
            "本次候选均不符合已指定硬条件，不能推荐采用或进入试测。",
            "All candidates fail selected mandatory constraints; none is recommended for adoption or trial.",
        ),
        "conflict": t(
            "存在会影响资格的证据冲突，先核对来源再决定试用对象。",
            "Evidence conflicts affect eligibility; reconcile sources before choosing trial candidates.",
        ),
        "ready-to-validate": t(
            "已有候选通过指定条件且有必要功能依据，可以开始小范围验证；这不等于效果最优或可直接上线。",
            "Candidates meet selected constraints and have cited required features; a limited trial can begin, without claiming superior quality or deployment readiness.",
        ),
        "needs-evidence": t(
            "已有功能和规格可供比较；先补齐必要条件或功能依据，再确定试用对象。",
            "Known features and specifications support comparison; verify necessary conditions or features before choosing trial candidates.",
        ),
    }[state]
    # Put a usable trial first when another candidate's gaps do not block it.
    if qualified:
        actions.sort(key=lambda action: action.kind != "test")
    return DecisionPlan(
        state=state,
        can_decide=can_decide,
        actions=actions,
        trial_candidate_ids=qualified,
        trial=trial,
    )
