from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
import math
from typing import Any, Callable, Protocol
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import uuid

from recommendation.embedding import TextEmbedder, validate_embedding
from recommendation.tag_batch import TAXONOMY, TAXONOMY_VERSION, TagDefinition
from recommendation.vector_search import VectorRecord


@dataclass(frozen=True, slots=True)
class TagPrototypeBatchConfig:
    index_version: str
    tag_version: str = "d4l-tags-v1"
    batch_size: int = 32
    max_retries: int = 2

    def __post_init__(self) -> None:
        if not self.index_version.strip() or not self.tag_version.strip():
            raise ValueError("index_version and tag_version must not be empty")
        if self.batch_size < 1:
            raise ValueError("batch_size must be positive")
        if self.max_retries < 0:
            raise ValueError("max_retries must not be negative")


class TagPrototypeIndexStore(Protocol):
    active_version: str | None

    def begin(self, version: str, metadata: dict[str, Any]) -> None: ...

    def contains(self, version: str, code: str) -> bool: ...

    def upsert_many(self, version: str, records: list[VectorRecord]) -> None: ...

    def promote(self, version: str) -> None: ...

    def count(self, version: str) -> int: ...


class InMemoryTagPrototypeIndexStore:
    """Reference tag store used by prototype and query-vector tests."""

    def __init__(self) -> None:
        self.active_version: str | None = None
        self._versions: dict[str, dict[str, VectorRecord]] = {}
        self._metadata: dict[str, dict[str, Any]] = {}

    def begin(self, version: str, metadata: dict[str, Any]) -> None:
        existing = self._metadata.get(version)
        if existing is not None and existing != metadata:
            raise ValueError(f"tag prototype version already belongs to another batch: {version}")
        self._metadata.setdefault(version, dict(metadata))
        self._versions.setdefault(version, {})

    def contains(self, version: str, code: str) -> bool:
        return f"tag:{code}" in self._versions.get(version, {})

    def upsert_many(self, version: str, records: list[VectorRecord]) -> None:
        for record in records:
            if record.index_version not in (None, version):
                raise ValueError("record index_version does not match staging version")
            self._versions.setdefault(version, {})[f"tag:{record.isbn13}"] = record

    def promote(self, version: str) -> None:
        if version not in self._versions:
            raise ValueError(f"tag prototype staging index does not exist: {version}")
        self.active_version = version

    def count(self, version: str) -> int:
        return len(self._versions.get(version, {}))

    def get(self, version: str, code: str) -> VectorRecord | None:
        return self._versions.get(version, {}).get(f"tag:{code}")


class QdrantTagPrototypeIndexStore:
    """Qdrant writer for versioned tag prototype collections and an active alias."""

    def __init__(
        self,
        *,
        base_url: str,
        collection_prefix: str = "tags",
        dimension: int,
        active_alias: str = "tags_active",
        timeout_seconds: float = 10.0,
        api_key: str | None = None,
        opener: Callable[..., Any] = urlopen,
    ) -> None:
        if not base_url.strip() or dimension < 1:
            raise ValueError("base_url must not be empty and dimension must be positive")
        if timeout_seconds <= 0 or not math.isfinite(timeout_seconds):
            raise ValueError("timeout_seconds must be positive and finite")
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

    @staticmethod
    def _point_id(version: str, code: str) -> str:
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"{version}:tag:{code}"))

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
        existing = self._metadata.get(version)
        if existing is not None and existing != metadata:
            raise ValueError(f"tag prototype version already belongs to another batch: {version}")
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

    def contains(self, version: str, code: str) -> bool:
        if code in self._indexed.get(version, set()):
            return True
        collection = self._collection_name(version)
        try:
            self._call("GET", f"/collections/{collection}/points/{self._point_id(version, code)}")
        except HTTPError as error:
            if error.code == 404:
                return False
            raise
        self._indexed.setdefault(version, set()).add(code)
        return True

    def upsert_many(self, version: str, records: list[VectorRecord]) -> None:
        if not records:
            return
        collection = self._collection_name(version)
        points = [
            {
                "id": self._point_id(version, record.isbn13),
                "vector": list(record.vector),
                "payload": {**record.payload, "indexVersion": version, "active": record.active},
            }
            for record in records
        ]
        self._call("PUT", f"/collections/{collection}/points?wait=true", {"points": points})
        self._indexed.setdefault(version, set()).update(record.isbn13 for record in records)

    def promote(self, version: str) -> None:
        collection = self._collection_name(version)
        actions = [
            {"delete_alias": {"alias_name": self.active_alias}},
            {"create_alias": {"collection_name": collection, "alias_name": self.active_alias}},
        ]
        try:
            self._call("POST", "/collections/aliases", {"actions": actions})
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


