"""Exact service scopes for reviewed commercial permissions, never vendor inheritance."""

import json

from .schemas import Claim, DecisionContext


def service_billing_mismatch(context: DecisionContext) -> bool:
    return bool(
        context.service_access
        and context.budget.mode == "range"
        and context.budget.channel
        and context.service_access.channel.casefold() != context.budget.channel.strip().casefold()
    )


def commercial_policy(claim: Claim) -> dict | None:
    if claim.predicate != "commercial_use":
        return None
    try:
        value = json.loads(claim.object_or_value or "")
    except (ValueError, TypeError):
        return None
    if not isinstance(value, dict) or set(value) != {
        "permission",
        "scope",
        "channel",
        "tier",
        "serviceRegions",
        "deployment",
    }:
        return None
    if (
        value["permission"] not in ("allowed", "prohibited")
        or value["scope"] != "api-service"
        or not isinstance(value["channel"], str)
        or not value["channel"].strip()
        or value["tier"] not in ("paid", "free")
        or value["deployment"] != "cloud-api"
        or not isinstance(value["serviceRegions"], list)
        or not value["serviceRegions"]
        or any(
            not isinstance(region, str)
            or len(region) != 2
            or not region.isascii()
            or not region.isupper()
            or not region.isalpha()
            for region in value["serviceRegions"]
        )
    ):
        return None
    return value


def commercial_status(claim: Claim, context: DecisionContext) -> str | None:
    if claim.predicate != "commercial_use":
        return None
    if claim.object_or_value in {"allowed", "prohibited"}:
        return claim.object_or_value  # Existing explicit, reviewed unscoped format.
    policy = commercial_policy(claim)
    access = context.service_access
    if policy is None or access is None:
        return None
    if (
        access.channel.casefold() != policy["channel"].strip().casefold()
        or access.tier != policy["tier"]
        or access.region not in policy["serviceRegions"]
        or context.deployment != policy["deployment"]
    ):
        return None
    return policy["permission"]


def commercial_scope_missing(context: DecisionContext, claims: list[Claim]) -> bool:
    if not context.commercial_use_required or any(commercial_status(c, context) for c in claims):
        return False
    policies = [policy for claim in claims if (policy := commercial_policy(claim))]
    if not policies:
        return False  # No actual terms available: this is a source gap, not user error.
    access = context.service_access
    if access is None or not access.channel:
        return True
    return any(
        access.channel.casefold() == policy["channel"].strip().casefold()
        and (access.tier == "unknown" or not access.region or context.deployment == "undecided")
        for policy in policies
    )
