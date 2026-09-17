from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
import json
import math
from typing import Any, Callable, Iterable, Protocol, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


class SearchStatus(str, Enum):
    OK = "OK"
    CANDIDATE_SHORTAGE = "CANDIDATE_SHORTAGE"
    INDEX_NOT_FOUND = "INDEX_NOT_FOUND"
    TIMEOUT = "TIMEOUT"


class VectorSearchError(RuntimeError):
    status = SearchStatus.INDEX_NOT_FOUND


class IndexNotFoundError(VectorSearchError):
    status = SearchStatus.INDEX_NOT_FOUND


class SearchTimeoutError(VectorSearchError):
    status = SearchStatus.TIMEOUT


class QueryVectorStoreError(RuntimeError):
    """Raised when a precomputed query vector cannot be read from Qdrant."""

    status = SearchStatus.INDEX_NOT_FOUND


class QueryVectorStoreTimeoutError(QueryVectorStoreError):
    status = SearchStatus.TIMEOUT


@dataclass(frozen=True, slots=True)
class CandidateSearchRequest:
    query_vector: tuple[float, ...]
    limit: int = 100
    exclude_isbns: frozenset[str] = field(default_factory=frozenset)
    seed_isbns: frozenset[str] = field(default_factory=frozenset)
    tag_codes: frozenset[str] = field(default_factory=frozenset)
    index_version: str | None = None

    def __post_init__(self) -> None:
        vector = tuple(float(value) for value in self.query_vector)
        if not vector or any(not math.isfinite(value) for value in vector):
            raise ValueError("query_vector must contain finite values")
        if self.limit < 1 or self.limit > 300:
            raise ValueError("limit must be between 1 and 300")
        object.__setattr__(self, "query_vector", vector)
        object.__setattr__(self, "exclude_isbns", frozenset(self.exclude_isbns))
        object.__setattr__(self, "seed_isbns", frozenset(self.seed_isbns))
        object.__setattr__(self, "tag_codes", frozenset(code.strip() for code in self.tag_codes if code.strip()))

    @property
    def hard_excluded_isbns(self) -> frozenset[str]:
        return self.exclude_isbns | self.seed_isbns


@dataclass(frozen=True, slots=True)
class VectorRecord:
    isbn13: str
    vector: tuple[float, ...]
    payload: dict[str, Any] = field(default_factory=dict)
    active: bool = True
    index_version: str | None = None


@dataclass(frozen=True, slots=True)
class CandidateHit:
    isbn13: str
    score: float
    payload: dict[str, Any]


@dataclass(frozen=True, slots=True)
class CandidateSearchResponse:
    status: SearchStatus
    index_version: str | None
    requested_limit: int
    returned_count: int
    items: tuple[CandidateHit, ...] = ()
    reason: str | None = None
    search_params: dict[str, Any] = field(default_factory=dict)


class VectorSearchAdapter(Protocol):
    @property
    def index_version(self) -> str | None: ...

    def search(self, request: CandidateSearchRequest) -> list[CandidateHit]: ...


def _cosine(left: Sequence[float], right: Sequence[float]) -> float:
    if len(left) != len(right):
        raise ValueError("query and indexed vectors must have the same dimension")
    dot = sum(left_value * right_value for left_value, right_value in zip(left, right))
    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    return dot / (left_norm * right_norm) if left_norm and right_norm else 0.0


class InMemoryVectorIndex:
    """Deterministic reference adapter used by tests and local smoke checks."""

    def __init__(self, records: Iterable[VectorRecord], *, index_version: str, active: bool = True) -> None:
        self.index_version = index_version
        self.active = active
        self._records = tuple(sorted(records, key=lambda record: record.isbn13))
        isbns = [record.isbn13 for record in self._records]
        if len(isbns) != len(set(isbns)):
            raise ValueError("indexed isbn13 values must be unique")

    def search(self, request: CandidateSearchRequest) -> list[CandidateHit]:
        if not self.active or (request.index_version is not None and request.index_version != self.index_version):
            raise IndexNotFoundError(f"active index not found: {request.index_version or self.index_version}")
        scored: list[CandidateHit] = []
        for record in self._records:
            if not record.active or record.index_version not in (None, self.index_version):
                continue
            if record.isbn13 in request.hard_excluded_isbns:
                continue
            if request.tag_codes:
                raw_codes = record.payload.get("tagCodes", record.payload.get("tag_codes"))
                candidate_codes = {
                    code.strip() for code in raw_codes if isinstance(code, str) and code.strip()
                } if isinstance(raw_codes, (list, tuple, set)) else set()
                if not request.tag_codes & candidate_codes:
                    continue
            score = _cosine(request.query_vector, record.vector)
            scored.append(CandidateHit(record.isbn13, round(score, 8), dict(record.payload)))
        scored.sort(key=lambda hit: (-hit.score, hit.isbn13))
        return scored[: request.limit]