def _prototype_text(definition: TagDefinition) -> str:
    return f"tag_code={definition.code} tag_label={definition.label}"


def _prototype_record(
    definition: TagDefinition,
    vector: tuple[float, ...],
    *,
    embedder: TextEmbedder,
    config: TagPrototypeBatchConfig,
) -> VectorRecord:
    return VectorRecord(
        isbn13=definition.code,
        vector=vector,
        payload={
            "tagCode": definition.code,
            "tagLabel": definition.label,
            "taxonomyVersion": TAXONOMY_VERSION,
            "tagVersion": config.tag_version,
            "embeddingVersion": embedder.model_version,
            "featureVersion": "tag-prototype-v1",
        },
        active=True,
        index_version=config.index_version,
    )


class TagPrototypeBatchRunner:
    def __init__(
        self,
        *,
        embedder: TextEmbedder,
        store: TagPrototypeIndexStore,
        config: TagPrototypeBatchConfig,
        taxonomy: tuple[TagDefinition, ...] = TAXONOMY,
    ) -> None:
        if not taxonomy:
            raise ValueError("taxonomy must not be empty")
        codes = [definition.code for definition in taxonomy]
        if len(set(codes)) != len(codes):
            raise ValueError("taxonomy codes must be unique")
        self.embedder = embedder
        self.store = store
        self.config = config
        self.taxonomy = taxonomy

    def run(self) -> dict[str, Any]:
        config = self.config
        metadata = {
            "embeddingVersion": self.embedder.model_version,
            "dimension": self.embedder.dimension,
            "taxonomyVersion": TAXONOMY_VERSION,
            "tagVersion": config.tag_version,
            "prototypeVersion": "tag-prototype-v1",
        }
        self.store.begin(config.index_version, metadata)
        active_before = self.store.active_version
        succeeded = failed = skipped = retry_attempts = retried_rows = 0
        errors: list[dict[str, str]] = []
        for start in range(0, len(self.taxonomy), config.batch_size):
            batch = self.taxonomy[start : start + config.batch_size]
            pending = [definition for definition in batch if not self.store.contains(config.index_version, definition.code)]
            skipped += len(batch) - len(pending)
            if not pending:
                continue
            last_error = ""
            for attempt in range(config.max_retries + 1):
                try:
                    texts = [_prototype_text(definition) for definition in pending]
                    if len(texts) > 1 and hasattr(self.embedder, "embed_many"):
                        vectors = self.embedder.embed_many(texts)  # type: ignore[attr-defined]
                    else:
                        vectors = [self.embedder.embed(text) for text in texts]
                    if len(vectors) != len(pending):
                        raise ValueError("embedding provider returned an unexpected item count")
                    records = [
                        _prototype_record(
                            definition,
                            validate_embedding(vector, dimension=self.embedder.dimension),
                            embedder=self.embedder,
                            config=config,
                        )
                        for definition, vector in zip(pending, vectors)
                    ]
                    self.store.upsert_many(config.index_version, records)
                    succeeded += len(pending)
                    if attempt:
                        retried_rows += len(pending)
                    break
                except Exception as error:  # provider/store failures are retried per batch
                    last_error = str(error) or error.__class__.__name__
                    if attempt < config.max_retries:
                        retry_attempts += 1
                        continue
                    failed += len(pending)
                    errors.extend({"tagCode": definition.code, "error": last_error} for definition in pending)
        promoted = failed == 0 and bool(self.taxonomy)
        if promoted:
            self.store.promote(config.index_version)
        return {
            "batchVersion": "d4l-tag-prototype-batch-v1",
            "status": "PROMOTED" if promoted else "PARTIAL_FAILURE",
            "indexVersion": config.index_version,
            "tagVersion": config.tag_version,
            "taxonomyVersion": TAXONOMY_VERSION,
            "embeddingVersion": self.embedder.model_version,
            "dimension": self.embedder.dimension,
            "activeVersionBefore": active_before,
            "activeVersionAfter": config.index_version if promoted else active_before,
            "promoted": promoted,
            "rows": len(self.taxonomy),
            "succeededRows": succeeded,
            "failedRows": failed,
            "skippedRows": skipped,
            "retriedRows": retried_rows,
            "retryAttempts": retry_attempts,
            "stagedRows": self.store.count(config.index_version),
            "errors": errors,
        }


__all__ = [
    "InMemoryTagPrototypeIndexStore",
    "QdrantTagPrototypeIndexStore",
    "TagPrototypeBatchConfig",
    "TagPrototypeBatchRunner",
    "TagPrototypeIndexStore",
]
