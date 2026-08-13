from __future__ import annotations

import hashlib
import json
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
    Entity,
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


EXTRACTION_JSON_CONTRACT = (
    'Return exactly one JSON object shaped as {"facts":[...]}. Each facts item must contain '
    'exactly these seven fields: "subject" (string), "predicate" (string), '
    '"objectOrValue" (string), "textZh" (string), "textEn" (string), '
    '"validFrom" (ISO-8601 string or null), and "validTo" (ISO-8601 string or null). '
    "Do not add fields, Markdown, commentary, or code fences."
)

EXTRACTION_PIPELINE_VERSION = "2026-08-relation-priority-v2"


def extraction_audit_is_current(detail_json: str | None) -> bool:
    try:
        detail = json.loads(detail_json or "{}")
    except (TypeError, ValueError):
        return False
    return detail.get("pipelineVersion") == EXTRACTION_PIPELINE_VERSION


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
        self._response_format_mode = "json_schema"

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
        if not parsed.scheme or not parsed.hostname:
            return self._probe_result(
                checked_at,
                started,
                host,
                error_code="invalid_endpoint",
                detail="API 地址格式无效，请填写包含 https:// 的完整 Chat Completions 地址。",
            )
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
            "messages": [
                {
                    "role": "system",
                    "content": EXTRACTION_JSON_CONTRACT,
                },
                {
                    "role": "user",
                    "content": (
                        "Return one connection-test fact with subject AI Radar, predicate probe, "
                        "objectOrValue ok, bilingual text, and null validity dates."
                    ),
                },
            ],
        }
        try:
            body, response_format_mode = self._completion(
                payload,
                schema=schema,
                schema_name="ai_radar_connection_probe",
                timeout_seconds=30.0,
            )
            _parse_extraction_envelope(body)
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
        except httpx.InvalidURL:
            return self._probe_result(
                checked_at,
                started,
                host,
                error_code="invalid_endpoint",
                detail="API 地址格式无效，请检查协议、域名和 /chat/completions 路径。",
            )
        except httpx.ConnectTimeout:
            return self._probe_result(
                checked_at,
                started,
                host,
                error_code="connection_timeout",
                detail="连接供应商超时；请检查接口是否允许 Render 新加坡节点访问。",
            )
        except httpx.ReadTimeout:
            return self._probe_result(
                checked_at,
                started,
                host,
                error_code="response_timeout",
                detail="供应商已建立连接但响应超时，请稍后重试或检查供应商负载。",
            )
        except httpx.ConnectError as error:
            reason = _classify_connect_error(error)
            return self._probe_result(
                checked_at,
                started,
                host,
                error_code=reason[0],
                detail=reason[1],
            )
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
            detail=(
                "连接、鉴权与 JSON Schema 结构化输出均已通过。"
                if response_format_mode == "json_schema"
                else "连接与鉴权已通过；供应商使用 JSON Object 兼容模式，输出仍会经过严格字段校验。"
            ),
        )

    def _completion(
        self,
        payload: dict[str, Any],
        *,
        schema: dict[str, Any],
        schema_name: str,
        timeout_seconds: float,
    ) -> tuple[dict[str, Any], str]:
        modes = (
            ("json_object",)
            if self._response_format_mode == "json_object"
            else ("json_schema", "json_object")
        )
        with httpx.Client(
            transport=self.transport,
            timeout=httpx.Timeout(timeout_seconds, connect=10.0),
        ) as client:
            for mode in modes:
                response_format: dict[str, Any]
                if mode == "json_schema":
                    response_format = {
                        "type": "json_schema",
                        "json_schema": {
                            "name": schema_name,
                            "strict": True,
                            "schema": schema,
                        },
                    }
                else:
                    response_format = {"type": "json_object"}
                response = client.post(
                    self.api_url or "",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json={**payload, "response_format": response_format},
                )
                if (
                    mode == "json_schema"
                    and response.status_code in {400, 422}
                    and "json_object" in modes
                ):
                    continue
                response.raise_for_status()
                body = response.json()
                self._response_format_mode = mode
                return body, mode
        raise RuntimeError("No structured response format was attempted.")

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
        catalog_entities: list[Entity] | None = None,
        priority_entity_ids: list[str] | None = None,
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
        catalog_context = "\n".join(
            f"- {entity.id}: {entity.name.zh} | {entity.name.en}"
            for entity in (catalog_entities or [])
        )
        priority_ids = set(priority_entity_ids or [])
        priority_context = "\n".join(
            f"- {entity.id}: {entity.name.zh} | {entity.name.en}"
            for entity in (catalog_entities or [])
            if entity.id in priority_ids
        )
        payload = {
            "model": self.model,
            "temperature": 0,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Extract only explicit, source-supported facts. Do not infer missing values. "
                        "Return bilingual concise claim text. Dates must be ISO-8601 when present."
                        " When an explicit fact relates two known catalog entities, use one of these "
                        "exact canonical predicates: developed-by, based-on, competes-with, "
                        "benchmarked-on, uses, cited-by, part-of, successor-of. Use the catalog entity "
                        "name verbatim as subject and objectOrValue. Prioritize explicit canonical "
                        "relations involving the listed priority entities, but never infer a relation "
                        "that the source does not state."
                        f" {EXTRACTION_JSON_CONTRACT}"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Publisher: {source.publisher}\nURL: {source.url}\n"
                        f"Maximum facts: {max_candidates}\n\n"
                        f"Known catalog entities:\n{catalog_context or '(not provided)'}\n\n"
                        "Priority entities with incomplete relation coverage:\n"
                        f"{priority_context or '(none for this pass)'}\n\n"
                        f"{snapshot.content_text[:60000]}"
                    ),
                },
            ],
        }
        try:
            body, _ = self._completion(
                payload,
                schema=schema,
                schema_name="ai_radar_facts",
                timeout_seconds=60.0,
            )
            extracted = _parse_extraction_envelope(body)
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


def _parse_extraction_envelope(body: dict[str, Any]) -> _ExtractionEnvelope:
    content = body["choices"][0]["message"]["content"]
    if isinstance(content, list):
        text_parts = [
            part.get("text", "")
            for part in content
            if isinstance(part, dict) and isinstance(part.get("text"), str)
        ]
        content = "".join(text_parts)
    if not isinstance(content, str):
        raise TypeError("Structured response content must be text.")
    normalized = content.strip()
    if normalized.startswith("```") and normalized.endswith("```"):
        first_line_end = normalized.find("\n")
        if first_line_end < 0:
            raise ValueError("Structured response code fence has no JSON body.")
        normalized = normalized[first_line_end + 1 : -3].strip()
    parsed = json.loads(normalized)
    if isinstance(parsed, list):
        parsed = {"facts": parsed}
    return _ExtractionEnvelope.model_validate(parsed)


def _classify_connect_error(error: httpx.ConnectError) -> tuple[str, str]:
    messages: list[str] = []
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        messages.append(str(current).casefold())
        current = current.__cause__ or current.__context__
    detail = " ".join(messages)
    if any(marker in detail for marker in ("getaddrinfo", "name resolution", "no such host")):
        return "dns_resolution_failed", "无法解析供应商域名，请检查 API 地址中的域名拼写。"
    if any(marker in detail for marker in ("certificate", "ssl", "tls")):
        return "tls_failed", "供应商的 HTTPS/TLS 连接校验失败，请检查证书与代理配置。"
    if "refused" in detail:
        return "connection_refused", "供应商拒绝了网络连接，请检查端口、访问控制和服务状态。"
    return "connection_failed", "无法连接供应商，请检查 API 地址和供应商服务状态。"
