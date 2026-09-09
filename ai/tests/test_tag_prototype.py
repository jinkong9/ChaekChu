from __future__ import annotations

import json

from recommendation.embedding import HashingTextEmbedder
from recommendation.tag_batch import TAXONOMY, TAXONOMY_VERSION
from recommendation.tag_prototype import (
    InMemoryTagPrototypeIndexStore,
    QdrantTagPrototypeIndexStore,
    TagPrototypeBatchConfig,
    TagPrototypeBatchRunner,
)
from recommendation.vector_search import VectorRecord


def test_tag_prototype_batch_indexes_every_taxonomy_code_and_promotes() -> None:
    store = InMemoryTagPrototypeIndexStore()
    report = TagPrototypeBatchRunner(
        embedder=HashingTextEmbedder(dimension=8),
        store=store,
        config=TagPrototypeBatchConfig(index_version="index-v1", tag_version="tags-v1", batch_size=4),
    ).run()

    assert report["status"] == "PROMOTED"
    assert report["rows"] == len(TAXONOMY)
    assert report["succeededRows"] == len(TAXONOMY)
    assert report["failedRows"] == 0
    assert report["stagedRows"] == len(TAXONOMY)
    assert store.active_version == "index-v1"
    record = store.get("index-v1", "FANTASY")
    assert record is not None
    assert record.payload == {
        "tagCode": "FANTASY",
        "tagLabel": "판타지",
        "taxonomyVersion": TAXONOMY_VERSION,
        "tagVersion": "tags-v1",
        "embeddingVersion": "hashing-embedding-v1",
        "featureVersion": "tag-prototype-v1",
    }


def test_tag_prototype_point_is_readable_by_qdrant_query_store() -> None:
    calls: list[tuple[str, str, dict | None]] = []

    class Response:
        def __init__(self, body: dict) -> None:
            self.body = body

        def read(self) -> bytes:
            return json.dumps(self.body).encode("utf-8")

    def opener(request, timeout):
        body = json.loads(request.data) if request.data else None
        calls.append((request.method, request.full_url, body))
        return Response({})

    store = QdrantTagPrototypeIndexStore(
        base_url="http://qdrant:6333",
        dimension=2,
        active_alias="tags_active",
        opener=opener,
    )
    store.begin("index-v1", {"tagVersion": "tags-v1"})
    store.upsert_many(
        "index-v1",
        [VectorRecord("FANTASY", (1.0, 0.0), {"tagCode": "FANTASY"}, index_version="index-v1")],
    )
    store.promote("index-v1")

    assert calls[1][0] == "PUT"
    point_url = calls[1][1]
    assert point_url.endswith("/points?wait=true")
    assert calls[1][2]["points"][0]["payload"] == {
        "tagCode": "FANTASY",
        "indexVersion": "index-v1",
        "active": True,
    }
    assert store._point_id("index-v1", "FANTASY") in json.dumps(calls[1][2])
    assert calls[2][0] == "POST"
