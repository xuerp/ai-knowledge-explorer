from datetime import UTC, datetime

from sqlalchemy.orm import Session

from ..auth import Principal
from ..database import DocumentSnapshotRecord, EntryRequestRecord
from ..entry_request_automation import (
    automation_candidates,
    close_reviewed_requests,
    record_outcome,
    request_kind,
    request_source,
    skip_reason,
)
from ..extraction import ExtractionBudgetUnavailable
from ..schemas import DocumentIngestRequest

AUTOMATION = Principal(subject="automation", email="automation@ai-radar.local", role="admin")


class EntryRequestServices:
    def run_entry_request_automation(
        self, session: Session, slots: int, *, now: datetime | None = None
    ) -> dict[str, object]:
        """Fetch and extract open entry requests within the given daily slots.

        Each attempted request uses one slot, like a scheduled snapshot. Requests
        that cannot be handled (no official page, host not allow-listed) are
        marked skipped without using a slot.
        """
        current = now or datetime.now(UTC)
        summary: dict[str, object] = {
            "attempted": 0,
            "candidatesCreated": 0,
            "noEvidence": 0,
            "skipped": 0,
            "failed": 0,
            "closed": close_reviewed_requests(session, current),
        }
        allowed = self.fetcher.allowed_hosts
        for row in automation_candidates(session, current, slots + 20):
            reason = skip_reason(row, allowed)
            if reason:
                record_outcome(row, "skipped", reason, current)
                session.commit()
                summary["skipped"] = int(summary["skipped"]) + 1
                continue
            if int(summary["attempted"]) >= slots:
                break
            if not self.attempt_entry_request(session, row, current, summary):
                break
        return summary

    def attempt_entry_request(
        self,
        session: Session,
        row: EntryRequestRecord,
        current: datetime,
        summary: dict[str, object],
    ) -> bool:
        """Handle one request. Returns False when the budget stops the cycle."""
        request_id = row.id
        kind = request_kind(row)
        summary["attempted"] = int(summary["attempted"]) + 1
        try:
            source = request_source(session, row, current)
            # The same reservation as scheduled extraction, so daily slots are shared.
            self.audit.record(
                session,
                AUTOMATION,
                "extraction.reserved",
                "entry_request",
                request_id,
                {"sourceId": source.id, "kind": kind},
            )
            session.commit()
            document = self.fetcher.fetch(row.source_url)
            ingested = self.ingestion.ingest_document(
                session, source.id, DocumentIngestRequest(content=document.content)
            )
            snapshot = session.get(DocumentSnapshotRecord, ingested.snapshot_id)
            created, duplicates = self.create_extraction_candidates(
                session,
                source,
                snapshot,
                self.app_settings.auto_extraction_max_candidates_per_snapshot,
            )
        except ExtractionBudgetUnavailable as error:
            session.rollback()
            summary["attempted"] = int(summary["attempted"]) - 1
            summary["pausedReason"] = "monetary-budget-unavailable"
            self.audit.record(
                session,
                AUTOMATION,
                "entry-request.auto-failed",
                "entry_request",
                request_id,
                {"kind": kind, "error": str(error)[:300]},
            )
            session.commit()
            return False
        except Exception as error:  # noqa: BLE001 - keep the request for a later retry
            session.rollback()
            row = session.get(EntryRequestRecord, request_id)
            record_outcome(row, "failed", "自动处理失败：" + str(error)[:300], current)
            self.audit.record(
                session,
                AUTOMATION,
                "entry-request.auto-failed",
                "entry_request",
                request_id,
                {"kind": kind, "error": str(error)[:300]},
            )
            session.commit()
            summary["failed"] = int(summary["failed"]) + 1
            return True
        row = session.get(EntryRequestRecord, request_id)
        ids = [item.id for item in created]
        if ids:
            detail = f"已从官方页面生成 {len(ids)} 条待审事实，审核通过后会进入知识库。"
            record_outcome(row, "candidates", detail, current, ids)
            summary["candidatesCreated"] = int(summary["candidatesCreated"]) + len(ids)
        else:
            detail = (
                "官方页面里的事实都已收录或已在审核中，没有新增内容。"
                if duplicates
                else "官方页面里没有找到能逐字核对的事实，需要人工确认。"
            )
            record_outcome(row, "no-evidence", detail, current, [])
            summary["noEvidence"] = int(summary["noEvidence"]) + 1
        self.audit.record(
            session,
            AUTOMATION,
            "entry-request.auto-handled",
            "entry_request",
            request_id,
            {
                "kind": kind,
                "sourceId": source.id,
                "candidateIds": ids,
                "duplicatesSkipped": duplicates,
                "providerCall": self.extraction.call_metadata(),
            },
        )
        session.commit()
        return True
