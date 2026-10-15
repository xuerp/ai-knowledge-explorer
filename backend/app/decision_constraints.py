"""Hard constraints on current published evidence; no capability scoring.

Machine-readable price facts use predicate=api_price and JSON object_or_value.
They are accepted only from the current snapshot's verified, sourced Claims.
Catalog specs and textual keyword matches cannot prove a budget or deployment.
"""

import json
import math
import re
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

from .decision_facts import fact_values, normalized_facts
from .decision_licenses import commercial_status, service_billing_mismatch
from .schemas import Claim, DecisionContext, Entity, KnowledgeSnapshot


def date_value(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).date()
    except (ValueError, TypeError):
        return None


def observed_price_value(claim: Claim) -> dict | None:
    """An explicitly observed living quote, never an invented tariff start date."""
    if claim.predicate != "api_price" or claim.valid_from:
        return None
    try:
        price = json.loads(claim.object_or_value or "")
    except (ValueError, TypeError):
        return None
    if not isinstance(price, dict) or price.get("quoteBasis") != "observed-list-price":
        return None
    try:
        observed = datetime.fromisoformat(price.get("observedAt", ""))
    except (ValueError, TypeError):
        return None
    if (
        observed.tzinfo is None
        or price.get("observedAt") != claim.observed_at
        or not timedelta(0) <= datetime.now(UTC) - observed <= timedelta(days=7)
        or price.get("conditions") != "standard-uncached-tokens-only"
        or not isinstance(price.get("sourceUrl"), str)
        or urlsplit(price["sourceUrl"]).scheme != "https"
    ):
        return None
    return price


def current_observed_quote(claim: Claim, sources: dict) -> bool:
    price = observed_price_value(claim)
    if not price or not claim.source_ids:
        return False
    return all(
        (source := sources.get(source_id)) is not None
        and source.type == "official"
        and source.url == price["sourceUrl"]
        and bool((source.source_excerpt or "").strip())
        and date_value(source.verified_at) is not None
        and date_value(claim.observed_at)
        <= date_value(source.verified_at)
        <= datetime.now(UTC).date()
        for source_id in claim.source_ids
    )


def current_claims(claims: list[Claim], snapshot: KnowledgeSnapshot) -> list[Claim]:
    public = {claim.id: claim for claim in snapshot.claims}
    sources = {source.id: source for source in snapshot.evidence}
    today = datetime.now(UTC).date()
    return [
        claim
        for claim in claims
        if public.get(claim.id) == claim
        and claim.confidence == "verified"
        and claim.source_ids
        and all(source_id in sources for source_id in claim.source_ids)
        and (
            claim.predicate != "api_price"
            or claim.valid_from
            or current_observed_quote(claim, sources)
        )
        and (
            not claim.valid_from
            or (date_value(claim.valid_from) is not None and date_value(claim.valid_from) <= today)
        )
        and (
            not claim.valid_to
            or (date_value(claim.valid_to) is not None and date_value(claim.valid_to) > today)
        )
        and (
            date_value(claim.valid_from) is not None
            or any(
                date_value(sources[source_id].published_at) is not None
                and date_value(sources[source_id].published_at) <= today
                for source_id in claim.source_ids
            )
            or (
                # A reviewed living-document quotation can establish current
                # categorical input/deployment support without inventing a
                # publication/release date. This does not cover numeric specs.
                # Other numeric facts and licenses retain their date gates.
                # Prices have a separate seven-day quotation rule below.
                (
                    claim.predicate
                    in {"workflow-feature", "product-entry", "workflow-qualification"}
                    or (
                        claim.predicate == "input_modality"
                        and claim.object_or_value in {"text", "image", "audio", "video"}
                    )
                    or (
                        claim.predicate == "deployment"
                        and claim.object_or_value in {"cloud-api", "private", "on-device", "hybrid"}
                    )
                )
                and all(
                    sources[source_id].type == "official"
                    and bool((sources[source_id].source_excerpt or "").strip())
                    and urlsplit(sources[source_id].url).scheme == "https"
                    and date_value(sources[source_id].verified_at) is not None
                    and 0 <= (today - date_value(sources[source_id].verified_at)).days <= 90
                    for source_id in claim.source_ids
                )
            )
            or current_observed_quote(claim, sources)
        )
    ]


def api_price_value(claim: Claim) -> dict | None:
    """One validation rule for budget checks and evidence comparison price rows."""
    if claim.predicate != "api_price" or (
        not claim.valid_from and observed_price_value(claim) is None
    ):
        return None
    try:
        price = json.loads(claim.object_or_value or "")
        if not isinstance(price, dict) or price.get("unit") != "per-million-tokens":
            return None
        if (
            any(key in price for key in ("quoteBasis", "observedAt", "sourceUrl"))
            and observed_price_value(claim) is None
        ):
            return None
        if any(
            not isinstance(price.get(key), str) or not price[key].strip()
            for key in ("currency", "channel")
        ):
            return None
        rates = [price.get(key) for key in ("input", "output")]
        if any(
            isinstance(rate, bool)
            or not isinstance(rate, (int, float))
            or not math.isfinite(rate)
            or rate < 0
            for rate in rates
        ):
            return None
        return price
    except (ValueError, TypeError):
        return None


