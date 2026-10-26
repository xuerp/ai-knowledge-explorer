"""Explicit account-scoped runtime with a durable, non-renewing call budget.

No extraction credentials are reused. Reservations commit before transport.
Failures, invalid meanings and uncertain in-flight calls close the budget;
restarts, concurrent processes and configuration changes cannot replenish it.
"""

import hashlib
import json
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .database import AuditLogRecord
from .database import DecisionInterpretationBudgetRecord as Budget
from .decision_semantic_transport import ChatTaskInterpreter
from .decision_semantics import normalize_proposal, validate_meaning


class BudgetedTaskInterpreter:
    def __init__(self, database, adapter, *, budget_id, max_calls, user_ids):
        self.database, self.adapter = database, adapter
        self.budget_id, self.max_calls = budget_id, max_calls
        self.user_ids = frozenset(user_ids)
        profile = [adapter.endpoint, adapter.model, max_calls, sorted(self.user_ids), 4096, 8192]
        self.profile_sha256 = hashlib.sha256(json.dumps(profile).encode()).hexdigest()

    def allows_user(self, user_id):
        return user_id in self.user_ids

    def _reserve(self, task):
        attempt_id = str(uuid4())
        now = datetime.now(UTC)
        detail = {
            "budgetId": self.budget_id,
            "sourceSha256": hashlib.sha256(task.encode()).hexdigest(),
            "status": "reserved",
        }
        with self.database.session() as session:
            insert = sqlite_insert if session.bind.dialect.name == "sqlite" else postgres_insert
            session.execute(
                insert(Budget)
                .values(
                    id=self.budget_id,
                    profile_sha256=self.profile_sha256,
                    limit_calls=self.max_calls,
                    used_calls=0,
                    known_tokens=0,
                    unknown_usage_calls=0,
                    blocked=False,
                    active_attempt_id=None,
                    updated_at=now,
                )
                .on_conflict_do_nothing(index_elements=["id"])
            )
            row = session.get(Budget, self.budget_id)
            if row.profile_sha256 != self.profile_sha256 or row.limit_calls != self.max_calls:
                raise ValueError("The approved budget profile has changed.")
            reserved = session.execute(
                update(Budget)
                .where(
                    Budget.id == self.budget_id,
                    Budget.blocked.is_(False),
                    Budget.active_attempt_id.is_(None),
                    Budget.used_calls < Budget.limit_calls,
                )
                .values(
                    used_calls=Budget.used_calls + 1, active_attempt_id=attempt_id, updated_at=now
                )
            )
            if reserved.rowcount != 1:
                raise ValueError("The interpretation budget is closed or already in use.")
            audit = AuditLogRecord(
                actor="decision-interpreter",
                action="decision.interpret",
                target_type="task-meaning",
                target_id=attempt_id,
                detail_json=json.dumps(detail),
                created_at=now,
            )
            session.add(audit)
            session.flush()
            audit_id = audit.id
            session.commit()
        return attempt_id, audit_id, detail

    def _finish(self, attempt_id, audit_id, detail, state):
        exchange = self.adapter.last_exchange
        total = exchange.get("totalTokens")
        known = total if detail.get("receiptValid") and type(total) is int and total > 0 else 0
        # Never store task text, endpoint URLs, keys or supplier error bodies.
        detail.update(status=state, knownTokens=known, usageUnknown=not bool(known))
        detail["exchange"] = {
            key: exchange[key]
            for key in (
                "httpStatus",
                "promptTokens",
                "completionTokens",
                "reasoningTokens",
                "finishReason",
                "elapsedMs",
                "errorType",
            )
            if key in exchange
        }
        with self.database.session() as session:
            result = session.execute(
                update(Budget)
                .where(Budget.id == self.budget_id, Budget.active_attempt_id == attempt_id)
                .values(
                    active_attempt_id=None,
                    blocked=state != "validated",
                    known_tokens=Budget.known_tokens + known,
                    unknown_usage_calls=Budget.unknown_usage_calls + int(not known),
                    updated_at=datetime.now(UTC),
                )
            )
            if result.rowcount != 1:
                raise ValueError("The interpretation reservation could not be finalized.")
            session.get(AuditLogRecord, audit_id).detail_json = json.dumps(detail)
            session.commit()

    def interpret(self, request):
        task = request["task"]
        if (
            len(task.encode()) > 8192
            or len(json.dumps(request, ensure_ascii=False).encode()) > 32768
        ):
            raise ValueError("The interpretation input exceeds the approved bound.")
        attempt_id, audit_id, detail = self._reserve(task)
        state = "failed"
        try:
            raw = self.adapter.interpret(request)
            exchange = self.adapter.last_exchange
            prompt, completion, total = (
                exchange.get(key) for key in ("promptTokens", "completionTokens", "totalTokens")
            )
            if (
                any(type(value) is not int or value < 0 for value in (prompt, completion, total))
                or total != prompt + completion
            ):
                raise ValueError("The provider usage receipt is incomplete or inconsistent.")
            detail["receiptValid"] = True
            if completion > 4096 or prompt > 33280:
                raise ValueError("The provider exceeded the approved token bounds.")
            if self.adapter.last_exchange.get("returnedModel") != self.adapter.model:
                raise ValueError("The provider returned an unapproved model.")
            state = "invalid"
            normalized, _ = normalize_proposal(raw, task)
            validate_meaning(normalized, task)
            state = "validated"
            return raw
        except (ValueError, TypeError):
            if state == "invalid":
                # Preserve the standard invalid receipt as well as closing the
                # durable budget. No retry is performed by either layer.
                return raw
            raise
        finally:
            self._finish(attempt_id, audit_id, detail, state)

    def diagnostics(self):
        with self.database.session() as session:
            row = session.get(Budget, self.budget_id)
            profile_matches = not row or row.profile_sha256 == self.profile_sha256
            return {
                "enabled": True,
                "budgetId": self.budget_id,
                "limitCalls": self.max_calls,
                "usedCalls": row.used_calls if row else 0,
                "remainingCalls": max(0, self.max_calls - (row.used_calls if row else 0)),
                "blocked": bool(row and (row.blocked or not profile_matches)),
                "profileMatches": profile_matches,
                "inFlightOrInterrupted": bool(row and row.active_attempt_id),
                "knownTokens": row.known_tokens if row else 0,
                "unknownUsageCalls": row.unknown_usage_calls if row else 0,
            }


def configured_task_interpreter(settings, database):
    if not settings.decision_interpretation_enabled:
        return None
    adapter = ChatTaskInterpreter(
        endpoint=settings.decision_interpretation_api_url,
        api_key=settings.decision_interpretation_api_key,
        model=settings.decision_interpretation_model,
        max_calls=100,
        response_timeout_seconds=80,
        reasoning_effort="low",
    )
    return BudgetedTaskInterpreter(
        database,
        adapter,
        budget_id=settings.decision_interpretation_budget_id,
        max_calls=settings.decision_interpretation_max_calls,
        user_ids=settings.decision_interpretation_user_ids,
    )
