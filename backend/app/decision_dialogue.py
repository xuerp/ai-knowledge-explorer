"""Bounded, server-owned clarification. Choices describe work, never vendor facts."""

import re

from .decision_intent import CATALOG, scenario_definition
from .schemas import DecisionClarification, DecisionClarificationOption, DecisionContext


def interpret_answer(answer):
    if answer.option_id or not answer.text:
        return answer
    text = answer.text.strip()
    option = None
    if re.fullmatch(
        r"(?:我也?)?(?:不知道|不清楚|不确定|还没想好)|(?:I )?(?:don't know|not sure|unsure)",
        text,
        re.IGNORECASE,
    ):
        option = "unknown"
    elif answer.question_id == "career-route":
        if re.search(r"自己|自用|我找工作|for myself|personal use", text, re.IGNORECASE):
            option = "use-career"
        elif re.search(r"开发|别人|用户|产品|build|other users", text, re.IGNORECASE):
            option = "build-career"
    return answer.model_copy(update={"option_id": option}) if option else answer


def unsupported_task(context: DecisionContext) -> bool:
    return (
        bool(
            re.search(
                r"生成视频|制作视频|生成图片|画图|三维建模|3D建模|语音合成|generate (?:video|images)|text.to.speech",
                context.task,
                re.IGNORECASE,
            )
        )
        and scenario_definition(context) is None
    )


def normalize_context(context: DecisionContext) -> DecisionContext:
    """Extract explicit requirements; never weaken a structured requirement."""
    result = context.model_copy(deep=True)
    text = context.task + " " + " ".join(answer.text or "" for answer in context.intent_answers)
    clauses = [
        part
        for part in re.split(r"[，,。；;.!]", text)
        if not re.search(r"不要求|不需要|无需|不用|not required|no need", part, re.IGNORECASE)
    ]
    positive = " ".join(clauses)
    if result.deployment in {"cloud-api", "hybrid"} and re.search(
        r"(?:必须|要求).{0,8}离线|完全离线|fully offline|air.gapped",
        positive,
        re.IGNORECASE,
    ):
        raise ValueError(
            "原题要求离线，但部署选项包含云服务。请统一这两项条件后继续。 / Offline requirements conflict with the selected cloud deployment."
        )
    if result.deployment == "undecided":
        if re.search(
            r"(?:必须|要求).{0,8}离线|完全离线|fully offline|air.gapped|端侧|on.device",
            positive,
            re.IGNORECASE,
        ):
            result.deployment = "on-device"
        elif re.search(
            r"私有部署|本地部署|private deployment|on.premises", positive, re.IGNORECASE
        ):
            result.deployment = "private"
        elif re.search(r"云\s*API|cloud API", positive, re.IGNORECASE):
            result.deployment = "cloud-api"
    capacity = re.search(
        r"(?:上下文|context)(?:长度|窗口| window)?\s*(?:不低于|至少|大于等于|≥|>=|at least)?\s*(\d+(?:\.\d+)?)\s*(k|万|m)?",
        positive,
        re.IGNORECASE,
    )
    if not capacity:
        capacity = re.search(
            r"(?:支持|至少|不低于|at least)\s*(\d+(?:\.\d+)?)\s*(k|万|m)?\s*(?:以上|\+)?\s*(?:tokens?\s*)?(?:的)?上下文",
            positive,
            re.IGNORECASE,
        )
    if capacity:
        tokens = float(capacity[1]) * {"k": 1000, "万": 10000, "m": 1000000}.get(
            (capacity[2] or "").lower(), 1
        )
        if tokens.is_integer() and 0 < tokens <= 100000000:
            if result.minimum_context_tokens is None:
                result.minimum_context_tokens = int(tokens)
            elif result.minimum_context_tokens < tokens:
                raise ValueError(
                    "上下文选项低于原题中的最低要求，请统一条件后继续。 / The selected context minimum is lower than the requirement in your task."
                )
    if (
        re.search(CATALOG["interpretation"]["imageInput"], positive, re.IGNORECASE)
        and "image" not in result.input_modalities
    ):
        result.input_modalities.append("image")
    if re.search(
        r"商用许可|可商用|允许商用|commercial use required", positive, re.IGNORECASE
    ) and not re.search(
        r"不允许商用|非商用|non-commercial|no commercial use", positive, re.IGNORECASE
    ):
        result.commercial_use_required = True
    monthly = re.search(
        r"(?:每月|月预算|monthly budget)\s*(?:预算|不超过|最多|上限|≤|<=|of|under)?\s*([¥￥$]?)\s*(\d+(?:\.\d+)?)\s*(万)?\s*(元|CNY|USD|美元)?",
        text,
        re.IGNORECASE,
    )
    if monthly and result.budget.mode == "unknown":
        currency = (
            "USD"
            if monthly[1] == "$" or re.search(r"USD|美元", monthly[4] or "", re.IGNORECASE)
            else "CNY"
            if monthly[1] in {"¥", "￥"} or re.search(r"元|CNY", monthly[4] or "", re.IGNORECASE)
            else None
        )
        if currency:
            result.budget = result.budget.model_copy(
                update={
                    "mode": "range",
                    "max": float(monthly[2]) * (10000 if monthly[3] else 1),
                    "currency": currency,
                    "period": "month",
                }
            )
    if result.task_type == "unspecified" and result.minimum_context_tokens:
        result.task_type = "model-api"
    return result


