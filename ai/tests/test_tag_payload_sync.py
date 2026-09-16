from __future__ import annotations

import json
from pathlib import Path

import pytest

from recommendation.embedding_batch import InMemoryVersionedIndexStore, QdrantVersionedIndexStore
from recommendation.tag_batch import RuleBasedTagger, TagBatchRunner, TagGenerator
from recommendation.tag_index import load_validated_tag_sidecar
from recommendation.normalization import normalized_input_hash
from recommendation.tag_payload_sync import TagPayloadSyncRunner
from recommendation.vector_search import VectorRecord


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "d4l_usage.contract.sample.jsonl"


def _sidecar(tmp_path: Path, tag_version: str):
    path = tmp_path / "tags.jsonl"
    TagBatchRunner(generator=TagGenerator(rule_tagger=RuleBasedTagger()), tag_version=tag_version).run(FIXTURE, path)
    return load_validated_tag_sidecar(path, expected_input_hash=normalized_input_hash(FIXTURE), expected_tag_version=tag_version)


def test_payload_sync_updates_only_tag_fields_of_indexed_points(tmp_path: Path) -> None:
    store = InMemoryVersionedIndexStore()
    store.begin("index-v1", {})
    store.upsert(
        "index-v1",
        VectorRecord("9780000000001", (1.0, 0.0), {"isbn13": "9780000000001", "bookname": "A", "tagCodes": [], "tagVersion": "old"}),
    )
    sidecar = _sidecar(tmp_path, "tags-v2")

    report = TagPayloadSyncRunner(store=store, index_version="index-v1", batch_size=2).run(sidecar)
    record = store.get("index-v1", "9780000000001")

    assert report["status"] == "SUCCESS"
    assert report["rows"] == 4            # sidecar 는 4권
    assert report["updatedRows"] == 1     # 색인에는 1권만 있다 — 나머지는 건너뛴다
    assert report["skippedRows"] == 3
    assert report["tagVersion"] == "tags-v2"
    assert record is not None
    assert record.payload["bookname"] == "A"            # 다른 필드는 그대로
    assert record.payload["tagCodes"] == ["FIC"]
    assert record.payload["tagVersion"] == "tags-v2"
    assert record.vector == (1.0, 0.0)                  # 벡터는 건드리지 않는다


def test_qdrant_store_sends_one_batch_of_set_payload_operations() -> None:
    calls: list[tuple[str, str, dict]] = []

    class Response:
        def read(self) -> bytes:
            return b'{"result":[],"status":"ok"}'

    def opener(request, timeout):
        calls.append((request.method, request.full_url, json.loads(request.data)))
        return Response()

    store = QdrantVersionedIndexStore(base_url="http://qdrant:6333", collection_prefix="books", dimension=2, opener=opener)

    sent = store.update_payloads("index-v1", {"9780000000001": {"tagCodes": ["FIC"], "tagVersion": "tags-v2"}})

    assert sent == 1
    method, url, body = calls[0]
    assert method == "POST"
    assert url.endswith("/points/batch?wait=true") and "/collections/books_" in url
    assert body["operations"] == [
        {
            "set_payload": {
                "payload": {"tagCodes": ["FIC"], "tagVersion": "tags-v2"},
                "points": [QdrantVersionedIndexStore._point_id("index-v1", "9780000000001")],
            }
        }
    ]


def test_payload_sync_rejects_invalid_configuration() -> None:
    with pytest.raises(ValueError):
        TagPayloadSyncRunner(store=InMemoryVersionedIndexStore(), index_version=" ")
    with pytest.raises(ValueError):
        TagPayloadSyncRunner(store=InMemoryVersionedIndexStore(), index_version="v", batch_size=0)
