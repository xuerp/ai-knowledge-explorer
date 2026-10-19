"""Extract task constraints once; observations never become supplier facts."""

import re
from dataclasses import dataclass

from .decision_intent import positive_task_text

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
    clauses = re.split(r"[，,。；;!?！？\n]", task)
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
        part.strip()
        for part in clauses
        if re.search(
            r"不能|不要|不得|不想|不允许|不传|不.*传出去|只|最多|预算|断网|离线|内存|显卡|确认|审批|must|only|offline|budget",
            part,
            re.IGNORECASE,
        )
    )
    time = re.search(
        rf"半(?:个)?小时|{NUMBER}\s*(?:分钟|小时)|\d+\s*(?:minutes?|hours?)", task, re.IGNORECASE
    )
    positive = positive_task_text(task)
    return TaskUnderstanding(
        goal=task,
        materials=materials,
        limits=limits,
        time_limit=time[0] if time else None,
        offline=bool(
            re.search(
                r"完全(?:离线|断网)|(?:全程|必须|要求).{0,8}(?:离线|断网)|一个字都不能传出去|fully offline|air.gapped",
                positive,
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