class QdrantVectorIndex:
    """Qdrant REST adapter without coupling the core package to a client SDK."""

    def __init__(
        self,
        *,
        base_url: str,
        collection: str,
        index_version: str,
        timeout_seconds: float = 2.0,
        api_key: str | None = None,
        opener: Callable[..., Any] = urlopen,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.collection = collection
        self.index_version = index_version
        self.timeout_seconds = timeout_seconds
        self.api_key = api_key
        self._opener = opener

    def search(self, request: CandidateSearchRequest) -> list[CandidateHit]:
        if request.index_version is not None and request.index_version != self.index_version:
            raise IndexNotFoundError(f"active index not found: {request.index_version}")
        excluded = sorted(request.hard_excluded_isbns)
        must_not: list[dict[str, Any]] = []
        if excluded:
            must_not.append({"key": "isbn13", "match": {"any": excluded}})
        body = {
            "vector": list(request.query_vector),
            "limit": request.limit,
            "with_payload": True,
            "filter": {
                "must": [
                    {"key": "indexVersion", "match": {"value": self.index_version}},
                    {"key": "active", "match": {"value": True}},
                ],
                "must_not": must_not,
            },
        }
        if request.tag_codes:
            body["filter"]["should"] = [
                {"key": "tagCodes", "match": {"value": code}}
                for code in sorted(request.tag_codes)
            ]
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["api-key"] = self.api_key
        endpoint = f"{self.base_url}/collections/{self.collection}/points/search"
        try:
            response = self._opener(
                Request(endpoint, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST"),
                timeout=self.timeout_seconds,
            )
            result = json.loads(response.read().decode("utf-8"))["result"]
        except (TimeoutError, HTTPError) as error:
            if isinstance(error, HTTPError) and error.code not in (408, 504):
                raise IndexNotFoundError(f"Qdrant search failed with HTTP {error.code}") from error
            raise SearchTimeoutError("Qdrant search timed out") from error
        except URLError as error:
            if isinstance(error.reason, TimeoutError):
                raise SearchTimeoutError("Qdrant search timed out") from error
            raise IndexNotFoundError("Qdrant collection is unavailable") from error
        except (KeyError, json.JSONDecodeError, UnicodeDecodeError) as error:
            raise VectorSearchError("Qdrant returned an invalid search response") from error

        hits: list[CandidateHit] = []
        for item in result:
            payload = item.get("payload") or {}
            isbn13 = payload.get("isbn13")
            if not isinstance(isbn13, str) or not isbn13 or isbn13 in request.hard_excluded_isbns:
                continue
            score = item.get("score", 0.0)
            if not isinstance(score, (int, float)) or not math.isfinite(score):
                continue
            hits.append(CandidateHit(isbn13, round(float(score), 8), dict(payload)))
        hits.sort(key=lambda hit: (-hit.score, hit.isbn13))
        return hits[: request.limit]


class QdrantQueryVectorStore:
    """Read precomputed seed and tag vectors from Qdrant at request time.

    The online API never calls an embedding provider. Book vectors are read from
    the active book collection by the deterministic point id used by the batch
    writer. Tag prototypes may live in an optional separate collection; when it
    is not configured, tag-only requests safely fall back to demand ranking.
    """

    def __init__(
        self,
        *,
        base_url: str,
        index_version: str,
        book_collection: str = "books_active",
        tag_collection: str | None = None,
        vector_name: str | None = None,
        timeout_seconds: float = 2.0,
        api_key: str | None = None,
        opener: Callable[..., Any] = urlopen,
    ) -> None:
        if not base_url.strip():
            raise ValueError("base_url must not be empty")
        if not index_version.strip():
            raise ValueError("index_version must not be empty")
        if timeout_seconds <= 0 or not math.isfinite(timeout_seconds):
            raise ValueError("timeout_seconds must be positive and finite")
        self.base_url = base_url.rstrip("/")
        self.index_version = index_version
        self.book_collection = book_collection
        self.tag_collection = tag_collection or None
        self.vector_name = vector_name or None
        self.timeout_seconds = timeout_seconds
        self.api_key = api_key
        self._opener = opener

    @staticmethod
    def _point_id(index_version: str, key: str) -> str:
        import uuid

        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"{index_version}:{key}"))

    def _get_vector(self, collection: str, point_key: str) -> tuple[float, ...] | None:
        point = self._get_point(collection, point_key)
        if point is None:
            return None
        return self._vector_from_point(point)

    def _vector_from_point(self, result: dict[str, Any]) -> tuple[float, ...]:
        raw_vector = result.get("vector") if isinstance(result, dict) else None
        if isinstance(raw_vector, dict):
            if self.vector_name:
                raw_vector = raw_vector.get(self.vector_name)
            else:
                raw_vector = next(iter(raw_vector.values()), None)
        if not isinstance(raw_vector, (list, tuple)):
            raise QueryVectorStoreError("Qdrant point did not contain a vector")
        vector = tuple(float(value) for value in raw_vector)
        if not vector or any(not math.isfinite(value) for value in vector):
            raise QueryVectorStoreError("Qdrant point vector was not finite")
        return vector

    def _get_point(self, collection: str, point_key: str) -> dict[str, Any] | None:
        point_id = self._point_id(self.index_version, point_key)
        endpoint = (
            f"{self.base_url}/collections/{quote(collection, safe='')}/points/"
            f"{quote(point_id, safe='')}?with_vector=true&with_payload=true"
        )
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["api-key"] = self.api_key
        try:
            response = self._opener(Request(endpoint, headers=headers, method="GET"), timeout=self.timeout_seconds)
            result = json.loads(response.read().decode("utf-8"))["result"]
        except HTTPError as error:
            if error.code == 404:
                return None
            if error.code in (408, 429, 500, 502, 503, 504):
                raise QueryVectorStoreTimeoutError("Qdrant query vector request timed out") from error
            raise QueryVectorStoreError("Qdrant query vector request failed") from error
        except (TimeoutError, URLError) as error:
            raise QueryVectorStoreTimeoutError("Qdrant query vector request timed out") from error
        except (KeyError, TypeError, json.JSONDecodeError, UnicodeDecodeError) as error:
            raise QueryVectorStoreError("Qdrant returned an invalid query vector") from error

        if not isinstance(result, dict):
            raise QueryVectorStoreError("Qdrant point response was not an object")
        return result

    def get_book_vector(self, isbn13: str, index_version: str) -> Sequence[float] | None:
        if index_version != self.index_version:
            return None
        return self._get_vector(self.book_collection, isbn13)

    def get_tag_vector(self, code: str, index_version: str) -> Sequence[float] | None:
        if index_version != self.index_version or not self.tag_collection:
            return None
        return self._get_vector(self.tag_collection, f"tag:{code}")

    def get_book_dna_record(self, isbn13: str, index_version: str):
        """Read the indexed vector and DNA payload for one seed book."""

        if index_version != self.index_version:
            return None
        from recommendation.book_dna import BookDnaRecord

        point = self._get_point(self.book_collection, isbn13)
        if point is None:
            return None
        payload = point.get("payload")
        if not isinstance(payload, dict):
            raise QueryVectorStoreError("Qdrant book point did not contain a payload")
        vector = self._vector_from_point(point)
        raw_tags = payload.get("tagCodes", ())
        tag_codes = tuple(code for code in raw_tags if isinstance(code, str)) if isinstance(raw_tags, (list, tuple)) else ()
        class_no = payload.get("class_no", payload.get("classNo"))
        return BookDnaRecord(
            isbn13=isbn13,
            vector=vector,
            tag_codes=tag_codes,
            genre_code=payload.get("genreCode") if isinstance(payload.get("genreCode"), str) else None,
            class_no=class_no if isinstance(class_no, str) else None,
        )