def task_parts(context: DecisionContext) -> list[tuple[str, dict]]:
    parts = re.split(
        r"[；;\n]|同时|还要|还想|也想|以及|\band also\b", context.task, flags=re.IGNORECASE
    )
    found = []
    for part in parts:
        row = scenario_definition(context.model_copy(update={"task": part, "intent_answers": []}))
        if row and row["id"] not in {item[1]["id"] for item in found}:
            found.append((part.strip(), row))
    return found


def analysis_context(context: DecisionContext) -> DecisionContext:
    result = context.model_copy(deep=True)
    for answer in context.intent_answers:
        if answer.option_id in {row["id"] for row in CATALOG["scenarios"]}:
            row = next(row for row in CATALOG["scenarios"] if row["id"] == answer.option_id)
            # Selection narrows the active task; the original request remains stored.
            selected = next(
                (
                    part
                    for part, candidate in task_parts(context)
                    if candidate["id"] == answer.option_id
                ),
                None,
            )
            result.task = (
                (
                    selected
                    if answer.question_id == "task-focus" and selected
                    else row["patterns"][0] + " " + context.task
                )
                + " "
                + (context.notes or "")
            )
            result.task_type = row["taskType"]
        elif answer.option_id == "build-career":
            result.task_type = "model-api"
        elif answer.text:
            result.task = answer.text + " " + context.task
    return result


def clarification_for(context: DecisionContext, language: str) -> DecisionClarification | None:
    t = lambda zh, en: zh if language == "zh" else en
    answered = {answer.question_id for answer in context.intent_answers}
    if unsupported_task(context):
        return None
    # An uncertain answer is an answer: show bounded routes instead of asking again.
    if any(answer.option_id == "unknown" for answer in context.intent_answers):
        return None
    if len(context.intent_answers) >= 2:
        return None
    text = context.task
    if (
        re.search(r"求职助手|career assistant|job.search assistant", text, re.IGNORECASE)
        and "career-route" not in answered
        and not re.search(
            r"模型|API|开发|给用户|上线|自己用|自用|for myself|build.*(?:app|product)",
            text,
            re.IGNORECASE,
        )
    ):
        return DecisionClarification(
            id="career-route",
            reason=t(
                "使用方式会改变产品与开发路线。",
                "Personal use and building a product need different routes.",
            ),
            question=t("这个求职助手主要给谁用？", "Who is this career assistant for?"),
            options=[
                DecisionClarificationOption(
                    id="use-career",
                    label=t("我自己找工作", "My own job search"),
                    description=t(
                        "先整理简历、分析岗位，用现成工具完成。",
                        "Use an existing tool to review a resume and job description.",
                    ),
                ),
                DecisionClarificationOption(
                    id="build-career",
                    label=t("开发给别人使用", "Build a product for others"),
                    description=t(
                        "选择模型与接入路线，还需开发界面和资料权限。",
                        "Select a model and integration route; build the interface and access controls.",
                    ),
                    task_type="model-api",
                ),
            ],
        )
    parts = task_parts(context)
    if len(parts) > 1 and "task-focus" not in answered:
        return DecisionClarification(
            id="task-focus",
            reason=t(
                "这些工作需要不同能力，原题中的其他任务会保留。",
                "These jobs need different capabilities; all original tasks are retained.",
            ),
            question=t(
                "可以分开推进。先为哪件工作选方案？",
                "These can progress separately. Which job should we choose for first?",
            ),
            options=[
                DecisionClarificationOption(
                    id=row["id"],
                    label=row["name"][language],
                    description=part,
                    task=part,
                    task_type=row["taskType"],
                )
                for part, row in parts[:3]
            ],
        )
    if scenario_definition(analysis_context(context)) is None and "work-direction" not in answered:
        labels = [
            (
                "knowledge-workspace",
                "查找资料并回答问题",
                "Find information and answer questions",
                "让文档变成可以提问的知识库。",
                "Ask questions of your documents.",
            ),
            (
                "document-extraction",
                "从材料整理表格",
                "Organize material into tables",
                "从文件提取字段；计算结果仍需核对。",
                "Extract fields from files; verify calculations separately.",
            ),
            (
                "general-text",
                "起草或修改文字",
                "Draft or revise writing",
                "写邮件、报告或总结，保留事实来源。",
                "Draft emails, reports or summaries using supplied facts.",
            ),
        ]
        return DecisionClarification(
            id="work-direction",
            reason=t("目前还不能确定你要完成的工作。", "The intended job is not yet clear."),
            question=t(
                "你想先把哪类工作交给 AI？",
                "Which kind of work would you like AI to help with first?",
            ),
            options=[
                DecisionClarificationOption(
                    id=key,
                    label=t(zh, en),
                    description=t(dzh, den),
                    task=next(row for row in CATALOG["scenarios"] if row["id"] == key)["patterns"][
                        0
                    ],
                )
                for key, zh, en, dzh, den in labels
            ],
        )
    return None
