from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
from pathlib import Path
import uuid
from typing import Any, Callable, Protocol
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from recommendation.d4l import D4LBook, iter_d4l_jsonl
from recommendation.embedding import TextEmbedder, embedding_text, validate_embedding
from recommendation.normalization import normalized_input_hash
from recommendation.vector_search import VectorRecord


class IndexVersionConflictError(RuntimeError):
    pass


class VersionedIndexStore(Protocol):
    active_version: str | None

    def begin(self, version: str, metadata: dict[str, Any]) -> None: ...

    def contains(self, version: str, isbn13: str) -> bool: ...

    def upsert(self, version: str, record: VectorRecord) -> None: ...

    def promote(self, version: str) -> None: ...

    def count(self, version: str) -> int: ...


class InMemoryVersionedIndexStore:
    """Reference store for tests; production storage is supplied by the Qdrant layer."""

    def __init__(self) -> None:
        self.active_version: str | None = None
        self._versions: dict[str, dict[str, VectorRecord]] = {}
        self._metadata: dict[str, dict[str, Any]] = {}

    def begin(self, version: str, metadata: dict[str, Any]) -> None:
        existing_metadata = self._metadata.get(version)
        if existing_metadata is not None and existing_metadata != metadata:
            raise IndexVersionConflictError(f"index version already belongs to another batch: {version}")
        self._metadata.setdefault(version, dict(metadata))
        self._versions.setdefault(version, {})

    def contains(self, version: str, isbn13: str) -> bool:
        return isbn13 in self._versions.get(version, {})

    def upsert(self, version: str, record: VectorRecord) -> None:
        if record.index_version not in (None, version):
            raise ValueError("record index_version does not match staging version")
        self._versions.setdefault(version, {})[record.isbn13] = record

    def promote(self, version: str) -> None:
        if version not in self._versions:
            raise IndexVersionConflictError(f"staging index does not exist: {version}")
        self.active_version = version

    def count(self, version: str) -> int:
        return len(self._versions.get(version, {}))

    def get(self, version: str, isbn13: str) -> VectorRecord | None:
        return self._versions.get(version, {}).get(isbn13)

    def metadata(self, version: str) -> dict[str, Any]:
        return dict(self._metadata[version])


class QdrantVersionedIndexStore:
    """Qdrant writer using versioned collections and an atomic active alias swap."""

    def __init__(
        self,
        *,
        base_url: str,
        collection_prefix: str,
        dimension: int,
        active_alias: str = "books_active",
        timeout_seconds: float = 10.0,
        api_key: str | None = None,
        opener: Callable[..., Any] = urlopen,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.collection_prefix = collection_prefix
        self.dimension = dimension
        self.active_alias = active_alias
        self.timeout_seconds = timeout_seconds
        self.api_key = api_key
        self._opener = opener
        self._metadata: dict[str, dict[str, Any]] = {}
        self._indexed: dict[str, set[str]] = {}
        self._active_version: str | None = None

    @property
    def active_version(self) -> str | None:
        return self._active_version

    def _collection_name(self, version: str) -> str:
        suffix = sha256(version.encode("utf-8")).hexdigest()[:16]
        return f"{self.collection_prefix}_{suffix}"

    def _call(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["api-key"] = self.api_key
        data = json.dumps(body).encode("utf-8") if body is not None else None
        response = self._opener(
            Request(f"{self.base_url}{path}", data=data, headers=headers, method=method),
            timeout=self.timeout_seconds,
        )
        raw = response.read()
        return json.loads(raw.decode("utf-8")) if raw else {}

    def begin(self, version: str, metadata: dict[str, Any]) -> None:
        existing_metadata = self._metadata.get(version)
        if existing_metadata is not None and existing_metadata != metadata:
            raise IndexVersionConflictError(f"index version already belongs to another batch: {version}")
        collection = self._collection_name(version)
        try:
            self._call(
                "PUT",
                f"/collections/{collection}",
                {"vectors": {"size": self.dimension, "distance": "Cosine"}},
            )
        except HTTPError as error:
            if error.code != 409:
                raise
        self._metadata.setdefault(version, dict(metadata))
        self._indexed.setdefault(version, set())

    def contains(self, version: str, isbn13: str) -> bool:
        if isbn13 in self._indexed.get(version, set()):
            return True
        collection = self._collection_name(version)
        point_id = self._point_id(version, isbn13)
        try:
            self._call("GET", f"/collections/{collection}/points/{point_id}")
        except HTTPError as error:
            if error.code == 404:
                return False
            raise
        self._indexed.setdefault(version, set()).add(isbn13)
        return True

    @staticmethod
    def _point_id(version: str, isbn13: str) -> str:
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"{version}:{isbn13}"))

    def upsert(self, version: str, record: VectorRecord) -> None:
        if record.index_version not in (None, version):
            raise ValueError("record index_version does not match staging version")
        collection = self._collection_name(version)
        point_id = self._point_id(version, record.isbn13)
        payload = {**record.payload, "indexVersion": version, "active": record.active}
        self._call(
            "PUT",
            f"/collections/{collection}/points?wait=true",
            {"points": [{"id": point_id, "vector": list(record.vector), "payload": payload}]},
        )
        self._indexed.setdefault(version, set()).add(record.isbn13)

    def promote(self, version: str) -> None:
        collection = self._collection_name(version)
        try:
            self._call(
                "POST",
                "/collections/aliases",
                {
                    "actions": [
                        {"delete_alias": {"alias_name": self.active_alias}},
                        {"create_alias": {"collection_name": collection, "alias_name": self.active_alias}},
                    ]
                },
            )
        except HTTPError as error:
            if error.code != 404:
                raise
            self._call(
                "POST",
                "/collections/aliases",
                {"actions": [{"create_alias": {"collection_name": collection, "alias_name": self.active_alias}}]},
            )
        self._active_version = version

    def count(self, version: str) -> int:
        return len(self._indexed.get(version, set()))