class CandidateSearchService:
    def __init__(self, adapter: VectorSearchAdapter) -> None:
        self.adapter = adapter

    def search(self, request: CandidateSearchRequest) -> CandidateSearchResponse:
        search_params = {
            "candidateLimit": request.limit,
            "excludeCount": len(request.exclude_isbns),
            "seedCount": len(request.seed_isbns),
            "tagCount": len(request.tag_codes),
            "activeOnly": True,
        }
        try:
            items = tuple(self.adapter.search(request))
        except TimeoutError as error:
            return CandidateSearchResponse(
                status=SearchStatus.TIMEOUT,
                index_version=self.adapter.index_version,
                requested_limit=request.limit,
                returned_count=0,
                reason=str(error),
                search_params=search_params,
            )
        except VectorSearchError as error:
            return CandidateSearchResponse(
                status=error.status,
                index_version=self.adapter.index_version,
                requested_limit=request.limit,
                returned_count=0,
                reason=str(error),
                search_params=search_params,
            )
        status = SearchStatus.OK if len(items) >= request.limit else SearchStatus.CANDIDATE_SHORTAGE
        return CandidateSearchResponse(
            status=status,
            index_version=self.adapter.index_version,
            requested_limit=request.limit,
            returned_count=len(items),
            items=items,
            search_params=search_params,
        )

    def search_by_tags(
        self,
        request: CandidateSearchRequest,
        tag_codes: Iterable[str],
    ) -> CandidateSearchResponse:
        """Search the same index while restricting candidates to requested tags."""

        tagged_request = CandidateSearchRequest(
            query_vector=request.query_vector,
            limit=request.limit,
            exclude_isbns=request.exclude_isbns,
            seed_isbns=request.seed_isbns,
            tag_codes=frozenset(tag_codes),
            index_version=request.index_version,
        )
        return self.search(tagged_request)
