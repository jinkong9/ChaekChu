from __future__ import annotations

import json

import pytest

from recommendation.vector_search import (
    CandidateSearchRequest,
    CandidateSearchService,
    InMemoryVectorIndex,
    QdrantQueryVectorStore,
    QdrantVectorIndex,
    SearchStatus,
    VectorRecord,
)


def _request(**kwargs) -> CandidateSearchRequest:
    return CandidateSearchRequest(query_vector=(1.0, 0.0), **kwargs)


def test_in_memory_search_is_deterministic_and_hard_filters_seed_and_excluded() -> None:
    index = InMemoryVectorIndex(
        [
            VectorRecord("9780000000003", (0.9, 0.1), {"bookname": "C"}),
            VectorRecord("9780000000001", (1.0, 0.0), {"bookname": "A"}),
            VectorRecord("9780000000002", (1.0, 0.0), {"bookname": "B"}),
            VectorRecord("9780000000004", (0.0, 1.0), {"bookname": "inactive"}, active=False),
        ],
        index_version="d4l-index-v1",
    )
    service = CandidateSearchService(index)
    request = _request(limit=1, exclude_isbns={"9780000000001"}, seed_isbns={"9780000000002"})

    first = service.search(request)
    second = service.search(request)

    assert first == second
    assert first.status is SearchStatus.OK
    assert [item.isbn13 for item in first.items] == ["9780000000003"]
    assert first.returned_count == 1
    assert first.index_version == "d4l-index-v1"


def test_in_memory_search_reports_candidate_shortage() -> None:
    service = CandidateSearchService(
        InMemoryVectorIndex(
            [VectorRecord("9780000000001", (1.0, 0.0))],
            index_version="v1",
        )
    )

    response = service.search(_request(limit=2))

    assert response.status is SearchStatus.CANDIDATE_SHORTAGE
    assert response.returned_count == 1


def test_in_memory_search_uses_isbn_as_tie_breaker() -> None:
    service = CandidateSearchService(
        InMemoryVectorIndex(
            [
                VectorRecord("9780000000002", (1.0, 0.0)),
                VectorRecord("9780000000001", (1.0, 0.0)),
            ],
            index_version="v1",
        )
    )

    response = service.search(_request(limit=2))

    assert response.status is SearchStatus.OK
    assert [item.isbn13 for item in response.items] == ["9780000000001", "9780000000002"]


def test_search_distinguishes_missing_active_index_and_timeout() -> None:
    missing = CandidateSearchService(InMemoryVectorIndex([], index_version="v1", active=False))
    timeout = CandidateSearchService(
        _FailingAdapter()
    )

    assert missing.search(_request()).status is SearchStatus.INDEX_NOT_FOUND
    assert timeout.search(_request()).status is SearchStatus.TIMEOUT


class _FailingAdapter:
    index_version = "v1"

    def search(self, request: CandidateSearchRequest):
        raise TimeoutError("timed out")


def test_candidate_search_request_validates_vector_and_limit() -> None:
    with pytest.raises(ValueError, match="finite"):
        CandidateSearchRequest(query_vector=(float("nan"),))
    with pytest.raises(ValueError, match="between 1 and 300"):
        CandidateSearchRequest(query_vector=(1.0,), limit=301)


def test_qdrant_adapter_sends_active_index_and_hard_exclusion_filter() -> None:
    captured: dict[str, object] = {}

    class Response:
        def read(self) -> bytes:
            return json.dumps(
                {
                    "result": [
                        {"score": 0.8, "payload": {"isbn13": "9780000000003", "active": True}},
                        {"score": 0.9, "payload": {"isbn13": "9780000000002", "active": True}},
                        {"score": 1.0, "payload": {"isbn13": "9780000000001", "active": True}},
                    ]
                }
            ).encode("utf-8")

    def opener(request, timeout):
        captured["url"] = request.full_url
        captured["body"] = json.loads(request.data.decode("utf-8"))
        captured["timeout"] = timeout
        return Response()

    adapter = QdrantVectorIndex(
        base_url="http://qdrant:6333",
        collection="books",
        index_version="d4l-index-v1",
        timeout_seconds=1.5,
        opener=opener,
    )
    response = CandidateSearchService(adapter).search(
        _request(limit=2, exclude_isbns={"9780000000001"}, seed_isbns={"9780000000002"})
    )

    body = captured["body"]
    assert captured["url"] == "http://qdrant:6333/collections/books/points/search"
    assert captured["timeout"] == 1.5
    assert body["filter"]["must"] == [
        {"key": "indexVersion", "match": {"value": "d4l-index-v1"}},
        {"key": "active", "match": {"value": True}},
    ]
    assert body["filter"]["must_not"] == [{
        "key": "isbn13",
        "match": {"any": ["9780000000001", "9780000000002"]},
    }]
    assert response.status is SearchStatus.CANDIDATE_SHORTAGE
    assert response.returned_count == 1
    assert [item.isbn13 for item in response.items] == ["9780000000003"]


def test_qdrant_query_vector_store_reads_book_and_named_tag_vectors() -> None:
    captured: list[str] = []

    class Response:
        def __init__(self, body: dict):
            self.body = body

        def read(self) -> bytes:
            return json.dumps(self.body).encode("utf-8")

    def opener(request, timeout):
        captured.append(request.full_url)
        assert timeout == 1.5
        if "tag" in request.full_url:
            return Response({"result": {"vector": {"content": [0.0, 1.0]}}})
        return Response({"result": {"vector": [1.0, 0.0]}})

    store = QdrantQueryVectorStore(
        base_url="http://qdrant:6333",
        index_version="d4l-index-v1",
        book_collection="books_active",
        tag_collection="tags_active",
        vector_name="content",
        timeout_seconds=1.5,
        opener=opener,
    )

    assert store.get_book_vector("9780000000001", "d4l-index-v1") == (1.0, 0.0)
    assert store.get_tag_vector("FANTASY", "d4l-index-v1") == (0.0, 1.0)
    assert len(captured) == 2
    assert all("with_vector=true" in endpoint for endpoint in captured)


def test_qdrant_query_vector_store_returns_none_for_missing_point() -> None:
    from urllib.error import HTTPError

    def opener(request, timeout):
        raise HTTPError(request.full_url, 404, "not found", {}, None)

    store = QdrantQueryVectorStore(
        base_url="http://qdrant:6333",
        index_version="d4l-index-v1",
        opener=opener,
    )

    assert store.get_book_vector("9780000000001", "d4l-index-v1") is None
