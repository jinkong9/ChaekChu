from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
import math
from typing import Any, Iterable, Literal, Mapping, Protocol, Sequence


DEFAULT_TAG_CODES = frozenset(
    {
        "FIC",
        "ESSAY",
        "SCIENCE",
        "HISTORY",
        "ECONOMY",
        "FANTASY",
        "MYSTERY",
        "ROMANCE",
        "GROWTH",
        "FAMILY",
        "TIME_TRAVEL",
        "TRENDING",
        "STEADY",
        "NEW_BOOK",
    }
)
QUERY_WEIGHT_NAMES = frozenset({"semantic", "tagMatch", "coLoan", "trending", "steady"})


class QueryVectorStatus(str, Enum):
    PERSONALIZED = "PERSONALIZED"
    COLD_START = "COLD_START"


class QueryVectorReason(str, Enum):
    READY = "READY"
    NO_SEED_OR_TAG = "NO_SEED_OR_TAG"
    NO_USABLE_VECTOR = "NO_USABLE_VECTOR"


class QueryVectorStore(Protocol):
    def get_book_vector(self, isbn13: str, index_version: str) -> Sequence[float] | None: ...

    def get_tag_vector(self, code: str, index_version: str) -> Sequence[float] | None: ...


class InMemoryQueryVectorStore:
    """Small deterministic store used for query-vector tests and local smoke checks."""

    def __init__(
        self,
        *,
        index_version: str,
        book_vectors: Mapping[str, Sequence[float]] = (),
        tag_vectors: Mapping[str, Sequence[float]] = (),
    ) -> None:
        self.index_version = index_version
        self.book_vectors = {key: tuple(value) for key, value in dict(book_vectors).items()}
        self.tag_vectors = {key: tuple(value) for key, value in dict(tag_vectors).items()}

    def get_book_vector(self, isbn13: str, index_version: str) -> Sequence[float] | None:
        return self.book_vectors.get(isbn13) if index_version == self.index_version else None

    def get_tag_vector(self, code: str, index_version: str) -> Sequence[float] | None:
        return self.tag_vectors.get(code) if index_version == self.index_version else None


@dataclass(frozen=True, slots=True)
class QueryTagPreference:
    code: str
    weight: float = 1.0

    def __post_init__(self) -> None:
        if not self.code.strip():
            raise ValueError("tag code must not be empty")
        numeric = float(self.weight)
        if not math.isfinite(numeric) or numeric < 0:
            raise ValueError("tag weight must be a finite non-negative number")


@dataclass(frozen=True, slots=True)
class QueryVectorResult:
    status: QueryVectorStatus
    reason: QueryVectorReason
    query_vector: tuple[float, ...] | None
    index_version: str
    used_seed_isbns: tuple[str, ...]
    missing_seed_isbns: tuple[str, ...]
    used_tag_codes: tuple[str, ...]
    missing_tag_codes: tuple[str, ...]
    unknown_tag_codes: tuple[str, ...]


def _validate_weights(weights: Mapping[str, Any] | None) -> tuple[float, float]:
    if weights is None:
        return 0.7, 0.3
    unknown = set(weights) - QUERY_WEIGHT_NAMES
    if unknown:
        raise ValueError(f"unknown query weights: {', '.join(sorted(unknown))}")
    values: dict[str, float] = {}
    for name in QUERY_WEIGHT_NAMES:
        value = float(weights.get(name, 0.0 if name in {"semantic", "tagMatch"} else 0.0))
        if not math.isfinite(value) or value < 0:
            raise ValueError(f"{name} weight must be a finite non-negative number")
        values[name] = value
    return values["semantic"], values["tagMatch"]


def _valid_vector(vector: Sequence[float], *, dimension: int | None = None) -> tuple[float, ...]:
    result = tuple(float(value) for value in vector)
    if not result or any(not math.isfinite(value) for value in result):
        raise ValueError("stored query vector must contain finite values")
    if dimension is not None and len(result) != dimension:
        raise ValueError("all query vectors must have the same dimension")
    return result


def _mean(vectors: Sequence[Sequence[float]]) -> tuple[float, ...]:
    dimension = len(vectors[0])
    return tuple(sum(vector[position] for vector in vectors) / len(vectors) for position in range(dimension))


def _weighted_mean(vectors: Sequence[tuple[Sequence[float], float]]) -> tuple[float, ...]:
    dimension = len(vectors[0][0])
    total_weight = sum(weight for _vector, weight in vectors)
    return tuple(
        sum(vector[position] * weight for vector, weight in vectors) / total_weight
        for position in range(dimension)
    )


