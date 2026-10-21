"""User-declared tool ownership is distinct from a catalog recommendation."""

import re
from dataclasses import dataclass

from .decision_clauses import clauses
from .decision_intent import CATALOG
from .decision_semantics import context_meaning, meaning_source

RELATION = re.compile(
    r"(?:已经(?:有|在用|使用)|已在使用|正在使用|正在用|已有|拥有|在用|现有|只有|仅有|"
    r"\b(?:already|currently)\s+(?:only\s+)?(?:have|use|using|run|running)\b|"
    r"\b(?:we|I)\s+(?:only\s+)?(?:have|use)\b)\s*(?P<object>.+)",
    re.IGNORECASE,
)
OBJECT_END = re.compile(
    r"用来|用于|需要|希望|想要|准备|这次|本轮|请|\b(?:to|for|but|and then)\b",
    re.IGNORECASE,
)
TOOL_KIND = re.compile(
    r"工具|平台|服务|系统|应用|助手|知识库|编辑器|客户端|\b(?:tool|platform|service|system|app|assistant|chatbot|editor)\b",
    re.IGNORECASE,
)
MATERIAL_FIRST = re.compile(
    r"^(?:(?:[零一二两三四五六七八九十百几\d]+)\s*(?:份|本|批|条|张)?\s*|(?:some|the|existing)\s+)?"
    r"(?:PDF|Word|文档|资料|文件|样本|素材|邮件|代码|仓库|documents?\b|files?\b|samples?\b|data\b)",
    re.IGNORECASE,
)
SELECTION = re.compile(
    r"选择|选型|推荐|比较|更换|替换|迁移|\b(?:choose|select|recommend|compare|switch|replace)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ToolContext:
    references: tuple[str, ...] = ()
    entity_ids: tuple[str, ...] = ()
    reuse: bool = False
    interpreted_references: tuple[str, ...] = ()


def names_entity(text, entity):
    for label in (entity.name.zh, entity.name.en, *(entity.aliases or [])):
        if len(label) > 1 and re.search(
            r"(?<![a-z0-9])" + re.escape(label) + r"(?![a-z0-9])", text, re.IGNORECASE
        ):
            return True
    return False


def tool_context(context, entities=()) -> ToolContext:
    """Bind names only inside a positive ownership/use statement's object.

    This is a bounded source grammar, not a task router. A named candidate in
    another clause, an unavailable tool or owned documents cannot establish
    ownership of a product. Unnamed services remain unnamed.
    """
    entities = tuple(entities)
    meaning = context_meaning(context)
    prohibited = (
        [item.quote for item in meaning.items if item.role == "prohibition"] if meaning else []
    )
    declared = (
        [item.quote for item in meaning.items if item.role == "existing-tool"] if meaning else []
    )
    references, bound, positive_parts = [], [], []
    choosing = False
    source = meaning_source(context)
    for part in clauses(source, CATALOG["interpretation"]):
        if (
            part.prohibited
            or re.match(r"^(?:别|勿|禁止)", part.text)
            or any(part.text in quote for quote in prohibited)
        ):
            continue
        occurrences = tuple(re.finditer(re.escape(part.text), source))
        if (
            occurrences and all(re.match(r"\s*[?？]", source[item.end() :]) for item in occurrences)
        ) or re.match(
            r"^(?:do|does|did|can|could|would|should|is|are)\b", part.text, re.IGNORECASE
        ):
            continue
        selection = SELECTION.search(part.text)
        if selection:
            selected_object = part.text[selection.end() :]
            choosing |= bool(TOOL_KIND.search(selected_object)) or any(
                names_entity(selected_object, entity) for entity in entities
            )
        relation = RELATION.search(part.text)
        obj = OBJECT_END.split(relation["object"], maxsplit=1)[0].strip() if relation else ""
        if relation and (
            not obj
            or MATERIAL_FIRST.search(obj)
            or re.match(r"^(?:no|not|never)\b", obj, re.IGNORECASE)
        ):
            continue
        if not re.search(
            r"如果|假如|假设|假定|是否|有无|也许|可能|考虑|希望|\b(?:if|assuming|suppose|maybe|perhaps|might|consider)\b",
            part.text,
            re.IGNORECASE,
        ) and not re.search(r"[吗么]$", part.text):
            positive_parts.append(part.text)
        if not relation:
            continue
        if re.search(
            r"如果|假如|假设|假定|是否|有无|也许|可能|考虑|希望|\b(?:if|assuming|suppose|maybe|perhaps|might|consider)\b",
            part.text[: relation.start()],
            re.IGNORECASE,
        ) or re.search(r"[吗么]$", part.text):
            continue
        named = [entity.id for entity in entities if names_entity(obj, entity)]
        if (
            not named
            and not TOOL_KIND.search(obj)
            and not any(quote in obj or obj in quote for quote in declared)
        ):
            continue
        references.append(part.text)
        bound.extend(named)
    # The interpreter can recognize an unlisted ownership expression. Retain
    # that as an interpretation, not a proven catalog identity. This permits
    # a conditional existing-service plan without adding one verb per failure.
    interpreted = tuple(
        dict.fromkeys(
            quote
            for quote in declared
            if not any(quote in reference for reference in references)
            and any(quote in part or part in quote for part in positive_parts)
            and not re.search(
                r"如果|假如|假设|假定|是否|也许|可能|\b(?:if|assuming|suppose|maybe|perhaps)\b",
                quote,
                re.IGNORECASE,
            )
        )
    )
    return ToolContext(
        tuple(dict.fromkeys(references)),
        tuple(dict.fromkeys(bound)),
        bool(references or interpreted) and not choosing,
        interpreted,
    )
