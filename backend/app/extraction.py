from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, ConfigDict, Field

from .database import DocumentSnapshotRecord, SourceRecord
from .schemas import CandidateCreate, Claim, ClaimText, Evidence, LocalizedText


class ExtractionUnavailableError(RuntimeError):
    pass


class _Fact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject: str = Field(min_length=1, max_length=300)
    predicate: str = Field(min_length=1, max_length=200)
    object_or_value: str = Field(alias="objectOrValue", min_length=1, max_length=1000)
    text_zh: str = Field(alias="textZh", min_length=1, max_length=2000)
    text_en: str = Field(alias="textEn", min_length=1, max_length=2000)
    valid_from: str | None = Field(default=None, alias="validFrom")
    valid_to: str | None = Field(default=None, alias="validTo")


class _ExtractionEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    facts: list[_Fact]


class StructuredExtractionService:
    def __init__(
        self,
        api_url: str | None,
        api_key: str | None,
        model: str | None,
        *,
        transport: httpx.BaseTransport | None = None,
    ):
        self.api_url = api_url
        self.api_key = api_key
        self.model = model
        self.transport = transport

    @property
    def enabled(self) -> bool:
        return bool(self.api_url and self.api_key and self.model)

    def extract(
        self,
        source: SourceRecord,
        snapshot: DocumentSnapshotRecord,
        max_candidates: int,
    ) -> list[CandidateCreate]:
        if not self.enabled:
            raise ExtractionUnavailableError(
                "Configure AI_RADAR_EXTRACTION_API_URL, AI_RADAR_EXTRACTION_API_KEY, "
                "and AI_RADAR_EXTRACTION_MODEL."
            )
        parsed = urlsplit(self.api_url or "")
        if parsed.scheme != "https" and parsed.hostname not in {"127.0.0.1", "localhost"}:
            raise ExtractionUnavailableError("The extraction endpoint must use HTTPS.")
        schema: dict[str, Any] = _ExtractionEnvelope.model_json_schema(by_alias=True)
        payload = {
            "model": self.model,
            "temperature": 0,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "ai_radar_facts",
                    "strict": True,
                    "schema": schema,
                },
            },
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Extract only explicit, source-supported facts. Do not infer missing values. "
                        "Return bilingual concise claim text. Dates must be ISO-8601 when present."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Publisher: {source.publisher}\nURL: {source.url}\n"
                        f"Maximum facts: {max_candidates}\n\n"
                        f"{snapshot.content_text[:60000]}"
                    ),
                },
            ],
        }
        with httpx.Client(
            transport=self.transport,
            timeout=httpx.Timeout(60.0, connect=10.0),
        ) as client:
            response = client.post(
                self.api_url or "",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=payload,
            )
            response.raise_for_status()
            body = response.json()
        try:
            content = body["choices"][0]["message"]["content"]
            extracted = _ExtractionEnvelope.model_validate_json(content)
        except (KeyError, IndexError, TypeError, ValueError) as error:
            raise ExtractionUnavailableError(
                "The extraction provider returned an invalid structured response."
            ) from error
        now = datetime.now(UTC).date().isoformat()
        observed = snapshot.observed_at.date().isoformat()
        published = (snapshot.published_at or snapshot.observed_at).date().isoformat()
        results: list[CandidateCreate] = []
        for fact in extracted.facts[:max_candidates]:
            digest = hashlib.sha256(
                f"{snapshot.id}|{fact.subject}|{fact.predicate}|{fact.object_or_value}".encode()
            ).hexdigest()[:20]
            evidence_id = f"evidence-{digest}"
            claim_id = f"claim-{digest}"
            results.append(
                CandidateCreate(
                    id=f"review-{digest}",
                    claim=Claim(
                        id=claim_id,
                        text=ClaimText(zh=fact.text_zh, en=fact.text_en),
                        confidence="unverified",
                        source_ids=[evidence_id],
                        updated_at=now,
                        subject=fact.subject,
                        predicate=fact.predicate,
                        object_or_value=fact.object_or_value,
                        valid_from=fact.valid_from,
                        valid_to=fact.valid_to,
                        observed_at=observed,
                    ),
                    evidence=[
                        Evidence(
                            id=evidence_id,
                            title=LocalizedText(zh=source.title, en=source.title),
                            url=source.url,
                            publisher=source.publisher,
                            published_at=published,
                            collected_at=observed,
                            type="official",
                            supports_claim_ids=[claim_id],
                        )
                    ],
                )
            )
        return results
