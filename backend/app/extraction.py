from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from time import perf_counter
from typing import Any
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, ConfigDict, Field

from .database import DocumentSnapshotRecord, SourceRecord
from .schemas import (
    CandidateCreate,
    Claim,
    ClaimText,
    Evidence,
    ExtractionProbeResult,
    LocalizedText,
)


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

    def probe(self) -> ExtractionProbeResult:
        checked_at = datetime.now(UTC)
        started = perf_counter()
        host = urlsplit(self.api_url or "").hostname
        if not self.enabled:
            return self._probe_result(
                checked_at,
                started,
                host,
                error_code="not_configured",
                detail="API 地址、密钥或模型尚未完整配置。",
            )
        parsed = urlsplit(self.api_url or "")
        if parsed.scheme != "https" and parsed.hostname not in {"127.0.0.1", "localhost"}:
            return self._probe_result(
                checked_at,
                started,
                host,
                error_code="insecure_endpoint",
                detail="抽取 API 地址必须使用 HTTPS。",
            )
        schema: dict[str, Any] = _ExtractionEnvelope.model_json_schema(by_alias=True)
        payload = {
            "model": self.model,
            "temperature": 0,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "ai_radar_connection_probe",
                    "strict": True,
                    "schema": schema,
                },
            },
            "messages": [
                {
                    "role": "system",
                    "content": "Return an empty facts array and no additional text.",
                },
                {"role": "user", "content": "Connection and JSON Schema capability check."},
            ],
        }
        try:
            with httpx.Client(
                transport=self.transport,
                timeout=httpx.Timeout(30.0, connect=10.0),
            ) as client:
                response = client.post(
                    self.api_url or "",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json=payload,
                )
                response.raise_for_status()
                body = response.json()
            content = body["choices"][0]["message"]["content"]
            _ExtractionEnvelope.model_validate_json(content)
        except httpx.HTTPStatusError as error:
            status_code = error.response.status_code
            if status_code in {401, 403}:
                code, detail = "authentication_failed", "供应商拒绝了 API Key 或账号权限。"
            elif status_code == 404:
                code, detail = "endpoint_not_found", "API 地址或模型不存在。"
            elif status_code == 429:
                code, detail = "rate_limited", "供应商额度不足或当前请求受到限流。"
            elif status_code in {400, 422}:
                code, detail = (
                    "structured_output_unsupported",
                    "模型拒绝 JSON Schema 结构化输出，请更换支持该能力的模型。",
                )
            else:
                code, detail = "provider_error", f"供应商返回 HTTP {status_code}。"
            return self._probe_result(checked_at, started, host, error_code=code, detail=detail)
        except httpx.RequestError:
            return self._probe_result(
                checked_at,
                started,
                host,
                error_code="connection_failed",
                detail="无法连接供应商，请检查 API 地址和供应商服务状态。",
            )
        except (KeyError, IndexError, TypeError, ValueError):
            return self._probe_result(
                checked_at,
                started,
                host,
                error_code="invalid_response",
                detail="供应商响应不符合 OpenAI-compatible 结构化输出格式。",
            )
        return self._probe_result(
            checked_at,
            started,
            host,
            passed=True,
            detail="连接、鉴权与 JSON Schema 结构化输出均已通过。",
        )

    def _probe_result(
        self,
        checked_at: datetime,
        started: float,
        host: str | None,
        *,
        passed: bool = False,
        error_code: str | None = None,
        detail: str,
    ) -> ExtractionProbeResult:
        return ExtractionProbeResult(
            configured=self.enabled,
            passed=passed,
            checked_at=checked_at,
            latency_ms=max(0, round((perf_counter() - started) * 1000)),
            endpoint_host=host,
            model=self.model,
            error_code=error_code,
            detail=detail,
        )

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
