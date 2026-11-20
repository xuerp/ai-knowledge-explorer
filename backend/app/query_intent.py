from __future__ import annotations

import re

CODING_TOOL = re.compile(
    r"(?:编码|编程)(?:工具|助手|智能体)|\bcoding (?:tool|assistant|agent)s?\b", re.IGNORECASE
)
TERMINAL = re.compile(
    r"终端(?!用户|消费者|客户|设备)|命令行|\b(?:terminal|cli|command.line)\b",
    re.IGNORECASE,
)


def resolve_entity_type_intent(question: str) -> set[str]:
    """Resolve broad entity-type language shared by retrieval and evaluation."""
    key = question.casefold()
    intents: set[str] = set()
    if "模型" in key or "model" in key:
        intents.add("model")
    if "agent" in key or "智能体" in key:
        intents.add("agent")
    if "框架" in key or "framework" in key:
        intents.add("framework")
    if "协议" in key or "protocol" in key:
        intents.add("framework")
    if "公司" in key or "company" in key or "机构" in key:
        intents.add("company")
    if "论文" in key or "paper" in key:
        intents.add("paper")
    if "基准" in key or "benchmark" in key:
        intents.add("benchmark")
    if CODING_TOOL.search(question):
        intents.update(("agent", "tool", "application"))
    return intents
