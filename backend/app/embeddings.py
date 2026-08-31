from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, date, datetime
from threading import Lock

import httpx


class EmbeddingProviderError(RuntimeError):
    """不含凭证与响应正文的可安全记录 provider 错误。"""


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
        self.model_name = model_name
        self.model_version = model_version
        self.dimension = dimension
        self.daily_neuron_budget = daily_neuron_budget
        self.neurons_per_million_tokens = neurons_per_million_tokens
        self.daily_api_call_budget = daily_api_call_budget
        self.max_batch_size = max_batch_size
        self._client = client or httpx.Client(
            base_url=(f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1"),
            headers={"Authorization": f"Bearer {api_token}"},
            timeout=timeout_seconds,
        )
        self._owns_client = client is None
        self._today = today or (lambda: datetime.now(UTC).date())
        self._budget_date = self._today()
        self._conservative_tokens = 0
        self._api_calls = 0
        self._budget_lock = Lock()

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

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
        batches = [
            texts[start : start + self.max_batch_size]
            for start in range(0, len(texts), self.max_batch_size)
        ]
        self._reserve_budget(texts, api_calls=len(batches))
        vectors: list[list[float]] = []
        for batch in batches:
            vectors.extend(self._embed_batch(batch))
        return vectors

    def _embed_batch(self, texts: list[str]) -> list[list[float]]:
        try:
            response = self._client.post(
                "/embeddings",
                json={"input": texts, "model": self.model_name},
            )
        except httpx.HTTPError as exc:
            raise EmbeddingProviderError("Cloudflare embedding request failed.") from exc
        if response.status_code >= 400:
            raise EmbeddingProviderError(
                f"Cloudflare embedding request returned HTTP {response.status_code}."
            )
        try:
            payload = response.json()
            vectors = [
                item["embedding"] for item in sorted(payload["data"], key=lambda row: row["index"])
            ]
        except (KeyError, TypeError, ValueError) as exc:
            raise EmbeddingProviderError(
                "Cloudflare returned an invalid embedding payload."
            ) from exc
        if len(vectors) != len(texts):
            raise EmbeddingProviderError("Cloudflare returned an unexpected result count.")
        if any(len(vector) != self.dimension for vector in vectors):
            raise EmbeddingProviderError("Cloudflare returned an unexpected embedding dimension.")
        return [[float(value) for value in vector] for vector in vectors]

    def _reserve_budget(self, texts: list[str], *, api_calls: int) -> None:
        conservative_tokens = sum(len(text) for text in texts)
        with self._budget_lock:
            today = self._today()
            if today != self._budget_date:
                self._budget_date = today
                self._conservative_tokens = 0
                self._api_calls = 0
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
