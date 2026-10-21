"""Extract task constraints once; observations never become supplier facts."""

import re
from dataclasses import dataclass, replace

from .decision_clauses import clauses as parse_clauses
from .decision_intent import CATALOG, positive_task_text
from .decision_semantics import context_meaning, meaning_source
from .decision_time import deadline_from_quote, execution_bounds

NUMBER = r"(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万]+)"


def number(value: str) -> float:
    if re.fullmatch(r"\d+(?:\.\d+)?", value):
        return float(value)
    digits = dict(zip("零〇一二两三四五六七八九", [0, 0, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9]))
    total = section = current = 0
    for char in value:
        if char in digits:
            current = digits[char]
        elif char == "万":
            total += (section + current) * 10000
            section = current = 0
        else:
            section += (current or 1) * {"十": 10, "百": 100, "千": 1000}[char]
            current = 0
    return float(total + section + current)


def daily_workload(task: str) -> tuple[float, float, float] | None:
    requests = re.search(rf"(?:每天|每日)(?:调用|请求)?\s*({NUMBER})\s*次", task)
    inputs = re.search(rf"每次输入\s*({NUMBER})\s*token", task, re.IGNORECASE)
    outputs = re.search(rf"输出\s*({NUMBER})\s*token", task, re.IGNORECASE)
    if requests and inputs and outputs:
        return number(requests[1]), number(inputs[1]), number(outputs[1])
    return None


@dataclass(frozen=True)
class TaskUnderstanding:
    goal: str
    materials: tuple[str, ...]
    limits: tuple[str, ...]
    time_limit: str | None
    offline: bool
    unsupported_media: bool


def understand_task(task: str) -> TaskUnderstanding:
    clauses = parse_clauses(task, CATALOG["interpretation"])
    # An inability is not an input material. Keep the remaining text intact.
    material_text = re.sub(
        r"(?:不(?:会|懂|用|需要|想)|无需).{0,4}(?:写|编写|处理)?代码|(?:cannot|can't|don't)\s+(?:write\s+)?code",
        "",
        positive_task_text(task),
        flags=re.IGNORECASE,
    )
    materials = tuple(
        dict.fromkeys(
            re.findall(
                r"PDF|Word|DOCX|简历|合同|代码|发票|扫描件|文档|邮件|仓库|resume|repository|invoice|email",
                material_text,
                re.IGNORECASE,
            )
        )
    )
    limits = tuple(
        part.text
        for part in clauses
        if part.prohibited
        # Retention is deliberately broader than lexical goal exclusion.
        # Unknown negated operations must survive even if the verb is absent
        # from the catalog; a negative adjective must not erase its goal.
        or re.search(r"[不未没无]|\b(?:no|not|never|without)\b", part.text, re.IGNORECASE)
        or re.search(
            r"不能|不要|不得|不想|不允许|不传|不.*传出去|只|最多|预算|断网|离线|内存|显卡|确认|审批|must|only|offline|budget",
            part.text,
            re.IGNORECASE,
        )
    )
    deadlines = execution_bounds(task)
    positive = positive_task_text(task)
    deployment_text = " ".join(
        part.text
        for part in clauses
        if not re.search(r"不需要|不要求|无需|no need|not required", part.text, re.IGNORECASE)
    )
    return TaskUnderstanding(
        goal=task,
        materials=materials,
        limits=limits,
        time_limit=deadlines[0].value if deadlines else None,
        offline=bool(
            re.search(
                r"完全(?:离线|断网)|(?:全程|必须|要求).{0,8}(?:离线|断网)|一个字都不能传出去|只能在.{0,12}(?:机器|本机|本地)|(?:不得|不能|禁止).{0,6}(?:离开|传出).{0,8}(?:本机|本地|这台|当前设备)|不能上传|不得上传|禁止上传|fully offline|air.gapped|must stay local|no cloud|(?:must not|cannot) leave (?:this|the local).{0,12}(?:computer|device|machine)",
                deployment_text,
                re.IGNORECASE,
            )
        ),
        unsupported_media=bool(
            re.search(
                r"生成视频|制作视频|生成图片|画图|三维建模|3D建模|语音合成|(?:视频|广告片).{0,40}(?:变成|延长|剪辑|配音)|(?:人物|人脸).{0,20}(?:一致|保留)|generate (?:video|images)|text.to.speech|extend.{0,20}video",
                positive,
                re.IGNORECASE,
            )
        ),
    )


def understand_context(context) -> TaskUnderstanding:
    deterministic = understand_task(context.task)
    meaning = context_meaning(context)
    if meaning is None:
        return deterministic
    materials = tuple(item.quote for item in meaning.items if item.role == "material")
    constraints = tuple(
        item.quote
        for item in meaning.items
        if item.role in {"condition", "prohibition", "sample", "unavailable-material"}
    )
    deadlines = [
        value
        for item in meaning.items
        if item.role == "deadline"
        and (value := deadline_from_quote(item.quote, meaning_source(context)))
    ]
    return replace(
        deterministic,
        materials=materials,
        limits=tuple(dict.fromkeys((*deterministic.limits, *constraints))),
        time_limit=deterministic.time_limit or (deadlines[0] if len(deadlines) == 1 else None),
    )
