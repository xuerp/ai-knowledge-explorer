"""Durable monetary reservation. One in-flight call per approved budget.

Amounts are integer millionths of the configured currency. An interrupted or
unreceipted call retains its maximum reservation and closes the budget. No retry
or automatic month rollover can replenish an explicitly approved allocation.
"""

import hashlib
import json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .database import ModelBudgetRecord as Budget
from .database import ModelCallRecord as Call


class ModelBudgetUnavailable(ValueError):
    pass


class ModelBudget:
    def __init__(self, database, config):
        self.database, self.config = database, config
        self.profile = hashlib.sha256(
            json.dumps(config.profile(), sort_keys=True).encode()
        ).hexdigest()

    def reserve(self, user_id, purpose, input_bound, output_bound):
        cfg = self.config
        now = datetime.now(UTC)
        if user_id not in cfg.user_ids or now.strftime("%Y-%m") != cfg.month:
            raise ModelBudgetUnavailable(
                "Model access is outside the approved account/month scope."
            )
        cost = self.cost(input_bound, output_bound)
        attempt_id = str(uuid4())
        with self.database.session() as session:
            insert = sqlite_insert if session.bind.dialect.name == "sqlite" else postgres_insert
            session.execute(
                insert(Budget)
                .values(
                    id=cfg.budget_id,
                    profile_sha256=self.profile,
                    limit_units=cfg.limit_units,
                    charged_units=0,
                    used_calls=0,
                    blocked=False,
                )
                .on_conflict_do_nothing(index_elements=["id"])
            )
            locked = session.execute(
                update(Budget)
                .where(
                    Budget.id == cfg.budget_id,
                    Budget.profile_sha256 == self.profile,
                    Budget.blocked.is_(False),
                    Budget.active_attempt_id.is_(None),
                    Budget.used_calls < cfg.max_calls,
                    Budget.charged_units + cost <= Budget.limit_units,
                    Budget.charged_units + cost <= cfg.effective_limit_units,
                )
                .values(
                    charged_units=Budget.charged_units + cost,
                    used_calls=Budget.used_calls + 1,
                    active_attempt_id=attempt_id,
                )
            )
            if locked.rowcount != 1:
                raise ModelBudgetUnavailable(
                    "Model budget is closed, exhausted, changed or in use."
                )
            daily = session.scalar(
                select(func.count())
                .select_from(Call)
                .where(
                    Call.budget_id == cfg.budget_id,
                    Call.user_id == user_id,
                    Call.created_at >= now.replace(hour=0, minute=0, second=0, microsecond=0),
                )
            )
            if daily >= cfg.user_daily_calls:
                raise ModelBudgetUnavailable("Daily model allowance is exhausted.")
            session.add(
                Call(
                    id=attempt_id,
                    budget_id=cfg.budget_id,
                    user_id=user_id,
                    purpose=purpose,
                    reserved_units=cost,
                    charged_units=cost,
                    state="reserved",
                    created_at=now,
                )
            )
            session.commit()
        return attempt_id

    def cost(self, input_tokens, output_tokens):
        cfg = self.config
        return (
            input_tokens * cfg.input_rate + output_tokens * cfg.output_rate + 999_999
        ) // 1_000_000

    def finish(self, attempt_id, receipt, *, validated, input_bound, output_bound):
        counts = [receipt.get(key) for key in ("promptTokens", "completionTokens", "totalTokens")]
        known = (
            all(type(value) is int and value >= 0 for value in counts)
            and counts[2] == counts[0] + counts[1]
            and counts[2] > 0
            and receipt.get("returnedModel") == self.config.model
        )
        in_bounds = known and counts[0] <= input_bound and counts[1] <= output_bound
        with self.database.session() as session:
            row = session.get(Call, attempt_id)
            if row is None or row.state != "reserved":
                raise ValueError("Model reservation is missing or already settled.")
            actual = self.cost(counts[0], counts[1]) if known else row.reserved_units
            # A provider overage is neither a validated call nor a missing
            # receipt. Record the full observed estimate and close allocation.
            reserved_charge = actual if in_bounds else row.reserved_units
            settled = session.execute(
                update(Budget)
                .where(
                    Budget.id == row.budget_id,
                    Budget.active_attempt_id == attempt_id,
                )
                .values(
                    charged_units=Budget.charged_units - row.reserved_units + reserved_charge,
                    active_attempt_id=None,
                    blocked=not (validated and in_bounds),
                )
            )
            if settled.rowcount != 1:
                raise ValueError("Model reservation ownership changed.")
            row.charged_units = actual
            if not known:
                row.state = "usage-unknown"
            elif not in_bounds:
                row.state = "usage-out-of-bounds"
            else:
                row.state = "validated" if validated else "failed"
            row.receipt_json = json.dumps(
                {
                    key: receipt[key]
                    for key in (
                        "httpStatus",
                        "responseId",
                        "requestedOutputTokens",
                        "returnedModel",
                        "promptTokens",
                        "completionTokens",
                        "totalTokens",
                        "finishReason",
                        "elapsedMs",
                    )
                    if key in receipt
                }
            )
            session.commit()
        if not in_bounds:
            raise ValueError("Model receipt is unknown or outside approved bounds.")