def token_quote_bounds(price: dict, context: DecisionContext) -> tuple[float, float] | None:
    """Only an explicitly scoped estimate may consume condition-bearing quotes.

    With unknown request lengths, tiered rates bound token costs conservatively.
    A range crossing the ceiling cannot establish either fit or over-budget.
    """
    extra = set(price) - {"input", "output", "currency", "channel", "unit"}
    rates = [(price["input"], price["output"])]
    if extra:
        if (
            context.budget.cost_scope != "standard-token-only"
            or extra - {"conditions", "tiers", "quoteBasis", "observedAt", "sourceUrl"}
            or price.get("conditions") != "standard-uncached-tokens-only"
        ):
            return None
        tiers = price.get("tiers")
        if tiers is not None:
            if not isinstance(tiers, list) or not tiers:
                return None
            limits = []
            rates = []
            for tier in tiers:
                if not isinstance(tier, dict) or set(tier) != {
                    "upToInputTokens",
                    "input",
                    "output",
                }:
                    return None
                limit = tier["upToInputTokens"]
                if limit is not None and (
                    isinstance(limit, bool) or not isinstance(limit, int) or limit <= 0
                ):
                    return None
                if any(
                    isinstance(tier[key], bool)
                    or not isinstance(tier[key], (int, float))
                    or not math.isfinite(tier[key])
                    or tier[key] < 0
                    for key in ("input", "output")
                ):
                    return None
                limits.append(limit)
                rates.append((tier["input"], tier["output"]))
            if (
                limits[-1] is not None
                or any(limit is None for limit in limits[:-1])
                or limits[:-1] != sorted(set(limits[:-1]))
                or rates[0] != (price["input"], price["output"])
            ):
                return None
            if context.budget.maximum_input_tokens_per_request is not None:
                maximum = context.budget.maximum_input_tokens_per_request
                eligible_rates = []
                lower = 0
                for limit, rate in zip(limits, rates, strict=True):
                    if lower < maximum:
                        eligible_rates.append(rate)
                    if limit is None:
                        break
                    lower = limit
                rates = eligible_rates
    budget = context.budget
    if service_billing_mismatch(context):
        return None
    if budget.period == "month":
        if budget.monthly_input_tokens is None or budget.monthly_output_tokens is None:
            return None
        # Independent extrema also safely cover workloads mixed across tiers.
        low = (
            min(row[0] for row in rates) * budget.monthly_input_tokens / 1e6
            + min(row[1] for row in rates) * budget.monthly_output_tokens / 1e6
        )
        high = (
            max(row[0] for row in rates) * budget.monthly_input_tokens / 1e6
            + max(row[1] for row in rates) * budget.monthly_output_tokens / 1e6
        )
    else:
        low = min(row[0] for row in rates) + min(row[1] for row in rates)
        high = max(row[0] for row in rates) + max(row[1] for row in rates)
    return low, high


def api_price_basis(price: dict) -> dict:
    """Rates are values, including tier rates; only conditions form a common basis."""
    basis = {
        key: item
        for key, item in price.items()
        if key not in {"input", "output", "quoteBasis", "observedAt", "sourceUrl"}
    }
    if isinstance(basis.get("tiers"), list):
        basis["tiers"] = [
            {key: value for key, value in tier.items() if key not in {"input", "output"}}
            if isinstance(tier, dict)
            else tier
            for tier in basis["tiers"]
        ]
    return basis


def explicit_spec_fields(claim: Claim) -> dict[str, int | str]:
    """Read the existing official-spec record format, retaining its original citation.

    This is format normalization, not catalog or keyword inference. Callers must
    validate current public evidence first. A model ID alone never proves access.
    """
    return {
        fact.dimension: fact.value
        for fact in normalized_facts(claim)
        if fact.dimension in {"context", "deployment"}
    }


def context_values(claims: list[Claim], *, official_specs: bool = False) -> list[int]:
    values = []
    for claim in claims:
        if official_specs and "context" in (fields := explicit_spec_fields(claim)):
            values.append(fields["context"])
        if claim.predicate == "context_tokens":
            try:
                value = json.loads(claim.object_or_value or "")
            except (ValueError, TypeError):
                continue
            if isinstance(value, int) and not isinstance(value, bool) and value > 0:
                values.append(value)
    return values


