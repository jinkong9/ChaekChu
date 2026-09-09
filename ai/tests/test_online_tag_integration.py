from __future__ import annotations

import json

from recommendation.api import IndexedRecommendationEngine, RecommendationRequest
from recommendation.query_vector import QueryVectorBuilder
from recommendation.tag_prototype import QdrantTagPrototypeIndexStore
from recommendation.vector_search import (
    CandidateHit,
    CandidateSearchResponse,
    QdrantQueryVectorStore,
    SearchStatus,
)


class _Response:
    def __init__(self, body: dict) -> None:
        self.body = body

    def read(self) -> bytes:
        return json.dumps(self.body).encode("utf-8")


def test_qdrant_tag_prototype_id_matches_online_query_reader() -> None:
    calls: list[tuple[str, str]] = []

    def opener(request, timeout):
        calls.append((request.method, request.full_url))
        return _Response({"result": {"vector": [0.8, 0.2]}})

    reader = QdrantQueryVectorStore(
        base_url="http://qdrant:6333",
        index_version="index-v1",
        tag_collection="tags_active",
        opener=opener,
    )
    result = reader.get_tag_vector("FANTASY", "index-v1")

    expected_point_id = QdrantTagPrototypeIndexStore._point_id("index-v1", "FANTASY")
    assert result == (0.8, 0.2)
    assert expected_point_id in calls[0][1]
    assert "tags_active" in calls[0][1]


def test_tag_only_query_uses_qdrant_prototype_without_embedding_provider() -> None:
    calls: list[str] = []

    def opener(request, timeout):
        calls.append(request.method)
        return _Response({"result": {"vector": [1.0, 0.0]}})

    builder = QueryVectorBuilder(
        QdrantQueryVectorStore(
            base_url="http://qdrant:6333",
            index_version="index-v1",
            tag_collection="tags_active",
            opener=opener,
        ),
        index_version="index-v1",
    )

    result = builder.build(tags={"FANTASY": 1}, weights={"semantic": 0, "tagMatch": 1})

    assert result.query_vector == (1.0, 0.0)
    assert result.used_tag_codes == ("FANTASY",)
    assert result.missing_tag_codes == ()
    assert calls == ["GET"]


def test_online_engine_uses_candidate_payload_tags_for_match_and_reason() -> None:
    def opener(request, timeout):
        return _Response({"result": {"vector": [1.0, 0.0]}})

    version = "index-v1"

    class Search:
        def search(self, request):
            return CandidateSearchResponse(
                status=SearchStatus.OK,
                index_version=version,
                requested_limit=request.limit,
                returned_count=2,
                items=(
                    CandidateHit("9780000000001", 0.9, {"tagCodes": ["FANTASY"]}),
                    CandidateHit("9780000000002", 0.8, {"tagCodes": ["HISTORY"]}),
                ),
            )

    engine = IndexedRecommendationEngine(
        query_builder=QueryVectorBuilder(
            QdrantQueryVectorStore(
                base_url="http://qdrant:6333",
                index_version=version,
                tag_collection="tags_active",
                opener=opener,
            ),
            index_version=version,
        ),
        search_service=Search(),
    )

    result = engine.recommend(
        RecommendationRequest(
            requestId="request-tag-only",
            userId="user-tag-only",
            mode="PERSONALIZED",
            size=1,
            tags=[{"code": "FANTASY", "weight": 1}],
            weights={"semantic": 0, "tagMatch": 1},
        )
    )

    assert result.fallback is False
    assert [item.isbn13 for item in result.items] == ["9780000000001"]
    assert result.items[0].matchedTags == ["FANTASY"]
    assert result.items[0].primaryReason.type == "TAG_MATCH"
