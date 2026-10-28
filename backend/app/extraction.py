from __future__ import annotations

import hashlib
import json
import re
from contextvars import ContextVar
from datetime import UTC, date, datetime
from email.utils import parsedate_to_datetime
from pathlib import Path
from time import perf_counter, sleep
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4

import httpx
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .database import DocumentSnapshotRecord, SourceRecord
from .schemas import (
    RELATION_KINDS,
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


class _ProviderCapabilityError(ValueError):
    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def _strict_schema(max_candidates: int) -> dict[str, Any]:
    schema = _ExtractionEnvelope.model_json_schema(by_alias=True)

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            value.pop("default", None)
            if value.get("type") == "object" and "properties" in value:
                value["required"] = list(value["properties"])
                value["additionalProperties"] = False
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(schema)
    schema["properties"]["facts"]["maxItems"] = max_candidates
    return schema


def _schema_rejected(response: httpx.Response) -> bool:
    # Inspect only for classification; never expose the provider's private body.
    try:
        error = response.json().get("error", {})
        if not isinstance(error, dict):
            return False
        param = str(error.get("param", "")).casefold()
        message = str(error.get("message", "")).casefold()
    except (TypeError, ValueError, AttributeError):
        return False
    return "response_format" in param or any(
        marker in message for marker in ("json_schema", "json schema", "response_format")
    )


def _rejected_parameter(response: httpx.Response) -> str:
    try:
        error = response.json().get("error", {})
        param = error.get("param") if isinstance(error, dict) else None
    except (TypeError, ValueError, AttributeError):
        param = None
    return (
        param
        if param in {"reasoning_effort", "max_completion_tokens", "temperature", "model"}
        else "请求参数"
    )


class _Fact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject: str = Field(min_length=1, max_length=300)
    predicate: str = Field(min_length=1, max_length=200)
    object_or_value: str = Field(alias="objectOrValue", min_length=1, max_length=1000)
    text_zh: str = Field(alias="textZh", min_length=1, max_length=2000)
    text_en: str = Field(alias="textEn", min_length=1, max_length=2000)
    valid_from: str | None = Field(
        default=None,
        alias="validFrom",
        description=(
            "Complete calendar date YYYY-MM-DD, or null when the source does not "
            "state a complete effective date. Never fill missing month or day."
        ),
    )
    valid_to: str | None = Field(
        default=None,
        alias="validTo",
        description=(
            "Complete calendar date YYYY-MM-DD, or null when the source does not "
            "state a complete effective date. Never fill missing month or day."
        ),
    )

    @field_validator("valid_from", "valid_to")
    @classmethod
    def validate_iso_date(cls, value: str | None) -> str | None:
        if value is not None and date.fromisoformat(value).isoformat() != value:
            raise ValueError("Validity dates must use YYYY-MM-DD.")
        return value

    @model_validator(mode="after")
    def validate_date_order(self):
        if self.valid_from and self.valid_to and self.valid_from > self.valid_to:
            raise ValueError("Validity end date must not precede the start date.")
        return self


class _ExtractionEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    facts: list[_Fact]


EXTRACTION_JSON_CONTRACT = (
    'Return exactly one JSON object shaped as {"facts":[...]}. Each facts item must contain '
    'exactly these seven fields: "subject" (string), "predicate" (string), '
    '"objectOrValue" (string), "textZh" (string), "textEn" (string), '
    '"validFrom" (complete YYYY-MM-DD calendar date or null), and "validTo" '
    "(complete YYYY-MM-DD calendar date or null). If only a year or year-month is stated, "
    "use null; never invent a first or last day. Copyright years and license-template "
    "version dates are not product effective dates. "
    "Do not add fields, Markdown, commentary, or code fences."
)

EXTRACTION_PIPELINE_VERSION = "2026-10-candidate-schema-budget-v22"


def is_generic_license_fact(subject: str, predicate: str, object_or_value: str = "") -> bool:
    """Reject legal template actors, retaining named product licensing changes."""
    actor = " ".join(subject.casefold().split()).strip('"')
    generic_actors = {
        "permission",
        "the software",
        "this software",
        "software",
        "the authors",
        "authors",
        "copyright holders",
        "the copyright holders",
        "the above copyright notice",
        "this permission notice",
        "such contributions",
    }
    relation = " ".join(predicate.casefold().replace("-", " ").replace("_", " ").split())
    template_role = bool(
        re.fullmatch(
            r"(?:(?:the|each|any) )?(?:contributors?|licensors?|licensees?|recipients?|you|this license)",
            actor,
        )
        or re.fullmatch(
            r"(?:any )?(?:patent|copyright) licenses? granted to you(?: under this license.*)?",
            actor,
        )
    )
    copyright_metadata = bool(
        re.search(r"copyright.*(?:year|notice|holder)|(?:year|notice).*copyright", relation)
    )
    notice_actor = "copyright notice" in actor or bool(
        re.fullmatch(
            r"(?:the )?(?:authors?|copyright holders?)(?: or (?:the )?copyright holders?)?", actor
        )
    )
    legal_namespace = relation == "is a series of" and "lf projects" in object_or_value.casefold()
    license_names = {
        "apache license",
        "mit license",
        "apache-2.0",
        "cc-by-4.0",
        "creative commons attribution 4.0 international",
    }
    versioned_license_actor = bool(
        re.fullmatch(r"(?:the )?apache license(?:,? (?:version )?\d+(?:\.\d+)*)?", actor)
    )
    return (
        actor in generic_actors
        or actor in license_names
        or versioned_license_actor
        or template_role
        or copyright_metadata
        or notice_actor
        or legal_namespace
    )


COMPATIBLE_EXTRACTION_PIPELINE_VERSIONS = {
    EXTRACTION_PIPELINE_VERSION,
    # Older runs may select HTML/URL-only anchors or predate the date/license contract.
}


def extraction_audit_is_current(detail_json: str | None) -> bool:
    try:
        detail = json.loads(detail_json or "{}")
    except (TypeError, ValueError):
        return False
    return detail.get("pipelineVersion") in COMPATIBLE_EXTRACTION_PIPELINE_VERSIONS


def entity_reference_appears(content: str, entity: Entity) -> bool:
    content_key = content.casefold()
    references = [entity.name.zh, entity.name.en, *(entity.aliases or [])]
    return any(
        reference.strip() and reference.casefold() in content_key for reference in references
    )


def locate_source_excerpt(
    content: str,
    subject: str,
    object_or_value: str,
    *,
    max_characters: int = 800,
    claim_text: str | None = None,
) -> str | None:
    subject_key = subject.casefold().strip()
    object_key = object_or_value.casefold().strip()
    if not subject_key or not object_key:
        return None

    def visible_text(segment: str) -> str:
        # Tags/attributes are navigation metadata, not the assertion's actors.
        # Only matching uses this view; the returned quote remains unchanged.
        return re.sub(
            r"</?[A-Za-z][^>]*>|<!--.*?-->", lambda match: " " * len(match.group()), segment
        )

    def anchor_matches(segment: str) -> bool:
        visible = visible_text(segment).casefold()
        without_urls = re.sub(
            r"https?://[^\s<>\)\"']+", lambda match: " " * len(match.group()), visible
        )
        anchors = [
            list(
                re.finditer(
                    r"(?<![A-Za-z0-9_-])"
                    + re.escape(key)
                    + (r"(?![A-Za-z0-9_-]|[.,]\d)" if index == 0 else r"(?![A-Za-z0-9_]|[.,]\d)"),
                    visible if key.startswith(("https://", "http://")) else without_urls,
                )
            )
            for index, key in enumerate((subject_key, object_key))
        ]
        # A family/model name occurring only inside the other identifier is
        # not a second entity or scalar. Both references need their own span.
        return any(
            subject_match.end() <= object_match.start()
            or object_match.end() <= subject_match.start()
            for subject_match in anchors[0]
            for object_match in anchors[1]
        )

    segments = [
        segment.strip()
        for segment in re.split(r"(?<=[。！？!?])\s*|(?<=\.)\s+|[\r\n]+", content)
        if segment.strip()
    ]
    matches = [
        segment
        for segment in segments
        # FAQ titles/TOC questions contain the same actors but do not assert
        # the answer. An affirmative answer needs its own grounded anchors.
        if not visible_text(segment).rstrip().endswith(("?", "？")) and anchor_matches(segment)
    ]
    if not matches:
        return None
    if claim_text:
        # Prefer the actual assertion's wording when the same entities recur.
        # This is quote selection, not semantic verification or approval.
        stop_words = {"a", "an", "the", "is", "are", "of", "to", "and", "for", "in", "on", "by"}
        words = set(re.findall(r"\w+", claim_text.casefold())) - stop_words

        def rank(segment: str) -> tuple[int, int]:
            wording = re.sub(r"https?://[^\s<>\)\"']+", "", visible_text(segment).casefold())
            source_words = set(re.findall(r"\w+", wording))
            return (-len(words & source_words), len(segment))

        excerpt = min(matches, key=rank)
    else:
        excerpt = min(matches, key=len)
    if excerpt.startswith("|"):
        # A numerical table row alone hides which column supports a benchmark claim.
        lines = content.splitlines(keepends=True)
        for index, line in enumerate(lines):
            if line.strip() != excerpt:
                continue
            table_start = index
            while table_start > 0 and lines[table_start - 1].strip().startswith("|"):
                table_start -= 1
            preceding = lines[table_start:index]
            divider = next(
                (
                    offset
                    for offset, item in enumerate(preceding)
                    if re.fullmatch(r"[\s|:\-]+", item.strip())
                ),
                None,
            )
            if divider is not None and divider > 0:
                # Preserve the actual contiguous table, including the divider and
                # intervening rows. Joining a header to a distant row invents a quote.
                context = "".join(lines[table_start : index + 1]).strip()
                # Fail closed instead of discarding column meaning to fit the excerpt limit.
                return context if len(context) <= max_characters else None
            break
    if len(excerpt) <= max_characters:
        return excerpt
    excerpt_key = excerpt.casefold()
    subject_start = excerpt_key.find(subject_key)
    object_start = excerpt_key.find(object_key)
    anchor_start = min(subject_start, object_start)
    anchor_end = max(
        subject_start + len(subject_key),
        object_start + len(object_key),
    )
    if anchor_end - anchor_start > max_characters:
        return None
    remaining = max_characters - (anchor_end - anchor_start)
    window_start = max(0, anchor_start - remaining // 2)
    window_end = min(len(excerpt), window_start + max_characters)
    window_start = max(0, window_end - max_characters)
    result = excerpt[window_start:window_end].strip()
    return result if anchor_matches(result) else None


class StructuredExtractionService:
    def __init__(
        self,
        api_url: str | None,
        api_key: str | None,
        model: str | None,
        *,
        response_timeout_seconds: float = 80.0,
        reasoning_effort: str | None = None,
        max_completion_tokens: int | None = None,
        require_json_schema: bool = False,
        require_usage: bool = False,
        transport: httpx.BaseTransport | None = None,
        contract_state_path: Path | None = None,
    ):
        self.api_url = api_url
        self.api_key = api_key
        self.model = model
        self.response_timeout_seconds = response_timeout_seconds
        is_sol = bool(model and (model == "gpt-6.1-sol" or model.startswith("gpt-6.1-sol-")))
        self.reasoning_effort = reasoning_effort or ("low" if is_sol else None)
        self.max_completion_tokens = max_completion_tokens or (8192 if is_sol else None)
        self.require_json_schema = require_json_schema
        self.require_usage = require_usage
        self._is_sol = is_sol
        self._is_astra = bool(
            model and (model == "gpt-6-astra" or model.startswith("gpt-6-astra-"))
        )
        self.transport = transport
        self._response_format_mode = "json_schema"
        self._contract_failure: str | None = None
        self.contract_state_path = contract_state_path
        self._refresh_contract_state()
        self._call_metadata: ContextVar[dict[str, Any] | None] = ContextVar(
            "extraction_provider_call", default=None
        )

    def _refresh_contract_state(self) -> None:
        if self.contract_state_path and self.contract_state_path.exists():
            # Fail closed on damaged state; restart is not authorization to retry.
            try:
                state = json.loads(self.contract_state_path.read_text(encoding="utf-8"))
                self._contract_failure = state.get("reason") or "invalid_contract_state"
            except (OSError, ValueError, AttributeError):
                self._contract_failure = "invalid_contract_state"

    def call_metadata(self) -> dict[str, Any] | None:
        metadata = self._call_metadata.get()
        return dict(metadata) if metadata is not None else None

    def _trip_contract(self, reason: str) -> None:
        self._contract_failure = reason
        if self.contract_state_path:
            self.contract_state_path.parent.mkdir(parents=True, exist_ok=True)
            state = {
                "reason": reason,
                "observedAt": datetime.now(UTC).isoformat(),
                "endpointHost": urlsplit(self.api_url or "").hostname,
                "model": self.model,
                "receipt": self.call_metadata(),
            }
            temporary = self.contract_state_path.with_name(
                self.contract_state_path.name + "." + uuid4().hex + ".tmp"
            )
            temporary.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
            temporary.replace(self.contract_state_path)

    def _request_parameters(self) -> dict[str, Any]:
        parameters: dict[str, Any] = {"model": self.model}
        if self.reasoning_effort is not None:
            parameters["reasoning_effort"] = self.reasoning_effort
        elif not self._is_sol:
            parameters["temperature"] = 0
        if self.max_completion_tokens is not None:
            parameters["max_completion_tokens"] = self.max_completion_tokens
        return parameters

    @property
    def enabled(self) -> bool:
        return bool(self.api_url and self.api_key and self.model)

    def probe(self) -> ExtractionProbeResult:
        self._call_metadata.set(None)
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
        schema = _strict_schema(1)
        payload = {
            **self._request_parameters(),
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
            _parse_extraction_envelope(body, strict=self.require_json_schema)
        except _ProviderCapabilityError as error:
            return self._probe_result(
                checked_at, started, host, error_code=error.code, detail=error.detail
            )
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
                    (
                        "structured_output_unsupported",
                        "供应商拒绝严格 JSON Schema 请求，未进行降级。",
                    )
                    if _schema_rejected(error.response)
                    else (
                        "invalid_request",
                        f"供应商拒绝 {_rejected_parameter(error.response)}；不能据此判断 Schema 不支持。",
                    )
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
                "连接、鉴权及 JSON Schema 请求已通过，返回已通过本地校验；"
                "不证明供应商未静默忽略参数，仍需核对供应商请求记录。"
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
        self._refresh_contract_state()
        if self._contract_failure:
            self._call_metadata.set(
                {
                    **self._request_parameters(),
                    "requestCount": 0,
                    "responses": [],
                    "blockedBy": self._contract_failure,
                    "parametersForwardingVerified": False,
                }
            )
            raise _ProviderCapabilityError(
                "provider_contract_blocked",
                f"先前请求违反供应商契约（{self._contract_failure}）；已停止后续调用，"
                "请核对供应商配置和回执，保留故障记录并经过明确复测授权后恢复。",
            )
        mode = "json_schema" if self.require_json_schema else self._response_format_mode
        retryable_statuses = {429, 502, 503, 504}
        deadline = perf_counter() + timeout_seconds
        metadata: dict[str, Any] = {
            **self._request_parameters(),
            "requestCount": 0,
            "responses": [],
            "parametersForwardingVerified": False,
        }
        self._call_metadata.set(metadata)
        with httpx.Client(
            transport=self.transport,
            timeout=httpx.Timeout(timeout_seconds, connect=10.0),
        ) as client:
            for attempt in range(2):
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
                remaining_seconds = deadline - perf_counter()
                if remaining_seconds <= 0:
                    raise httpx.ReadTimeout("Extraction request deadline exceeded.")
                # Another running instance may have tripped the shared circuit,
                # including while this instance was waiting to retry.
                self._refresh_contract_state()
                if self._contract_failure:
                    metadata["blockedBy"] = self._contract_failure
                    raise _ProviderCapabilityError(
                        "provider_contract_blocked",
                        "共享停止记录已生效；保留故障回执并经明确复测授权后恢复。",
                    )
                metadata["requestCount"] += 1
                response = client.post(
                    self.api_url or "",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json={**payload, "response_format": response_format},
                    timeout=httpx.Timeout(remaining_seconds, connect=min(10.0, remaining_seconds)),
                )
                receipt: dict[str, Any] = {"status": response.status_code, "format": mode}
                request_id = response.headers.get("x-request-id") or response.headers.get(
                    "request-id"
                )
                if request_id and re.fullmatch(r"[A-Za-z0-9_:.-]{1,200}", request_id):
                    receipt["requestId"] = request_id
                metadata["responses"].append(receipt)
                if response.status_code in retryable_statuses and attempt == 0:
                    retry_delay = 0.25
                    retry_after = response.headers.get("Retry-After")
                    if retry_after:
                        try:
                            retry_delay = max(0.0, float(retry_after))
                        except ValueError:
                            try:
                                retry_delay = max(
                                    0.0,
                                    (
                                        parsedate_to_datetime(retry_after) - datetime.now(UTC)
                                    ).total_seconds(),
                                )
                            except (TypeError, ValueError, OverflowError):
                                pass
                    if retry_delay >= deadline - perf_counter():
                        response.raise_for_status()
                    sleep(retry_delay)
                    continue
                if (
                    mode == "json_schema"
                    and response.status_code in {400, 422}
                    and not self.require_json_schema
                    and _schema_rejected(response)
                    and attempt == 0
                ):
                    mode = "json_object"
                    continue
                response.raise_for_status()
                body = response.json()
                if not isinstance(body, dict):
                    raise TypeError("The provider response must be an object.")
                completion_id = body.get("id")
                if isinstance(completion_id, str) and re.fullmatch(
                    r"[A-Za-z0-9_:.-]{1,200}", completion_id
                ):
                    receipt["completionId"] = completion_id
                usage = _safe_usage(body)
                receipt["usage"] = usage
                returned_model = body.get("model")
                if isinstance(returned_model, str):
                    receipt["returnedModel"] = returned_model[:200]
                if self.require_usage and (
                    usage is None
                    or ((self._is_sol or self._is_astra) and usage.get("reasoningTokens") is None)
                ):
                    self._trip_contract("usage_unavailable")
                    raise _ProviderCapabilityError(
                        "usage_unavailable",
                        "供应商缺少完整 Token 用量或推理用量明细，无法核对计费。",
                    )
                if (
                    usage
                    and self.max_completion_tokens
                    and usage["outputTokens"] > self.max_completion_tokens
                ):
                    self._trip_contract("output_limit_ignored")
                    raise _ProviderCapabilityError(
                        "output_limit_ignored",
                        "供应商报告的输出 Token 超过请求上限，停止抽取并核对透传与计费。",
                    )
                if (
                    self.require_usage
                    and (self._is_sol or self._is_astra)
                    and not (
                        returned_model == self.model
                        or (
                            isinstance(returned_model, str)
                            and returned_model.startswith(f"{self.model}-")
                        )
                    )
                ):
                    self._trip_contract("model_unconfirmed")
                    raise _ProviderCapabilityError(
                        "model_unconfirmed", "供应商未返回可对应的请求模型标识，需核对路由记录。"
                    )
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
        priority_entity_deficits: dict[str, int] | None = None,
        claims_remaining: int = 0,
        relation_deficit: int = 0,
    ) -> list[CandidateCreate]:
        """Cover the document within one deadline, or fail without publishing a partial batch."""
        if not 1 <= max_candidates <= 30:
            raise ExtractionUnavailableError("Candidate limit must be between 1 and 30.")
        content = snapshot.content_text
        segments: list[tuple[int, int]] = []
        start = 0
        while start < len(content):
            end = min(start + 60000, len(content))
            if end < len(content):
                boundary = content.rfind("\n", start + 50000, end)
                if boundary > start:
                    end = boundary + 1
            segments.append((start, end))
            if end == len(content):
                break
            start = end - 1000
        if not segments:
            segments = [(0, 0)]
        diagnostics: dict[str, Any] = {
            "sourceCharacters": len(content),
            "coverageStatus": "not_started",
            "processedCharacters": 0,
            "plannedSegments": len(segments),
            "completedSegments": 0,
            "candidateLimit": max_candidates,
            "candidateLimitReached": False,
            "duplicatesRemoved": 0,
            "candidateBudgetPolicy": "reserve-for-unprocessed-segments",
            "candidateSelectionLimited": False,
            "segments": [],
            "parametersForwardingVerified": False,
        }
        self._call_metadata.set(diagnostics)
        if len(segments) > 8:
            raise ExtractionUnavailableError(
                "document_too_large: 文档需要超过 8 个分段；未发送请求，请先拆分资料。"
            )
        started = perf_counter()
        results: list[CandidateCreate] = []
        fingerprints: set[tuple[str, str, str, str | None, str | None]] = set()
        for index, (start, end) in enumerate(segments):
            remaining = self.response_timeout_seconds - (perf_counter() - started)
            if remaining <= 0 or len(results) >= max_candidates:
                diagnostics["coverageStatus"] = "partial"
                self._call_metadata.set(diagnostics)
                raise ExtractionUnavailableError(
                    "document_coverage_incomplete: 全文尚未处理完，未生成部分候选；"
                    "请增加候选上限或拆分资料。"
                )
            segment = DocumentSnapshotRecord(
                id=snapshot.id,
                source_id=snapshot.source_id,
                content_hash=snapshot.content_hash,
                content_text=content[start:end],
                observed_at=snapshot.observed_at,
                published_at=snapshot.published_at,
            )
            remaining_budget = max_candidates - len(results)
            remaining_segments = len(segments) - index
            # Reserve space for the tail instead of spending the entire document
            # budget on its first segment. This caps selection, not fact recall.
            segment_budget = (
                max(1, remaining_budget // remaining_segments)
                if remaining_budget >= remaining_segments
                else remaining_budget
            )
            try:
                candidates = self._extract_segment(
                    source,
                    segment,
                    segment_budget,
                    catalog_entities,
                    priority_entity_ids,
                    priority_entity_deficits,
                    claims_remaining,
                    relation_deficit,
                    timeout_seconds=remaining,
                )
            except ExtractionUnavailableError:
                failed_call = self.call_metadata()
                diagnostics["segments"].append(
                    {
                        "index": index,
                        "start": start,
                        "end": end,
                        "candidateBudget": segment_budget,
                        "status": "failed",
                        "providerCall": failed_call,
                    }
                )
                if len(segments) == 1 and failed_call:
                    diagnostics.update(failed_call)
                diagnostics["coverageStatus"] = "partial" if index else "failed"
                self._call_metadata.set(diagnostics)
                raise
            call = self.call_metadata()
            diagnostics["segments"].append(
                {
                    "index": index,
                    "start": start,
                    "end": end,
                    "candidateBudget": segment_budget,
                    "status": "completed",
                    "providerCall": call,
                }
            )
            diagnostics["completedSegments"] += 1
            diagnostics["processedCharacters"] = end
            diagnostics["candidateSelectionLimited"] = diagnostics[
                "candidateSelectionLimited"
            ] or bool(call and call.get("factLimitReached"))
            for candidate in candidates:
                claim = candidate.claim
                key = tuple(
                    " ".join((value or "").casefold().split())
                    for value in (
                        claim.subject,
                        claim.predicate,
                        claim.object_or_value,
                        claim.valid_from,
                        claim.valid_to,
                    )
                )
                if key in fingerprints:
                    diagnostics["duplicatesRemoved"] += 1
                    continue
                fingerprints.add(key)
                results.append(candidate)
            if len(segments) == 1 and call:
                # Preserve the established receipt fields for existing audit consumers.
                diagnostics.update(call)
            diagnostics["candidateLimitReached"] = len(results) >= max_candidates
        diagnostics["coverageStatus"] = "full"
        diagnostics["retainedCandidates"] = len(results)
        self._call_metadata.set(diagnostics)
        return results

    def _extract_segment(
        self,
        source: SourceRecord,
        snapshot: DocumentSnapshotRecord,
        max_candidates: int,
        catalog_entities: list[Entity] | None = None,
        priority_entity_ids: list[str] | None = None,
        priority_entity_deficits: dict[str, int] | None = None,
        claims_remaining: int = 0,
        relation_deficit: int = 0,
        *,
        timeout_seconds: float | None = None,
    ) -> list[CandidateCreate]:
        self._call_metadata.set(None)
        if not self.enabled:
            raise ExtractionUnavailableError(
                "Configure AI_RADAR_EXTRACTION_API_URL, AI_RADAR_EXTRACTION_API_KEY, "
                "and AI_RADAR_EXTRACTION_MODEL."
            )
        parsed = urlsplit(self.api_url or "")
        if parsed.scheme != "https" and parsed.hostname not in {"127.0.0.1", "localhost"}:
            raise ExtractionUnavailableError("The extraction endpoint must use HTTPS.")
        schema = _strict_schema(max_candidates)
        catalog_context = "\n".join(
            f"- {entity.id}: {entity.name.zh} | {entity.name.en}"
            for entity in (catalog_entities or [])
        )
        priority_deficits = {
            entity_id: max(1, int(deficit))
            for entity_id, deficit in (priority_entity_deficits or {}).items()
        }
        for entity_id in priority_entity_ids or []:
            priority_deficits.setdefault(entity_id, 1)
        mentioned_priorities = [
            entity
            for entity in (catalog_entities or [])
            if entity.id in priority_deficits
            and entity_reference_appears(snapshot.content_text, entity)
        ]
        mentioned_priorities.sort(key=lambda entity: (-priority_deficits[entity.id], entity.id))
        priority_context = "\n".join(
            (
                f"- {entity.id}: {entity.name.zh} | {entity.name.en} "
                f"| missing relation links: {priority_deficits[entity.id]}"
            )
            for entity in mentioned_priorities
        )
        relation_focus = bool(
            priority_context and max(0, claims_remaining) == 0 and max(0, relation_deficit) > 0
        )
        relation_candidate_target = (
            max_candidates
            if relation_focus
            else min(max_candidates, max(1, max_candidates // 2))
            if priority_context
            else 0
        )
        remaining_slot_policy = (
            "When the source supports fewer priority relations than requested, return fewer "
            "facts. Do not fill unused slots with unrelated generic facts or broad summaries."
            if relation_focus
            else (
                "When the source supports fewer priority relations than requested, use every "
                "remaining slot for distinct atomic facts such as dated releases, measured "
                "capabilities, compatibility, availability, limits, or benchmark results."
            )
        )
        candidate_allocation_policy = (
            "- This is a relation-focused pass because the reviewed Claim threshold is already "
            "met. Return fewer facts when the document does not explicitly support the requested "
            "canonical relations; do not backfill unused slots with generic claims.\n"
            if relation_focus
            else (
                "- Then, fill the remaining available fact slots with distinct, directly "
                "supported atomic claims.\n"
                "- If no listed priority entity appears in this document, use all slots for "
                "distinct atomic claims instead.\n"
            )
        )
        payload = {
            **self._request_parameters(),
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Extract only explicit, source-supported facts. Do not infer missing values. "
                        "Return bilingual concise claim text. Effective dates must be complete "
                        "YYYY-MM-DD calendar dates or null; do not fill missing month or day."
                        " When an explicit fact relates two known catalog entities, use one of these "
                        "exact canonical predicates: "
                        f"{', '.join(RELATION_KINDS)}. Use the catalog entity "
                        "name verbatim as subject and objectOrValue. Prioritize explicit canonical "
                        "relations involving the listed priority entities, but never infer a relation "
                        "that the source does not state. "
                        f"{remaining_slot_policy} Each fact must stand on its "
                        "own, express only one assertion, and differ semantically from the other "
                        "facts. Exclude marketing language, broad summaries, and paraphrase "
                        "duplicates. Preserve source wording for subject and objectOrValue whenever "
                        "possible so the evidence can be located verbatim. Every returned fact must "
                        "use a subject and objectOrValue that both appear verbatim in one source "
                        "segment; omit facts that cannot satisfy this evidence-anchor requirement."
                        " Copy each subject and objectOrValue exactly from that same sentence or table row: "
                        "do not append 'series', translate a proper name, convert dotted dates to ISO "
                        "inside objectOrValue, or join separate list items into one value. "
                        "ISO date normalization belongs only in validFrom/validTo. "
                        "For example, a source '2025.04.29: Qwen3 released' uses subject Qwen3, "
                        "objectOrValue 2025.04.29 and validFrom 2025-04-29. "
                        " Never use unresolved pronouns such as 'Both models' as the subject. "
                        "Attribute self-reported results to the publisher; do not repeat 'best', "
                        "'leading', or 'state-of-the-art' as established fact. For benchmark claims, "
                        "preserve the benchmark variant, metric, tested setup and reasoning mode "
                        "when stated; omit the claim if those qualifications cannot be grounded. "
                        "Separate input and output prices into distinct facts with their units. "
                        f" {EXTRACTION_JSON_CONTRACT}"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Publisher: {source.publisher}\nURL: {source.url}\n"
                        f"Maximum facts: {max_candidates}\n\n"
                        "Current reviewed-data quality gaps:\n"
                        f"- Claims remaining: {max(0, claims_remaining)}\n"
                        f"- Core relation links remaining: {max(0, relation_deficit)}\n"
                        "Candidate allocation for this document:\n"
                        "- First, extract up to "
                        f"{relation_candidate_target} directly stated canonical relations involving "
                        "the priority entities below.\n"
                        f"{candidate_allocation_policy}\n"
                        f"Known catalog entities:\n{catalog_context or '(not provided)'}\n\n"
                        "Priority entities with incomplete relation coverage:\n"
                        f"{priority_context or '(none for this pass)'}\n\n"
                        f"{snapshot.content_text}"
                    ),
                },
            ],
        }
        try:
            body, _ = self._completion(
                payload,
                schema=schema,
                schema_name="ai_radar_facts",
                timeout_seconds=timeout_seconds or self.response_timeout_seconds,
            )
            extracted = _parse_extraction_envelope(body, strict=self.require_json_schema)
        except _ProviderCapabilityError as error:
            raise ExtractionUnavailableError(f"{error.code}: {error.detail}") from error
        except httpx.HTTPStatusError as error:
            status_code = error.response.status_code
            if status_code in {401, 403}:
                detail = "The extraction provider rejected the configured credentials."
            elif status_code == 404:
                detail = "The extraction endpoint or configured model was not found."
            elif status_code == 429:
                detail = "The extraction provider rate-limited the request; retry later."
            elif status_code in {400, 422}:
                detail = (
                    "structured_output_unsupported: 供应商拒绝 JSON Schema 请求。"
                    if _schema_rejected(error.response)
                    else f"invalid_request: 供应商拒绝 {_rejected_parameter(error.response)}。"
                )
            elif status_code >= 500:
                detail = f"The extraction provider returned HTTP {status_code}; retry later."
            else:
                detail = f"The extraction provider returned HTTP {status_code}."
            raise ExtractionUnavailableError(detail) from error
        except httpx.ConnectTimeout as error:
            raise ExtractionUnavailableError(
                "The extraction provider connection timed out; retry later."
            ) from error
        except httpx.ReadTimeout as error:
            raise ExtractionUnavailableError(
                "The extraction provider response timed out; retry later."
            ) from error
        except httpx.ConnectError as error:
            _, detail = _classify_connect_error(error)
            raise ExtractionUnavailableError(detail) from error
        except httpx.RequestError as error:
            raise ExtractionUnavailableError(
                "The extraction provider could not be reached; retry later."
            ) from error
        except (KeyError, IndexError, TypeError, ValueError) as error:
            raise ExtractionUnavailableError(
                "The extraction provider returned an invalid structured response."
            ) from error
        now = datetime.now(UTC).date().isoformat()
        observed = snapshot.observed_at.date().isoformat()
        published = snapshot.published_at.date().isoformat() if snapshot.published_at else ""
        results: list[CandidateCreate] = []
        metadata = self._call_metadata.get()
        if metadata is not None:
            metadata.update(
                rawFacts=len(extracted.facts),
                rejectedEvidenceAnchors=0,
                rejectedIrrelevantFacts=0,
                rejectedFacts=[],
                factLimitReached=len(extracted.facts) >= max_candidates,
                sourceDateBasis="published" if snapshot.published_at else "unknown",
            )
        if len(extracted.facts) > max_candidates:
            raise ExtractionUnavailableError(
                "candidate_limit_exceeded: 模型输出超过请求上限，未静默丢弃候选。"
            )
        for fact in extracted.facts:
            if is_generic_license_fact(fact.subject, fact.predicate, fact.object_or_value):
                if metadata is not None:
                    metadata["rejectedIrrelevantFacts"] += 1
                    metadata["rejectedFacts"].append(
                        {
                            "subject": fact.subject,
                            "predicate": fact.predicate,
                            "objectOrValue": fact.object_or_value,
                            "reason": "generic-license-template",
                        }
                    )
                continue
            source_excerpt = locate_source_excerpt(
                snapshot.content_text,
                fact.subject,
                fact.object_or_value,
                claim_text=fact.text_en,
            )
            if source_excerpt is None:
                if metadata is not None:
                    metadata["rejectedEvidenceAnchors"] += 1
                    metadata["rejectedFacts"].append(
                        {
                            "subject": fact.subject,
                            "predicate": fact.predicate,
                            "objectOrValue": fact.object_or_value,
                            "reason": "no-exact-shared-source-segment",
                        }
                    )
                continue
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
                            source_excerpt=source_excerpt,
                            type="official",
                            supports_claim_ids=[claim_id],
                        )
                    ],
                )
            )
        return results