class QueryVectorBuilder:
    """Build a query vector from precomputed book and tag vectors only."""

    def __init__(
        self,
        store: QueryVectorStore,
        *,
        index_version: str,
        allowed_tag_codes: Iterable[str] = DEFAULT_TAG_CODES,
    ) -> None:
        if not index_version.strip():
            raise ValueError("index_version must not be empty")
        self.store = store
        self.index_version = index_version
        self.allowed_tag_codes = frozenset(code.strip() for code in allowed_tag_codes if code.strip())

    def build(
        self,
        *,
        mode: Literal["COLD_START", "PERSONALIZED"] = "PERSONALIZED",
        seed_isbns: Iterable[str] = (),
        tags: Mapping[str, float] | Iterable[QueryTagPreference] = (),
        weights: Mapping[str, Any] | None = None,
    ) -> QueryVectorResult:
        if mode not in {"COLD_START", "PERSONALIZED"}:
            raise ValueError("mode must be COLD_START or PERSONALIZED")
        semantic_weight, tag_weight = _validate_weights(weights)
        seeds = tuple(dict.fromkeys(isbn.strip() for isbn in seed_isbns if isinstance(isbn, str) and isbn.strip()))
        if isinstance(tags, Mapping):
            preferences = tuple(QueryTagPreference(str(code).strip(), weight) for code, weight in tags.items() if str(code).strip())
        else:
            preferences = tuple(tags)
        preference_by_code: dict[str, QueryTagPreference] = {}
        for preference in preferences:
            preference_by_code[preference.code.strip()] = QueryTagPreference(preference.code.strip(), preference.weight)
        sorted_preferences = tuple(sorted(preference_by_code.values(), key=lambda item: item.code))
        unknown = tuple(sorted(preference.code for preference in sorted_preferences if preference.code not in self.allowed_tag_codes))

        seed_vectors: list[tuple[float, ...]] = []
        used_seeds: list[str] = []
        missing_seeds: list[str] = []
        dimension: int | None = None
        for isbn13 in seeds:
            vector = self.store.get_book_vector(isbn13, self.index_version)
            if vector is None:
                missing_seeds.append(isbn13)
                continue
            normalized = _valid_vector(vector, dimension=dimension)
            dimension = len(normalized)
            seed_vectors.append(normalized)
            used_seeds.append(isbn13)

        tag_vectors: list[tuple[tuple[float, ...], float]] = []
        used_tags: list[str] = []
        missing_tags: list[str] = []
        for preference in sorted_preferences:
            if preference.code not in self.allowed_tag_codes or preference.weight <= 0:
                continue
            vector = self.store.get_tag_vector(preference.code, self.index_version)
            if vector is None:
                missing_tags.append(preference.code)
                continue
            normalized = _valid_vector(vector, dimension=dimension)
            dimension = len(normalized)
            tag_vectors.append((normalized, float(preference.weight)))
            used_tags.append(preference.code)

        components: list[tuple[tuple[float, ...], float]] = []
        if seed_vectors and semantic_weight > 0:
            components.append((_mean(seed_vectors), semantic_weight))
        if tag_vectors and tag_weight > 0:
            components.append((_weighted_mean(tag_vectors), tag_weight))
        if not components:
            reason = QueryVectorReason.NO_SEED_OR_TAG if not seeds and not sorted_preferences else QueryVectorReason.NO_USABLE_VECTOR
            return QueryVectorResult(
                status=QueryVectorStatus.COLD_START,
                reason=reason,
                query_vector=None,
                index_version=self.index_version,
                used_seed_isbns=tuple(used_seeds),
                missing_seed_isbns=tuple(missing_seeds),
                used_tag_codes=tuple(used_tags),
                missing_tag_codes=tuple(missing_tags),
                unknown_tag_codes=unknown,
            )

        query = _weighted_mean(components)
        return QueryVectorResult(
            status=QueryVectorStatus.PERSONALIZED,
            reason=QueryVectorReason.READY,
            query_vector=tuple(round(value, 8) for value in query),
            index_version=self.index_version,
            used_seed_isbns=tuple(used_seeds),
            missing_seed_isbns=tuple(missing_seeds),
            used_tag_codes=tuple(used_tags),
            missing_tag_codes=tuple(missing_tags),
            unknown_tag_codes=unknown,
        )


__all__ = [
    "DEFAULT_TAG_CODES",
    "InMemoryQueryVectorStore",
    "QueryTagPreference",
    "QueryVectorBuilder",
    "QueryVectorReason",
    "QueryVectorResult",
    "QueryVectorStatus",
]
