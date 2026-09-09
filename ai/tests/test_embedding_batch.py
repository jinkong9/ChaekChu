from __future__ import annotations

import json
from pathlib import Path

import pytest

from recommendation.d4l import load_d4l_jsonl
from recommendation.embedding import EmbeddingProviderError, HashingTextEmbedder, OpenAICompatibleEmbeddingProvider, embedding_text
from recommendation.embedding_batch import (
    EmbeddingBatchConfig,
    EmbeddingBatchRunner,
    InMemoryVersionedIndexStore,
    QdrantVersionedIndexStore,
)
from recommendation.vector_search import VectorRecord


ROOT = Path(__file__).resolve().parents[1]
D4L_FIXTURE = ROOT / "tests" / "fixtures" / "d4l_usage.contract.sample.jsonl"


def test_embedding_text_uses_only_versioned_bibliographic_fields() -> None:
    book = load_d4l_jsonl(D4L_FIXTURE)[0]

    text = embedding_text(book)

    assert "bookname=달빛 정원" in text
    assert "authors=김하늘" in text
    assert "class_nm=한국소설" in text
    assert "9780000000002" not in text
    assert "2026년 01월" not in text


def test_hashing_embedder_is_deterministic_and_dimensioned() -> None:
    embedder = HashingTextEmbedder(model_version="test-model-v1", dimension=8)

    first = embedder.embed("bookname=달빛 정원 authors=김하늘")
    second = embedder.embed("bookname=달빛 정원 authors=김하늘")

    assert first == second
    assert len(first) == 8
    assert all(-1.0 <= value <= 1.0 for value in first)


def test_openai_compatible_embedding_provider_validates_and_restores_response_order() -> None:
    captured: dict[str, object] = {}

    class Response:
        def read(self) -> bytes:
            return json.dumps(
                {
                    "data": [
                        {"index": 1, "embedding": [0.0, 1.0]},
                        {"index": 0, "embedding": [1.0, 0.0]},
                    ]
                }
            ).encode("utf-8")

    def opener(request, timeout):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        captured["authorization"] = request.headers["Authorization"]
        captured["timeout"] = timeout
        return Response()

    provider = OpenAICompatibleEmbeddingProvider(
        endpoint="https://gms.example/v1/embeddings",
        api_key="test-secret",
        model_version="text-embedding-3-small",
        dimension=2,
        timeout_seconds=4.0,
        batch_size=2,
        opener=opener,
    )

    assert provider.embed_many(["first", "second"]) == [(1.0, 0.0), (0.0, 1.0)]
    assert captured["body"] == {
        "input": ["first", "second"],
        "model": "text-embedding-3-small",
        "dimensions": 2,
    }
    assert captured["authorization"] == "Bearer test-secret"
    assert captured["timeout"] == 4.0


def test_openai_compatible_embedding_provider_does_not_expose_provider_body_on_invalid_response() -> None:
    class Response:
        def read(self) -> bytes:
            return b'{"data":[{"index":0,"embedding":[1.0]}]}'

    provider = OpenAICompatibleEmbeddingProvider(
        endpoint="https://gms.example/v1/embeddings",
        api_key="test-secret",
        model_version="test-model",
        dimension=2,
        opener=lambda request, timeout: Response(),
    )

    with pytest.raises(EmbeddingProviderError, match="invalid vector") as error:
        provider.embed("secret source text")
    assert "secret source text" not in str(error.value)