def _safe_usage(body: dict[str, Any]) -> dict[str, int | None] | None:
    usage = body.get("usage")
    if not isinstance(usage, dict):
        return None
    counts = [usage.get(key) for key in ("prompt_tokens", "completion_tokens", "total_tokens")]
    if not all(type(value) is int and value >= 0 for value in counts):
        return None
    prompt, completion, total = counts
    if prompt + completion != total:
        return None
    details = usage.get("completion_tokens_details")
    reasoning = details.get("reasoning_tokens") if isinstance(details, dict) else None
    if reasoning is not None and (type(reasoning) is not int or not 0 <= reasoning <= completion):
        return None
    return {
        "inputTokens": prompt,
        "outputTokens": completion,
        "totalTokens": total,
        "reasoningTokens": reasoning,
    }


def _parse_extraction_envelope(
    body: dict[str, Any], *, strict: bool = False
) -> _ExtractionEnvelope:
    choice = body["choices"][0]
    if not isinstance(choice, dict) or not isinstance(choice.get("message"), dict):
        raise TypeError("The provider response must include a message object.")
    if choice.get("finish_reason") == "length":
        raise _ProviderCapabilityError(
            "output_truncated", "模型输出达到上限，未生成候选；请检查 Token 上限。"
        )
    if choice.get("finish_reason") in {"content_filter", "tool_calls"} or choice["message"].get(
        "refusal"
    ):
        raise _ProviderCapabilityError(
            "output_refused", "模型拒答、内容过滤或返回工具调用，未生成候选。"
        )
    if strict and choice.get("finish_reason") != "stop":
        raise ValueError("Strict structured response must report normal completion.")
    content = choice["message"]["content"]
    if strict and not isinstance(content, str):
        raise ValueError("Strict structured response content must be text.")
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
        if strict:
            raise ValueError("Strict structured response cannot contain code fences.")
        first_line_end = normalized.find("\n")
        if first_line_end < 0:
            raise ValueError("Structured response code fence has no JSON body.")
        normalized = normalized[first_line_end + 1 : -3].strip()
    parsed = json.loads(normalized)
    if isinstance(parsed, list):
        if strict:
            raise ValueError("Strict structured response must be an object.")
        parsed = {"facts": parsed}
    if strict:
        if (
            not isinstance(parsed, dict)
            or set(parsed) != {"facts"}
            or not isinstance(parsed["facts"], list)
        ):
            raise ValueError("Strict structured response requires a facts array.")
        required = {field.alias or name for name, field in _Fact.model_fields.items()}
        if any(not isinstance(fact, dict) or set(fact) != required for fact in parsed["facts"]):
            raise ValueError("Strict structured response must include all seven fact fields.")
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
