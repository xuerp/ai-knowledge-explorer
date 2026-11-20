"""Grounded data-boundary requirements, separate from deployment capability."""

import json
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

CLOUD_API_RESTRICTION = re.compile(
    r"\b(?:no|without) (?:external )?cloud api\b|"
    r"\b(?:must not|cannot|can't|do not) (?:use|call) (?:an? |the )?(?:external )?cloud api\b|"
    r"(?:不能|不得|禁止|不允许|不要)(?:使用|调用)(?:外部)?云\s*API",
    re.IGNORECASE,
)
FILE_TRANSFER = re.compile(
    r"上传|外传|传出|离开|\b(?:uploads?|uploading|transfer|send|leave|off.device)\b",
    re.IGNORECASE,
)


class TaskRequirement(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    dimension: Literal[
        "processing-region", "data-residency", "cross-border", "upload", "network", "other"
    ]
    operator: Literal["equals", "forbid", "requires"]
    value: str = Field(min_length=1, max_length=200)
    unit: str | None = None
    strength: Literal["hard", "preference"]
    quote: str = Field(min_length=1, max_length=1000)
    scope: Literal["all-processing", "local-device", "organization", "unspecified"]


def explicit_data_requirements(text):
    requirements = []
    for clause in re.split(r"[，,。；;.!\n]", text):
        clause = clause.strip()
        if not clause or re.search(
            r"不要求|不需要|无需|不用|not required|no need", clause, re.IGNORECASE
        ):
            continue
        specs = []
        if re.search(
            r"\bair.gapped\b|\bfully offline\b|全程断网|完全(?:断网|离线)|必须断网",
            clause,
            re.IGNORECASE,
        ):
            specs.append(("network", "forbid", "external-network", "local-device"))
        if re.search(
            r"不能.{0,12}(?:境外|海外)|不得.{0,12}(?:境外|海外)|不出境|禁止.{0,8}跨境|no cross.border|must not.{0,12}(?:overseas|cross.border)",
            clause,
            re.IGNORECASE,
        ):
            specs.append(("cross-border", "forbid", "transfer", "all-processing"))
        if re.search(
            r"(?:处理|存储|保存|驻留).{0,8}(?:必须|只能).{0,8}(?:境内|中国)|(?:必须|只能).{0,8}(?:境内|中国).{0,8}(?:处理|存储|保存)|data (?:residency|processing).{0,12}(?:China|CN)",
            clause,
            re.IGNORECASE,
        ):
            dimension = (
                "data-residency"
                if re.search(r"存储|保存|驻留|residency", clause, re.IGNORECASE)
                else "processing-region"
            )
            specs.append((dimension, "equals", "CN", "all-processing"))
        if re.search(
            r"(?:不能|禁止|不得|不允许|不要|严禁)(?:从.{0,8}?)?上传|"
            r"(?:不能|不得).{0,6}离开.{0,6}(?:设备|电脑)|no uploads?|must not upload",
            clause,
            re.IGNORECASE,
        ):
            scope = (
                "local-device"
                if re.search(r"本机|本地设备|电脑|local device", clause, re.IGNORECASE)
                else "unspecified"
            )
            specs.append(("upload", "forbid", "outside-boundary", scope))
        for dimension, operator, value, scope in specs:
            requirements.append(
                TaskRequirement(
                    dimension=dimension,
                    operator=operator,
                    value=value,
                    strength="hard",
                    quote=clause,
                    scope=scope,
                )
            )
    return requirements


def cloud_api_mislabeled_as_upload(item):
    """A restriction on a provider interface does not define a file boundary."""
    return (
        item.dimension == "upload"
        and CLOUD_API_RESTRICTION.search(item.quote)
        and not FILE_TRANSFER.search(item.quote)
    )


def context_requirements(context):
    text = (
        (context._original_task or context.task)
        + "\n"
        + "\n".join(answer.text or "" for answer in context.intent_answers)
    )
    requirements = explicit_data_requirements(text)
    receipt = context.task_meaning
    if receipt and receipt.status == "validated" and receipt.meaning:
        requirements.extend(receipt.meaning.requirements)
    scope = next(
        (
            answer.option_id
            for answer in reversed(context.intent_answers)
            if answer.question_id == "upload-boundary"
            and answer.option_id in {"local-device", "organization"}
        ),
        None,
    )
    unique = {}
    for item in requirements:
        # A validated quote is a provenance check, not proof that the model's
        # semantic interpretation is correct. Keep explicit constraints additive.
        if item.quote in text:
            if scope and item.dimension == "upload" and item.scope == "unspecified":
                item = item.model_copy(update={"scope": scope})
            unique[(item.dimension, item.operator, item.value, item.scope, item.strength)] = item
    return list(unique.values())


def requirement_checks(context, claims):
    checks = []
    channel = context.service_access.channel if context.service_access else context.budget.channel
    for item in context_requirements(context):
        values, ids = set(), []
        for claim in claims:
            if claim.predicate != "data-handling":
                continue
            try:
                fact = json.loads(claim.object_or_value or "")
            except (TypeError, ValueError):
                continue
            if not isinstance(fact, dict) or item.scope == "unspecified":
                continue
            # Same deployment route AND channel: open weights, a CN API entry,
            # or one vendor office location never prove the full data boundary.
            if (
                fact.get("dimension") != item.dimension
                or fact.get("scope") != item.scope
                or fact.get("deployment") != context.deployment
                or context.deployment == "undecided"
                or (fact.get("channel") or None) != (channel or None)
            ):
                continue
            if fact.get("operator") == item.operator and fact.get("value") == item.value:
                if fact.get("satisfied") is True:
                    values.add("satisfied")
                    ids.append(claim.id)
                elif fact.get("satisfied") is False:
                    values.add("unsatisfied")
                    ids.append(claim.id)
        state = next(iter(values)) if len(values) == 1 else "unknown"
        checks.append(
            {
                "requirement": item.model_dump(),
                "state": state,
                "claimIds": ids,
                "conflict": len(values) > 1,
            }
        )
    return checks
