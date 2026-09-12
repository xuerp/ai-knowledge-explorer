from __future__ import annotations


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
    return intents
