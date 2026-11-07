from __future__ import annotations

import re
from collections.abc import Callable
from datetime import UTC, date, datetime
from math import isfinite
from threading import Lock
from typing import Any

import httpx

# bge-m3's documented 60k context limit also applies to a padded batch.
# Keep 20% headroom and use UTF-8 bytes plus framing as a token upper bound.
CLOUDFLARE_PADDED_BATCH_TOKEN_LIMIT = 48_000


def embedding_token_upper_bound(texts: list[str]) -> int:
    # UTF-8 bytes plus per-input framing headroom; characters can undercount Chinese tokens.
    return sum(len(text.encode("utf-8")) + 32 for text in texts)


def embedding_batch_token_upper_bound(texts: list[str]) -> int:
    return max((embedding_token_upper_bound([text]) for text in texts), default=0) * len(texts)


def embedding_batch_indices(texts: list[str], *, max_batch_size: int = 100) -> list[list[int]]:
    if not 1 <= max_batch_size <= 100:
        raise ValueError("Embedding batches must contain between 1 and 100 inputs.")
    lengths = [embedding_token_upper_bound([text]) for text in texts]
    if any(length > CLOUDFLARE_PADDED_BATCH_TOKEN_LIMIT for length in lengths):
        raise EmbeddingProviderError("An embedding input exceeds the conservative context limit.")
    batches: list[list[int]] = []
    batch: list[int] = []
    for index in sorted(range(len(texts)), key=lengths.__getitem__):
        if batch and (
            len(batch) >= max_batch_size
            or lengths[index] * (len(batch) + 1) > CLOUDFLARE_PADDED_BATCH_TOKEN_LIMIT
        ):
            batches.append(batch)
            batch = []
        batch.append(index)
    if batch:
        batches.append(batch)
    return batches


