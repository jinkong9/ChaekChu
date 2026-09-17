from __future__ import annotations

import asyncio
from contextlib import contextmanager
import math
from time import perf_counter
from typing import Iterator

import httpx

from recommendation.api import IndexedRecommendationEngine, app, configure_recommendation_engine
from recommendation.query_vector import InMemoryQueryVectorStore, QueryVectorBuilder
from recommendation.vector_search import (
    CandidateSearchResponse,
    CandidateSearchService,
    CandidateHit,
    InMemoryVectorIndex,
    QueryVectorStoreTimeoutError,
    SearchStatus,
    VectorRecord,
)


VERSION = "d4l-resilience-v1"
SEED = "9780000001001"
EXCLUDED = "9780000001012"


@contextmanager
def _installed(engine: IndexedRecommendationEngine) -> Iterator[None]:
    previous = getattr(app.state, "recommendation_engine", None)
    configure_recommendation_engine(engine)
    try:
        yield
    finally:
        if previous is None:
            app.state.__dict__.pop("recommendation_engine", None)
        else:
            configure_recommendation_engine(previous)


def _engine(*, search_service=None, demand_candidates=()) -> IndexedRecommendationEngine:
    isbns = [f"978000000{1000 + position:04d}" for position in range(1, 121)]
    vectors = {
        isbn: (1.0, position / 100, 1.0 - position / 100)
        for position, isbn in enumerate(isbns, start=1)
    }
    records = [
        VectorRecord(
            isbn,
            vector,
            {
                "isbn13": isbn,
                "bookname": f"부하 검증 도서 {position}",
                "tagCodes": ["FIC"],
                "loan_total": max(1, 1000 - position),
                "loan_history": [["2026년 02월", max(1, 200 - position), 30]],
            },
            index_version=VERSION,
        )
        for position, (isbn, vector) in enumerate(vectors.items(), start=1)
    ]
    query_store = InMemoryQueryVectorStore(
        index_version=VERSION,
        book_vectors=vectors,
        tag_vectors={"FIC": (1.0, 0.0, 1.0)},
    )
    return IndexedRecommendationEngine(
        query_builder=QueryVectorBuilder(query_store, index_version=VERSION),
        search_service=search_service or CandidateSearchService(InMemoryVectorIndex(records, index_version=VERSION)),
        demand_candidates=tuple(demand_candidates),
        model_version="d4l-resilience-model-v1",
    )


def _payload(request_id: str) -> dict:
    return {
        "requestId": request_id,
        "userId": f"load-user-{request_id}",
        "mode": "PERSONALIZED",
        "size": 5,
        "seedIsbns": [SEED],
        "excludeIsbns": [EXCLUDED],
        "tags": [{"code": "FIC", "weight": 1.0}],
    }


async def _post(payload: dict) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        return await client.post("/internal/v1/recommendations", json=payload)


def test_concurrent_recommendation_requests_keep_contract_and_isolation() -> None:
    async def send_requests() -> tuple[list[httpx.Response], float]:
        started = perf_counter()
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            responses = await asyncio.gather(
                *(client.post("/internal/v1/recommendations", json=_payload(f"req-{position}")) for position in range(32))
            )
        return list(responses), perf_counter() - started

    with _installed(_engine()):
        responses, elapsed = asyncio.run(send_requests())

    assert elapsed > 0
    assert math.isfinite(elapsed)
    assert len(responses) == 32
    assert all(response.status_code == 200 for response in responses)
    for position, response in enumerate(responses):
        body = response.json()
        assert body["requestId"] == f"req-{position}"
        assert body["fallback"] is False
        assert body["indexVersion"] == VERSION
        assert len(body["items"]) == 5
        assert SEED not in {item["isbn13"] for item in body["items"]}
        assert EXCLUDED not in {item["isbn13"] for item in body["items"]}