@dataclass(frozen=True, slots=True)
class EmbeddingBatchConfig:
    index_version: str
    feature_version: str = "d4l-feature-v1"
    tag_version: str = "not-generated"
    max_retries: int = 2

    def __post_init__(self) -> None:
        if not self.index_version.strip():
            raise ValueError("index_version must not be empty")
        if self.max_retries < 0:
            raise ValueError("max_retries must not be negative")


def _book_payload(book: D4LBook, *, embedder: TextEmbedder, config: EmbeddingBatchConfig) -> dict[str, Any]:
    return {
        "isbn13": book.isbn13,
        "bookname": book.title,
        "authors": book.authors,
        "publisher": book.publisher,
        "pub_year": book.pub_year,
        "class_no": book.class_no,
        "class_nm": book.class_nm,
        "loan_total": book.loan_total,
        "co_loan": list(book.co_loan),
        "mania_rec": list(book.mania_rec),
        "reader_rec": list(book.reader_rec),
        "loan_history": [list(item) for item in book.loan_history],
        "tagCodes": [],
        "tagScores": {},
        "tagConfidence": {},
        "embeddingVersion": embedder.model_version,
        "tagVersion": config.tag_version,
        "featureVersion": config.feature_version,
    }


class EmbeddingBatchRunner:
    def __init__(self, *, embedder: TextEmbedder, store: VersionedIndexStore, config: EmbeddingBatchConfig) -> None:
        self.embedder = embedder
        self.store = store
        self.config = config

    def run(self, input_path: Path) -> dict[str, Any]:
        input_hash = normalized_input_hash(input_path)
        config = self.config
        metadata = {
            "inputHash": input_hash,
            "embeddingVersion": self.embedder.model_version,
            "dimension": self.embedder.dimension,
            "featureVersion": config.feature_version,
            "tagVersion": config.tag_version,
        }
        self.store.begin(config.index_version, metadata)
        active_before = self.store.active_version
        rows = succeeded = failed = skipped = retry_attempts = retried_rows = 0
        errors: list[dict[str, str]] = []
        for book in iter_d4l_jsonl(input_path):
            rows += 1
            if self.store.contains(config.index_version, book.isbn13):
                skipped += 1
                continue
            last_error = ""
            for attempt in range(config.max_retries + 1):
                try:
                    vector = validate_embedding(
                        self.embedder.embed(embedding_text(book)),
                        dimension=self.embedder.dimension,
                    )
                    self.store.upsert(
                        config.index_version,
                        VectorRecord(
                            isbn13=book.isbn13,
                            vector=vector,
                            payload=_book_payload(book, embedder=self.embedder, config=config),
                            active=True,
                            index_version=config.index_version,
                        ),
                    )
                    succeeded += 1
                    if attempt:
                        retried_rows += 1
                    break
                except Exception as error:  # provider failures are recorded per row and do not abort the batch
                    last_error = str(error) or error.__class__.__name__
                    if attempt < config.max_retries:
                        retry_attempts += 1
                        continue
                    failed += 1
                    errors.append({"isbn13": book.isbn13, "error": last_error})
        promoted = failed == 0 and rows > 0
        if promoted:
            self.store.promote(config.index_version)
        return {
            "batchVersion": "d4l-embedding-batch-v1",
            "status": "PROMOTED" if promoted else "PARTIAL_FAILURE",
            "inputHash": input_hash,
            "indexVersion": config.index_version,
            "embeddingVersion": self.embedder.model_version,
            "featureVersion": config.feature_version,
            "tagVersion": config.tag_version,
            "dimension": self.embedder.dimension,
            "activeVersionBefore": active_before,
            "activeVersionAfter": config.index_version if promoted else active_before,
            "promoted": promoted,
            "rows": rows,
            "succeededRows": succeeded,
            "failedRows": failed,
            "skippedRows": skipped,
            "retriedRows": retried_rows,
            "retryAttempts": retry_attempts,
            "stagedRows": self.store.count(config.index_version),
            "errors": errors,
        }
