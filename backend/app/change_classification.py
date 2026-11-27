"""Classify reviewed fact predicates as change events for /updates.

The extraction model names predicates freely ("launched-as", "released-to",
"feature-deprecated"), while /updates only listed a handful of exact strings,
so approved changes never surfaced. Exact taxonomy predicates still win; other
predicates are classified by their normalized words. A predicate that describes
a standing property (supports, context window, price level) is not a change.
"""

from __future__ import annotations

import re

from .catalog_changes import EVENT_PREDICATE_KINDS
from .schemas import LocalizedText

# Ordered: the first matching rule wins, so specific phrases precede broad ones.
_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "deprecated",
        (
            "deprecat",
            "retire",
            "retirement",
            "shutdown",
            "shut down",
            "sunset",
            "discontinu",
            "end of life",
            "removed",
            "remove",
        ),
    ),
    (
        "pricing",
        (
            "price change",
            "pricing change",
            "price cut",
            "price drop",
            "price increase",
            "repric",
            "pricing changed",
            "price changed",
        ),
    ),
    (
        "availability",
        (
            "released to",
            "released in",
            "release to",
            "launched in",
            "launched on",
            "available",
            "availability",
            "expanded access",
            "generally available",
            "rolled out",
            "rollout",
            "roll out",
            "access to",
            "opened to",
        ),
    ),
    (
        "new",
        ("release", "released", "launch", "launched", "introduc", "announc", "debut", "unveil"),
    ),
    (
        "updated",
        (
            "gained",
            "added",
            "adds",
            "now supports",
            "upgrad",
            "updated",
            "improv",
            "enabled",
            "extended",
        ),
    ),
)


def _words(predicate: str) -> str:
    text = re.sub(r"[_\-]+", " ", predicate.casefold())
    return " ".join(text.split())


# Words that mark a standing status or provenance note rather than a dated change.
_STATIC_MARKERS = (" historical ", " unverified ", " status ", " guidance ", " type ")


def change_kind_for_predicate(predicate: str | None) -> str | None:
    """Return the /updates kind for a dated, reviewed fact, or None if it is static."""
    if not predicate:
        return None
    exact = EVENT_PREDICATE_KINDS.get(predicate)
    if exact:
        return exact
    words = f" {_words(predicate)} "
    if any(marker in words for marker in _STATIC_MARKERS):
        return None
    for kind, needles in _RULES:
        if any(f" {needle}" in words for needle in needles):
            return kind
    return None


_GUIDANCE: dict[str, tuple[str, str]] = {
    "new": (
        "发布说明以官方来源为准；接入前核对可用地区、价格和配额。",
        "Confirm region, pricing and quotas in the official source before adopting.",
    ),
    "updated": (
        "已在用的团队按变化内容回归测试受影响的功能。",
        "Teams already using it should regression-test the affected feature.",
    ),
    "availability": (
        "核对自己的账号、地区和接入方式是否在新的开放范围内。",
        "Check whether your account, region and access channel fall inside the new scope.",
    ),
    "deprecated": (
        "按官方时间表安排迁移，并确认替代方案。",
        "Plan migration against the official schedule and confirm the replacement.",
    ),
    "pricing": (
        "按新价格重新估算用量成本。",
        "Re-estimate usage cost at the new price.",
    ),
}


def claim_change_detail(claim, kind: str, entity_name: LocalizedText):
    """Describe a reviewed change using only the reviewed fact; no inferred content."""
    from .schemas import ChangeDetail

    Text = LocalizedText
    value = (claim.object_or_value or "").strip()
    guidance_zh, guidance_en = _GUIDANCE.get(kind, _GUIDANCE["updated"])
    return ChangeDetail(
        description=Text(zh=claim.text.zh, en=claim.text.en),
        # A single reviewed fact records the new state only; the prior state is unknown.
        before=Text(zh="来源未说明变化前的状态。", en="The source does not state the prior state."),
        after=Text(zh=value or claim.text.zh, en=value or claim.text.en),
        affected=Text(zh=f"{entity_name.zh} 的使用者", en=f"Users of {entity_name.en}"),
        action=Text(zh=guidance_zh, en=guidance_en),
    )
