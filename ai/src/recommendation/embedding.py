from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
import math
import re
from typing import Any, Callable, Protocol, Sequence
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from recommendation.d4l import D4LBook


EMBEDDING_INPUT_FIELDS = (
    "bookname",
    "authors",
    "publisher",
    "pub_year",
    "class_no",
    "class_nm",
)
TOKEN_PATTERN = re.compile(r"[0-9A-Za-z가-힣]+")


class EmbeddingError(RuntimeError):
    pass


class EmbeddingProviderError(EmbeddingError):
    """A sanitized provider or transport failure safe to write to a batch report."""


class TextEmbedder(Protocol):
    model_version: str
    dimension: int

    def embed(self, text: str) -> tuple[float, ...]: ...


class BatchTextEmbedder(TextEmbedder, Protocol):
    def embed_many(self, texts: Sequence[str]) -> list[tuple[float, ...]]: ...


def embedding_text(book: D4LBook) -> str:
    """Build the versioned text input from fields present in the D4L snapshot."""
    values = {
        "bookname": book.title,
        "authors": book.authors,
        "publisher": book.publisher,
        "pub_year": book.pub_year or "",
        "class_no": book.class_no or "",
        "class_nm": book.class_nm or "",
    }
    return " ".join(f"{field}={values[field].strip()}" for field in EMBEDDING_INPUT_FIELDS if values[field].strip())


@dataclass(frozen=True, slots=True)
class HashingTextEmbedder:
    """Offline deterministic provider for tests and reproducible smoke checks.

    Production can implement the same TextEmbedder protocol with a GMS-backed model;
    relations and loan history intentionally never enter this text embedding.
    """

    model_version: str = "hashing-embedding-v1"
    dimension: int = 64

    def __post_init__(self) -> None:
        if self.dimension < 1:
            raise ValueError("dimension must be positive")

    def embed(self, text: str) -> tuple[float, ...]:
        tokens = TOKEN_PATTERN.findall(text.casefold())
        vector = [0.0] * self.dimension
        for token in tokens:
            digest = sha256(f"{self.model_version}\0{token}".encode("utf-8")).digest()
            bucket = int.from_bytes(digest[:8], "big") % self.dimension
            sign = 1.0 if digest[8] & 1 else -1.0
            vector[bucket] += sign * (1.0 + digest[9] / 255.0)
        norm = math.sqrt(sum(value * value for value in vector))
        if not norm:
            return tuple(0.0 for _ in vector)
        return tuple(round(value / norm, 8) for value in vector)


class OpenAICompatibleEmbeddingProvider:
    """Call a GMS/OpenAI-compatible embeddings endpoint for offline batches.

    The provider deliberately exposes only sanitized errors. Request bodies,
    response bodies, API keys, and source text are never included in exceptions
    or logs. The batch runner remains responsible for retries and checkpoints.
    """

    def __init__(
        self,
        *,
        endpoint: str,
        api_key: str,
        model_version: str,
        dimension: int,
        timeout_seconds: float = 30.0,
        batch_size: int = 32,
        send_dimensions: bool = True,
        opener: Callable[..., Any] = urlopen,
    ) -> None:
        if not endpoint.strip() or not api_key.strip() or not model_version.strip():
            raise ValueError("endpoint, api_key, and model_version are required")
        if dimension < 1:
            raise ValueError("dimension must be positive")
        if timeout_seconds <= 0 or not math.isfinite(timeout_seconds):
            raise ValueError("timeout_seconds must be positive and finite")
        if batch_size < 1:
            raise ValueError("batch_size must be positive")
        self.endpoint = endpoint.rstrip("/")
        self.api_key = api_key
        self.model_version = model_version
        self.dimension = dimension
        self.timeout_seconds = timeout_seconds
        self.batch_size = batch_size
        self.send_dimensions = send_dimensions
        self._opener = opener

    def embed(self, text: str) -> tuple[float, ...]:
        values = self.embed_many([text])
        return values[0]

    def embed_many(self, texts: Sequence[str]) -> list[tuple[float, ...]]:
        values = list(texts)
        if not values:
            return []
        result: list[tuple[float, ...]] = []
        for start in range(0, len(values), self.batch_size):
            result.extend(self._request(values[start : start + self.batch_size]))
        return result

    def _request(self, texts: Sequence[str]) -> list[tuple[float, ...]]:
        body: dict[str, Any] = {"input": list(texts), "model": self.model_version}
        if self.send_dimensions:
            body["dimensions"] = self.dimension
        request = Request(
            self.endpoint,
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            response = self._opener(request, timeout=self.timeout_seconds)
            payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            raise EmbeddingProviderError(f"embedding provider returned HTTP {error.code}") from error
        except (TimeoutError, URLError, OSError) as error:
            raise EmbeddingProviderError("embedding provider request failed") from error
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise EmbeddingProviderError("embedding provider returned invalid JSON") from error

        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, list) or len(data) != len(texts):
            raise EmbeddingProviderError("embedding provider returned an unexpected item count")
        ordered: list[tuple[int, tuple[float, ...]]] = []
        for item in data:
            if not isinstance(item, dict) or not isinstance(item.get("index"), int):
                raise EmbeddingProviderError("embedding provider response is missing item indexes")
            raw_vector = item.get("embedding")
            if not isinstance(raw_vector, (list, tuple)):
                raise EmbeddingProviderError("embedding provider response is missing vectors")
            try:
                vector = validate_embedding(raw_vector, dimension=self.dimension)
            except (EmbeddingError, TypeError, ValueError) as error:
                raise EmbeddingProviderError("embedding provider returned an invalid vector") from error
            ordered.append((item["index"], vector))
        indexes = [index for index, _vector in ordered]
        if sorted(indexes) != list(range(len(texts))):
            raise EmbeddingProviderError("embedding provider returned invalid item indexes")
        return [vector for _index, vector in sorted(ordered)]


def validate_embedding(vector: Sequence[float], *, dimension: int) -> tuple[float, ...]:
    values = tuple(float(value) for value in vector)
    if len(values) != dimension or any(not math.isfinite(value) for value in values):
        raise EmbeddingError(f"embedding must contain {dimension} finite values")
    return values
