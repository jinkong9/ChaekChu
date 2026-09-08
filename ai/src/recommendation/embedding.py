from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import math
import re
from typing import Protocol, Sequence

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


class TextEmbedder(Protocol):
    model_version: str
    dimension: int

    def embed(self, text: str) -> tuple[float, ...]: ...


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


def validate_embedding(vector: Sequence[float], *, dimension: int) -> tuple[float, ...]:
    values = tuple(float(value) for value in vector)
    if len(values) != dimension or any(not math.isfinite(value) for value in values):
        raise EmbeddingError(f"embedding must contain {dimension} finite values")
    return values
