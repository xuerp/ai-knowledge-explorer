"""Conservative, cited projections of reviewed Claim formats, never catalog inference.

The original Claim is authoritative. Normalization is deterministic and shared by
constraints, comparison, and conflict detection. Descriptions of a model line,
lower bounds and conditional access do not prove exact version specifications.
"""

import json
import re
from dataclasses import dataclass

from .decision_licenses import commercial_policy
from .schemas import Claim


@dataclass(frozen=True)
class DecisionFact:
    dimension: str
    value: str | int
    claim_id: str
    qualification: str | None = None


def tokens(value: str) -> int | None:
    match = re.fullmatch(r"([1-9][\d,]*(?:\.\d+)?)\s*([kKmM万]?)\s*(?:tokens?)?", value.strip())
    if not match:
        return None
    number = float(match[1].replace(",", "")) * {"k": 1000, "m": 1000000, "万": 10000}.get(
        match[2].lower(), 1
    )
    return int(number) if number.is_integer() and 0 < number <= 100000000 else None


def normalized_facts(claim: Claim) -> list[DecisionFact]:
    """Call only with current, published, sourced Claims for decision use."""
    predicate = (claim.predicate or "").strip().lower()
    value = (claim.object_or_value or "").strip()
    text = claim.text.zh + " " + claim.text.en
    facts: list[DecisionFact] = []

    def add(dimension: str, item: str | int, qualification: str | None = None):
        fact = DecisionFact(dimension, item, claim.id, qualification)
        if fact not in facts:
            facts.append(fact)

    if predicate == "context_tokens" and re.fullmatch(r"[1-9]\d{0,8}", value):
        add("context", int(value))
    elif predicate in {"context-window", "context"} and (capacity := tokens(value)):
        add("context", capacity)
    elif predicate == "official-model-specification":
        parts = [part.strip() for part in value.split(";")]
        capacities = [part[8:] for part in parts[1:] if part.startswith("context=")]
        if len(capacities) == 1 and (capacity := tokens(capacities[0])):
            add("context", capacity)
        model_id = parts[0]
        if re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]+", model_id) and re.search(
            r"(?:API\s*(?:型号为|ID\s*为)|API model ID\s*(?:is|:))\s*"
            + re.escape(model_id)
            + r"(?![\w.-])",
            text,
            re.IGNORECASE,
        ):
            add("deployment", "cloud-api")
    # Explicit numeric version statements. Reject ranges, output-only numbers,
    # family descriptions, and contextual examples instead of guessing capacity.
    if predicate in {"catalog-review", "context-window"} or not predicate:
        capacities = re.findall(
            r"(?<!不)(?:列出|支持|拥有|lists?|supports?)\s*([\d,]+(?:\.\d+)?\s*[kKmM万]?)\s*(?:token\s*)?(?:输入上下文|上下文|context)",
            text,
            re.IGNORECASE,
        )
        if not re.search(
            r"模型线|model.line|超过|至少|up to|more than|at least|does not support|not supported",
            text,
            re.IGNORECASE,
        ):
            for raw in capacities:
                if capacity := tokens(raw):
                    add("context", capacity)
    if predicate == "deployment" and value in {"cloud-api", "private", "hybrid", "on-device"}:
        add("deployment", value)
    if predicate == "product-entry":
        try:
            entries = json.loads(value)
        except (ValueError, TypeError):
            entries = None
        if (
            isinstance(entries, list)
            and entries
            and all(
                isinstance(entry, str)
                and entry in {"terminal", "ide", "desktop", "web", "cloud-task"}
                for entry in entries
            )
        ):
            for entry in entries:
                add("product-entry", entry)
    if predicate == "workflow-qualification" and value in {
        "account-tier",
        "product-scope",
        "permissions",
        "model-configuration",
    }:
        add("workflow-qualification", value)
    if predicate == "access" and value in {"open-weights", "closed-weights"}:
        add("access", value)
    if predicate in {"access", "catalog-review"}:
        # A positively asserted entry is distinct from an API alias or mention.
        if re.search(
            r"(?:提供|保留|列出).{0,12}开放权重(?:部署入口|下载)|Official downloadable .* weights|downloadable weights",
            text + " " + value,
            re.IGNORECASE,
        ) and not re.search(
            r"(?:no|not|unverified).{0,8}downloadable weights|不(?:提供|支持).{0,8}开放权重",
            text + " " + value,
            re.IGNORECASE,
        ):
            add("access", "open-weights")
        if re.search(
            r"(?:列出|提供).{0,12}(?:API与权重下载/本地部署指南|权重下载/本地部署指南)", text
        ):
            add("deployment", "private", "deployment-guide")
        if re.search(
            r"Official API and downloadable weights", value, re.IGNORECASE
        ) and not re.search(r"current API.*unverified", value, re.IGNORECASE):
            add("deployment", "cloud-api")
    if predicate == "region" and value:
        add("region", value)
    if predicate == "input_modality" and value in {"text", "image", "audio", "video"}:
        add("input-modalities", value)
    if (
        predicate in {"context-window", "official-model-specification", "catalog-review"}
        or (predicate == "workflow-feature" and value == "document-input")
        or not predicate
    ):
        # Input lists are positive assertions; never read output as input.
        for raw in (
            raw
            for clause in re.split(r"[。；;.!]", text)
            if not re.search(
                r"可能|也许|未核验|尚未|model family|model line|may support|unverified",
                clause,
                re.IGNORECASE,
            )
            for raw in re.findall(
                r"(?<!不)(?:接受|原生支持|支持|列出)([^。；;]{1,45}?)输入", clause
            )
        ):
            if not re.search(r"不支持|不接受|尚未|未核验|可能|仅输出", raw):
                for word, modality in [
                    ("文本", "text"),
                    ("图像", "image"),
                    ("图片", "image"),
                    ("音频", "audio"),
                    ("视频", "video"),
                ]:
                    if word in raw:
                        add("input-modalities", modality)
        if re.search(r"列出文本模态", text):
            add("input-modalities", "text")
        # Reviewed catalog summaries also use a noun list ("text/image input")
        # without a supports verb. Restrict this to explicit input clauses,
        # reject negation/uncertainty and never infer from 'multimodal' or output.
        for clause in re.split(r"[。；;.!]", text):
            if re.search(
                r"不支持|不接受|未核验|尚未|可能|模型线|系列|without|does not|unsupported|unverified|may support|model line|family",
                clause,
                re.IGNORECASE,
            ):
                continue
            lists = re.findall(
                r"((?:(?:文本|图像|图片|音频|视频)(?:\s*[、与和/,]\s*)?)+)\s*输入",
                clause,
            ) + re.findall(
                r"((?:(?:text|image|audio|video)(?:\s*(?:,|/|and)\s*)?)+)\s+inputs?\b",
                clause,
                re.IGNORECASE,
            )
            for raw in lists:
                for words, modality in [
                    (["文本", "text"], "text"),
                    (["图像", "图片", "image"], "image"),
                    (["音频", "audio"], "audio"),
                    (["视频", "video"], "video"),
                ]:
                    if any(word in raw.lower() for word in words):
                        add("input-modalities", modality)
    if predicate == "commercial_use" and value in {"allowed", "prohibited"}:
        add("commercial-use", value)
    elif predicate == "commercial_use" and (policy := commercial_policy(claim)):
        add("commercial-use", policy["permission"], value)
    if predicate in {"licensed-under", "uses-license"}:
        if value:
            add("license", value)
        if re.search(
            r"commercial use requires prior written authorization|商用须事先取得书面授权",
            text + " " + value,
            re.IGNORECASE,
        ):
            add("commercial-use", "authorization-required", "prior-written-authorization")
    return facts


def fact_values(claims: list[Claim], dimension: str) -> set[str | int]:
    return {
        fact.value
        for claim in claims
        for fact in normalized_facts(claim)
        if fact.dimension == dimension
    }