def test_embedding_batch_writes_metadata_and_promotes_complete_version() -> None:
    store = InMemoryVersionedIndexStore()
    runner = EmbeddingBatchRunner(
        embedder=HashingTextEmbedder(dimension=8),
        store=store,
        config=EmbeddingBatchConfig(index_version="d4l-index-2026-09-v1"),
    )

    report = runner.run(D4L_FIXTURE)
    record = store.get("d4l-index-2026-09-v1", "9780000000001")

    assert report["status"] == "PROMOTED"
    assert report["promoted"] is True
    assert report["rows"] == 4
    assert report["succeededRows"] == 4
    assert report["failedRows"] == 0
    assert report["activeVersionBefore"] is None
    assert report["activeVersionAfter"] == "d4l-index-2026-09-v1"
    assert store.active_version == "d4l-index-2026-09-v1"
    assert record is not None
    assert len(record.vector) == 8
    assert record.payload["isbn13"] == "9780000000001"
    assert record.payload["co_loan"] == ["9780000000002"]
    assert record.payload["mania_rec"] == ["9780000000003"]
    assert record.payload["reader_rec"] == ["9780000000004"]
    assert record.payload["loan_history"][-1] == ["2026년 02월", 12, 5]
    assert record.payload["embeddingVersion"] == "hashing-embedding-v1"


def test_embedding_batch_resume_keeps_old_active_version_on_partial_failure() -> None:
    store = InMemoryVersionedIndexStore()
    store.active_version = "old-index-v1"
    failing_runner = EmbeddingBatchRunner(
        embedder=_FailingEmbedder("바람의 지도"),
        store=store,
        config=EmbeddingBatchConfig(index_version="new-index-v1", max_retries=1),
    )

    first = failing_runner.run(D4L_FIXTURE)
    resumed = EmbeddingBatchRunner(
        embedder=HashingTextEmbedder(model_version="failing-embedder-v1", dimension=8),
        store=store,
        config=EmbeddingBatchConfig(index_version="new-index-v1", max_retries=0),
    ).run(D4L_FIXTURE)

    assert first["status"] == "PARTIAL_FAILURE"
    assert first["failedRows"] == 1
    assert first["retriedRows"] == 0
    assert first["retryAttempts"] == 1
    assert first["activeVersionAfter"] == "old-index-v1"
    assert store.active_version == "new-index-v1"
    assert resumed["status"] == "PROMOTED"
    assert resumed["skippedRows"] == 3
    assert resumed["succeededRows"] == 1


def test_qdrant_store_writes_versioned_points_and_promotes_alias() -> None:
    calls: list[tuple[str, str, dict | None]] = []

    class Response:
        def read(self) -> bytes:
            return b"{}"

    def opener(request, timeout):
        calls.append((request.method, request.full_url, json.loads(request.data) if request.data else None))
        return Response()

    store = QdrantVersionedIndexStore(
        base_url="http://qdrant:6333",
        collection_prefix="books",
        dimension=2,
        active_alias="books_active",
        opener=opener,
    )
    store.begin("d4l-index-v1", {"inputHash": "hash"})
    store.upsert(
        "d4l-index-v1",
        VectorRecord("9780000000001", (1.0, 0.0), {"bookname": "A"}, index_version="d4l-index-v1"),
    )
    store.promote("d4l-index-v1")

    assert calls[0][0] == "PUT"
    assert "/collections/books_" in calls[0][1]
    assert calls[1][0] == "PUT"
    assert calls[1][2]["points"][0]["payload"] == {
        "bookname": "A",
        "indexVersion": "d4l-index-v1",
        "active": True,
    }
    assert calls[2] == ("POST", "http://qdrant:6333/collections/aliases", {
        "actions": [
            {"delete_alias": {"alias_name": "books_active"}},
            {"create_alias": {"collection_name": calls[0][1].split("/collections/")[1], "alias_name": "books_active"}},
        ]
    })
    assert store.count("d4l-index-v1") == 1
    assert store.active_version == "d4l-index-v1"


class _FailingEmbedder:
    model_version = "failing-embedder-v1"
    dimension = 8

    def __init__(self, title: str) -> None:
        self.title = title
        self._base = HashingTextEmbedder(model_version=self.model_version, dimension=self.dimension)

    def embed(self, text: str) -> tuple[float, ...]:
        if self.title in text:
            raise RuntimeError("temporary provider failure")
        return self._base.embed(text)