def constraint_failures(entity: Entity, claims: list[Claim], context: DecisionContext) -> list[str]:
    failures = []
    if service_billing_mismatch(context):
        failures.append("billing-channel-mismatch")
    if context.workflow_version == 2 and entity.type == "model" and not entity.family_id:
        failures.append("concrete-version-required")
    if context.minimum_context_tokens is not None:
        values = context_values(claims, official_specs=context.workflow_version == 2)
        if len(set(values)) != 1:
            failures.append("context-unverified-or-conflicting")
        elif values[0] < context.minimum_context_tokens:
            failures.append("context-too-small")
    if context.input_modalities:
        supported = (
            fact_values(claims, "input-modalities") if context.workflow_version == 2 else set()
        )
        for claim in claims:
            if claim.predicate == "input_modality" and claim.object_or_value in {
                "text",
                "image",
                "audio",
                "video",
            }:
                supported.add(claim.object_or_value)
        if not set(context.input_modalities) <= supported:
            failures.append("input-modality-unverified")
    permissions = {commercial_status(claim, context) for claim in claims}
    if context.commercial_use_required and "allowed" not in permissions:
        failures.append("commercial-use-unverified")
        if context.workflow_version == 2 and "authorization-required" in fact_values(
            claims, "commercial-use"
        ):
            failures.append("commercial-authorization-required")
        if context.workflow_version == 2 and "prohibited" in permissions:
            failures.append("commercial-use-prohibited")
    identifiers = [
        entity.id,
        entity.slug,
        entity.name.zh,
        entity.name.en,
        entity.vendor or "",
        entity.family_id or "",
        *(entity.aliases or []),
    ]
    if any(
        excluded.casefold() in value.casefold()
        for excluded in context.exclusions
        for value in identifiers
        if value
    ):
        failures.append("excluded")
    for excluded in context.exclusions:
        normalized = excluded.strip().casefold()
        if normalized in {"不接受闭源", "不要闭源", "no closed source", "open weights required"}:
            if not any(
                c.predicate == "access" and c.object_or_value == "open-weights" for c in claims
            ) and not (
                context.workflow_version == 2 and "open-weights" in fact_values(claims, "access")
            ):
                failures.append("open-weights-unverified")
        elif normalized in {"必须境内部署", "必须中国境内部署", "china hosting required"}:
            if not any(c.predicate == "region" and c.object_or_value == "CN" for c in claims):
                failures.append("region-unverified")
        elif normalized in {"不接受无来源结论", "no unsourced claims"}:
            pass  # current_claims already enforces this invariant.
        elif re.search(
            r"必须|不接受|不要|排除|不能|\brequired\b|\bno\s|\bmust\b|\bexclude\b", normalized
        ):
            # A free-text constraint is never silently treated as satisfied.
            failures.append("exclusion-needs-clarification")
    types = {
        "model-api": {"model", "api"},
        "coding-product": {"application", "tool", "agent"},
        "agent-development": {"framework", "agent"},
        "unspecified": {entity.type},
    }
    if entity.type not in types[context.task_type]:
        failures.append("different-task-type")
    if entity.status in {"deprecated", "rumor"} or (
        entity.release
        and (
            entity.release.stage in {"pending", "deprecated", "retired"}
            or entity.release.catalog_current is False
        )
    ):
        failures.append("unavailable-version")
    if context.deployment != "undecided" and not any(
        (claim.predicate == "deployment" and claim.object_or_value == context.deployment)
        or (
            context.workflow_version == 2
            and explicit_spec_fields(claim).get("deployment") == context.deployment
        )
        for claim in claims
    ):
        failures.append("deployment-unverified")
    if context.region and not any(
        claim.predicate == "region"
        and (claim.object_or_value or "").casefold() == context.region.casefold()
        for claim in claims
    ):
        failures.append("region-unverified")
    budget = context.budget
    if budget.mode == "range":
        if context.workflow_version == 2 and context.deployment in {
            "private",
            "on-device",
            "hybrid",
        }:
            failures.append("infrastructure-cost-unverified")
        if budget.max is None or not budget.currency or not budget.channel:
            failures.append("budget-assumptions-missing")
        elif budget.period == "month" and (
            budget.monthly_input_tokens is None or budget.monthly_output_tokens is None
        ):
            failures.append("workload-missing")
        else:
            costs = []
            for claim in claims:
                price = api_price_value(claim)
                if price is None:
                    continue
                try:
                    if (
                        price["currency"] != budget.currency
                        or price["channel"] != budget.channel
                        or price["unit"] != "per-million-tokens"
                    ):
                        continue
                    bounds = token_quote_bounds(price, context)
                    if bounds is None:
                        failures.append("price-conditions-unverified")
                        continue
                    costs.append(bounds)
                except (ValueError, KeyError, TypeError):
                    continue
            if len(set(costs)) != 1:
                failures.append("price-unverified-or-conflicting")
            elif costs[0][0] > budget.max:
                failures.append("over-budget")
            elif costs[0][1] > budget.max:
                failures.append("price-conditions-unverified")
    return failures