def test_next_recommendation_can_preserve_preferences_and_exclude_previous_deck() -> None:
    first_payload = {
        "requestId": "reroll-first",
        "userId": "same-user",
        "mode": "PERSONALIZED",
        "size": 5,
        "seedIsbns": [SEED],
        "excludeIsbns": [EXCLUDED],
        "tags": [{"code": "FIC", "weight": 1.0}],
        "weights": {
            "semantic": 0.0,
            "tagMatch": 1.0,
            "coLoan": 0.0,
            "trending": 0.0,
            "steady": 0.0,
        },
    }

    with _installed(_engine()):
        first_response = asyncio.run(_post(first_payload))
        first = first_response.json()
        first_isbns = [item["isbn13"] for item in first["items"]]
        second_response = asyncio.run(
            _post(
                {
                    **first_payload,
                    "requestId": "reroll-second",
                    "excludeIsbns": [EXCLUDED, *first_isbns],
                }
            )
        )

    second = second_response.json()
    second_isbns = {item["isbn13"] for item in second["items"]}

    assert first_response.status_code == second_response.status_code == 200
    assert first["fallback"] is second["fallback"] is False
    assert len(first_isbns) == len(second_isbns) == 5
    assert set(first_isbns).isdisjoint(second_isbns)
    assert SEED not in second_isbns
    assert EXCLUDED not in second_isbns
    assert all(item["matchedTags"] == ["FIC"] for item in second["items"])
    assert all(item["featureScores"]["tagMatch"] > 0 for item in second["items"])


def test_candidate_shortage_never_reintroduces_excluded_books() -> None:
    indexed_isbns = [f"978000000{1000 + position:04d}" for position in range(1, 121)]
    available_isbns = set(indexed_isbns[-3:])
    excluded_isbns = sorted(
        {EXCLUDED, *(isbn for isbn in indexed_isbns if isbn not in available_isbns)}
    )
    payload = {
        "requestId": "reroll-shortage",
        "userId": "same-user",
        "mode": "PERSONALIZED",
        "size": 5,
        "seedIsbns": [SEED],
        "excludeIsbns": excluded_isbns,
        "tags": [{"code": "FIC", "weight": 1.0}],
        "weights": {
            "semantic": 0.0,
            "tagMatch": 1.0,
            "coLoan": 0.0,
            "trending": 0.0,
            "steady": 0.0,
        },
    }

    with _installed(_engine()):
        response = asyncio.run(_post(payload))

    body = response.json()
    result_isbns = {item["isbn13"] for item in body["items"]}

    assert response.status_code == 200
    assert body["fallback"] is True
    assert result_isbns == available_isbns
    assert result_isbns.isdisjoint(payload["excludeIsbns"])
    assert SEED not in result_isbns


class _TimeoutSearch:
    index_version = VERSION

    def search(self, request) -> CandidateSearchResponse:
        return CandidateSearchResponse(
            status=SearchStatus.TIMEOUT,
            index_version=VERSION,
            requested_limit=request.limit,
            returned_count=0,
            reason="injected search timeout",
        )


def test_search_timeout_returns_demand_fallback_over_http() -> None:
    demand = tuple(
        CandidateHit(
            f"97800000020{position:02d}",
            0.0,
            {
                "isbn13": f"97800000020{position:02d}",
                "bookname": f"수요 fallback {position}",
                "loan_total": 100 - position,
                "loan_history": [["2026년 02월", 20 - position, 20]],
            },
        )
        for position in range(1, 7)
    )
    engine = _engine(search_service=_TimeoutSearch(), demand_candidates=demand)

    with _installed(engine):
        response = asyncio.run(_post(_payload("req-timeout")))

    assert response.status_code == 200
    body = response.json()
    assert body["fallback"] is True
    assert body["indexVersion"] == VERSION
    assert len(body["items"]) == 5
    assert SEED not in {item["isbn13"] for item in body["items"]}
    assert EXCLUDED not in {item["isbn13"] for item in body["items"]}


class _QueryTimeoutStore:
    index_version = VERSION

    def get_book_vector(self, _isbn13: str, _index_version: str):
        raise QueryVectorStoreTimeoutError("injected query vector timeout")

    def get_tag_vector(self, _code: str, _index_version: str):
        return None


def test_query_vector_timeout_is_safe_and_recovers_after_engine_replacement() -> None:
    broken = IndexedRecommendationEngine(
        query_builder=QueryVectorBuilder(_QueryTimeoutStore(), index_version=VERSION),
        search_service=CandidateSearchService(InMemoryVectorIndex([], index_version=VERSION)),
        model_version="d4l-resilience-model-v1",
    )

    with _installed(broken):
        failed = asyncio.run(_post(_payload("req-query-timeout")))
        assert failed.status_code == 200
        assert failed.json()["fallback"] is True
        assert failed.json()["items"] == []

        configure_recommendation_engine(_engine())
        recovered = asyncio.run(_post(_payload("req-recovered")))

    assert recovered.status_code == 200
    assert recovered.json()["fallback"] is False
    assert recovered.json()["indexVersion"] == VERSION
    assert len(recovered.json()["items"]) == 5