class EmbeddingProviderError(RuntimeError):
    """可安全记录的错误；仅附带脱敏后的结构化上游错误详情。"""

    def __init__(self, message: str, *, upstream_details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.upstream_details = upstream_details


class EmbeddingBudgetExceeded(EmbeddingProviderError):
    pass


class CloudflareEmbeddingProvider:
    provider_name = "cloudflare"

    def __init__(
        self,
        *,
        account_id: str,
        api_token: str,
        model_name: str,
        model_version: str,
        dimension: int,
        daily_neuron_budget: float,
        neurons_per_million_tokens: float = 1075,
        daily_api_call_budget: int = 1000,
        max_batch_size: int = 100,
        timeout_seconds: float = 10,
        client: httpx.Client | None = None,
        today: Callable[[], date] | None = None,
    ) -> None:
        if not account_id or not api_token:
            raise ValueError("Cloudflare account ID and API token are required.")
        if not model_name or not model_version:
            raise ValueError("Embedding model and version are required.")
        if dimension <= 0:
            raise ValueError("Embedding dimension must be positive.")
        if daily_neuron_budget <= 0 or daily_api_call_budget <= 0:
            raise ValueError("Embedding daily budgets must be positive.")
        if neurons_per_million_tokens <= 0 or max_batch_size <= 0:
            raise ValueError("Embedding rate and batch size must be positive.")
        if max_batch_size > 100:
            raise ValueError(
                "Cloudflare embedding batch size cannot exceed the model's 100-input limit."
            )
        self.model_name = model_name
        self.model_version = model_version
        self.dimension = dimension
        self.daily_neuron_budget = daily_neuron_budget
        self.neurons_per_million_tokens = neurons_per_million_tokens
        self.daily_api_call_budget = daily_api_call_budget
        self.max_batch_size = max_batch_size
        self._redaction_token = api_token
        self._client = client or httpx.Client(
            base_url=(f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai"),
            headers={"Authorization": f"Bearer {api_token}"},
            timeout=timeout_seconds,
        )
        self._owns_client = client is None
        self._today = today or (lambda: datetime.now(UTC).date())
        self._budget_date = self._today()
        self._conservative_tokens = 0
        self._api_calls = 0
        self._attempted_api_calls = 0
        self._budget_lock = Lock()

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def usage(self) -> dict[str, float | int | str]:
        with self._budget_lock:
            estimated_neurons = (
                self._conservative_tokens / 1_000_000 * self.neurons_per_million_tokens
            )
            return {
                "date": self._budget_date.isoformat(),
                "apiCalls": self._api_calls,
                "attemptedApiCalls": self._attempted_api_calls,
                "conservativeTokenUpperBound": self._conservative_tokens,
                "estimatedNeurons": round(estimated_neurons, 4),
                "dailyNeuronBudget": self.daily_neuron_budget,
                "dailyApiCallBudget": self.daily_api_call_budget,
            }

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._embed(texts)

    def embed_query(self, text: str) -> list[float]:
        vectors = self._embed([text])
        if len(vectors) != 1:
            raise EmbeddingProviderError("Cloudflare returned an unexpected result count.")
        return vectors[0]

    def _embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        batches = embedding_batch_indices(texts, max_batch_size=self.max_batch_size)
        conservative_tokens = sum(
            embedding_batch_token_upper_bound([texts[index] for index in batch])
            for batch in batches
        )
        self._reserve_budget(conservative_tokens, api_calls=len(batches))
        vectors: list[list[float]] = [[] for _ in texts]
        for indices in batches:
            rows = self._embed_batch([texts[index] for index in indices])
            for index, vector in zip(indices, rows, strict=True):
                vectors[index] = vector
        return vectors

    def _embed_batch(self, texts: list[str]) -> list[list[float]]:
        with self._budget_lock:
            self._attempted_api_calls += 1
        try:
            response = self._client.post(
                f"/run/{self.model_name}",
                json={"text": texts, "truncate_inputs": False},
            )
        except httpx.HTTPError as exc:
            raise EmbeddingProviderError("Cloudflare embedding request failed.") from exc
        if response.status_code >= 400:
            raise EmbeddingProviderError(
                f"Cloudflare embedding request returned HTTP {response.status_code}.",
                upstream_details=self._safe_upstream_details(response),
            )
        try:
            payload = response.json()
            if not isinstance(payload, dict) or payload.get("success") is not True:
                raise ValueError("Cloudflare did not acknowledge a successful inference.")
            vectors = payload["result"]["data"]
            if not isinstance(vectors, list) or any(not isinstance(row, list) for row in vectors):
                raise ValueError("Embedding data must be an array of vectors.")
            shape = payload["result"].get("shape")
            if shape is not None and shape != [len(texts), self.dimension]:
                raise ValueError("Embedding shape does not match the requested batch.")
        except (KeyError, TypeError, ValueError) as exc:
            raise EmbeddingProviderError(
                "Cloudflare returned an invalid embedding payload.",
                upstream_details=self._safe_upstream_details(response),
            ) from exc
        if len(vectors) != len(texts):
            raise EmbeddingProviderError("Cloudflare returned an unexpected result count.")
        if any(len(vector) != self.dimension for vector in vectors):
            raise EmbeddingProviderError("Cloudflare returned an unexpected embedding dimension.")
        try:
            normalized = [[float(value) for value in vector] for vector in vectors]
        except (TypeError, ValueError, OverflowError) as exc:
            raise EmbeddingProviderError(
                "Cloudflare returned non-numeric embedding values."
            ) from exc
        if any(not isfinite(value) for vector in normalized for value in vector):
            raise EmbeddingProviderError("Cloudflare returned non-finite embedding values.")
        return normalized

    def _safe_upstream_details(self, response: httpx.Response) -> dict[str, Any] | None:
        try:
            payload = response.json()
        except ValueError:
            return None
        if not isinstance(payload, dict) or not isinstance(payload.get("errors"), list):
            return None
        errors = []
        for item in payload["errors"][:3]:
            if not isinstance(item, dict):
                continue
            message = str(item.get("message", "")).replace(self._redaction_token, "[redacted]")
            message = re.sub(r"(?i)bearer\s+[^\s\"']+", "Bearer [redacted]", message)
            code = str(item.get("code")).replace(self._redaction_token, "[redacted]")
            errors.append({"code": code[:32], "message": message[:512]})
        return {"httpStatus": response.status_code, "errors": errors}

    def _reserve_budget(self, conservative_tokens: int, *, api_calls: int) -> None:
        with self._budget_lock:
            today = self._today()
            if today != self._budget_date:
                self._budget_date = today
                self._conservative_tokens = 0
                self._api_calls = 0
                self._attempted_api_calls = 0
            projected_tokens = self._conservative_tokens + conservative_tokens
            projected_neurons = projected_tokens / 1_000_000 * self.neurons_per_million_tokens
            if projected_neurons > self.daily_neuron_budget:
                raise EmbeddingBudgetExceeded(
                    "Cloudflare embedding daily Neuron budget would be exceeded."
                )
            if self._api_calls + api_calls > self.daily_api_call_budget:
                raise EmbeddingBudgetExceeded(
                    "Cloudflare embedding daily API call budget would be exceeded."
                )
            self._conservative_tokens = projected_tokens
            self._api_calls += api_calls
