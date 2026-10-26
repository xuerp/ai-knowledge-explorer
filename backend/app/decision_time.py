"""Source-grounded execution bounds, distinct from availability and media length.

A model-owned role is not temporal evidence. Keep the source span so quoting
some other clause cannot borrow a genuine bound elsewhere in the request.
Unknown temporal wording remains a condition, never an invented stop timer.
"""

import re
from dataclasses import dataclass

_NUMBER = r"(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万]+)"
_DURATION = (
    rf"(?:半(?:个)?小时|{_NUMBER}\s*(?:秒钟?|分钟|小时|天)"
    r"|\d+(?:\.\d+)?\s*(?:seconds?|minutes?|hours?|days?))"
)
_DURATION_RELATION = re.compile(
    rf"(?:限时|最多用|用时|耗时|花|给出|设计一个|在|\bwithin\b|\bin\b)\s*(?P<prefix>{_DURATION})"
    rf"|(?P<suffix>{_DURATION})\s*(?:之?内|能|完成|试用|验证|测试|为限|时间|time limit)",
    re.IGNORECASE,
)
_MEDIA_AFTER = re.compile(
    r"\s*(?:的)?(?:会议|客户|访谈)?(?:录音|视频|音频|影片)"
    r"|\s*(?:[- ]long)?\s*(?:of\s+)?(?:audio|video|recording)\b",
    re.IGNORECASE,
)
_DATA_RANGE_AFTER = re.compile(
    r"\s*(?:之?内)?\s*(?:生成|发布|创建|收到|发生|更新|修改)的"
    r"|\s*(?:之?内)?的(?:数据|记录|日志|订单|消息|来信|材料)"
    r"|\s*(?:of\s+(?:data|logs|records)|old\b|ago\b)",
    re.IGNORECASE,
)
_CLOCK = r"(?:(?:[01]?\d|2[0-3])[:：][0-5]\d|[零〇一二两三四五六七八九十\d]+点(?:半|[一二三四五六七八九十\d]+分)?)"
_DAY = (
    r"(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}月\d{1,2}日|今天|明天|后天"
    r"|(?:本周|下周|周|星期)[一二三四五六日天])"
)
_POINT = rf"(?:{_DAY}(?:\s*(?:上午|下午|晚上|中午)?\s*{_CLOCK})?|{_CLOCK})"
_CUTOFF = re.compile(
    rf"(?:截止(?:时间|日期)?|最晚)(?:是|为|在|于|到|[:：])?\s*(?P<explicit>{_POINT})"
    rf"|(?P<completion>{_POINT})\s*(?:之?前|以前)(?:把[^，。；\n]{{0,30}})?"
    r"\s*(?:完成|提交|交付|交稿|交给|结束|做好|给出|产出|出结果)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ExecutionBound:
    value: str
    start: int
    end: int


def execution_bounds(task: str) -> tuple[ExecutionBound, ...]:
    result = []
    for pattern in (_DURATION_RELATION, _CUTOFF):
        for match in pattern.finditer(task):
            group = next(name for name, value in match.groupdict().items() if value)
            start, end = match.span(group)
            if pattern is _DURATION_RELATION:
                if _MEDIA_AFTER.match(task[end:]) or _DATA_RANGE_AFTER.match(task[end:]):
                    continue
                if re.search(r"(?:最近|过去|近|\bpast|\blast)\s*$", task[:start], re.IGNORECASE):
                    continue
            result.append(ExecutionBound(match[group], start, end))
    return tuple(sorted(result, key=lambda bound: bound.start))


def deadline_from_quote(quote: str, task: str) -> str | None:
    """The quoted occurrence must contain a bound with an execution relation."""
    bounds = execution_bounds(task)
    for occurrence in re.finditer(re.escape(quote), task):
        for bound in bounds:
            if occurrence.start() <= bound.start and bound.end <= occurrence.end():
                return bound.value
    return None
