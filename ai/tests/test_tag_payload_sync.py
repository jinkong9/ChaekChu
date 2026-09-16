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
    with pytest.raises(ValueError):
        TagPayloadSyncRunner(store=InMemoryVersionedIndexStore(), index_version="v", pause_seconds=-1)


def test_payload_sync_with_baseline_sends_only_changed_points(tmp_path: Path) -> None:
    """440k 전부를 다시 쓰면 Qdrant optimizer 가 모든 segment 를 재작성한다(09-16 운영 장애). 바뀐 점만 보낸다."""
    store = InMemoryVersionedIndexStore()
    store.begin("index-v1", {})
    for isbn in ("9780000000001", "9780000000002", "9780000000003", "9780000000004"):
        store.upsert("index-v1", VectorRecord(isbn, (1.0, 0.0), {"isbn13": isbn, "tagCodes": ["FIC"], "tagVersion": "tags-v1"}))
    baseline = _sidecar(tmp_path / "old", "tags-v1")
    current = _sidecar(tmp_path / "new", "tags-v2")
    # 한 권만 태그가 달라졌다고 가정
    changed_isbn = "9780000000002"
    changed = dict(current.records)
    changed[changed_isbn] = type(changed[changed_isbn])(("FIC", "HUMANITIES"), {"FIC": 0.92, "HUMANITIES": 0.88}, {"FIC": 0.92, "HUMANITIES": 0.88})
    current = type(current)(changed, current.input_hash, current.tag_version, current.taxonomy_version, current.file_hash)
    slept: list[float] = []

    report = TagPayloadSyncRunner(
        store=store, index_version="index-v1", batch_size=1, pause_seconds=0.25, baseline=baseline.records, sleep=slept.append,
    ).run(current)

    assert report["changedRows"] == 1 and report["unchangedRows"] == 3
    assert report["updatedRows"] == 1 and report["baselineUsed"] is True
    assert store.get("index-v1", changed_isbn).payload["tagCodes"] == ["FIC", "HUMANITIES"]
    assert store.get("index-v1", changed_isbn).payload["tagVersion"] == "tags-v2"
    assert store.get("index-v1", "9780000000001").payload["tagVersion"] == "tags-v1"   # 안 바뀐 점은 그대로
    assert slept == []                                                                # 배치가 하나면 쉬지 않는다


def test_payload_sync_retries_a_failing_batch_with_backoff_and_pauses_between_batches(tmp_path: Path) -> None:
    class FlakyStore:
        def __init__(self) -> None:
            self.calls = 0

        def update_payloads(self, version, updates):
            self.calls += 1
            if self.calls == 1:
                raise TimeoutError("qdrant busy")
            return len(updates)

    flaky = FlakyStore()
    slept: list[float] = []
    sidecar = _sidecar(tmp_path, "tags-v2")

    report = TagPayloadSyncRunner(store=flaky, index_version="index-v1", batch_size=2, pause_seconds=0.5, max_retries=2, sleep=slept.append).run(sidecar)

    assert report["updatedRows"] == 4 and report["batches"] == 2 and report["retries"] == 1
    assert slept == [1.5, 0.5]        # 실패 뒤 backoff(0.5*1+1), 배치 사이 쉬기 0.5


def test_payload_sync_gives_up_after_max_retries(tmp_path: Path) -> None:
    class DeadStore:
        def update_payloads(self, version, updates):
            raise TimeoutError("qdrant down")

    sidecar = _sidecar(tmp_path, "tags-v2")
    with pytest.raises(TimeoutError):
        TagPayloadSyncRunner(store=DeadStore(), index_version="index-v1", max_retries=1, sleep=lambda _s: None).run(sidecar)
