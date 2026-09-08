from __future__ import annotations

from recommendation.fallback import FallbackReason, FallbackStrategy, RecommendationFallbackPolicy
from recommendation.vector_search import CandidateHit, CandidateSearchResponse, SearchStatus


def _search(status: SearchStatus, *items: CandidateHit) -> CandidateSearchResponse:
    return CandidateSearchResponse(
        status=status,
        index_version="d4l-index-v1",
        requested_limit=2,
        returned_count=len(items),
        items=items,
    )


def _candidate(isbn: str, score: float) -> CandidateHit:
    return CandidateHit(isbn13=isbn, score=score, payload={})


def test_successful_search_is_not_marked_as_fallback() -> None:
    result = RecommendationFallbackPolicy().resolve(
        _search(SearchStatus.OK, _candidate("9780000000002", 0.8), _candidate("9780000000001", 0.9))
    )

    assert result.strategy is FallbackStrategy.HYBRID
    assert result.fallback is False
    assert result.reason is None
    assert result.can_persist is True
    assert [item.isbn13 for item in result.items] == ["9780000000001", "9780000000002"]


def test_candidate_shortage_returns_available_items_with_explicit_fallback() -> None:
    result = RecommendationFallbackPolicy().resolve(
        _search(SearchStatus.CANDIDATE_SHORTAGE, _candidate("9780000000001", 0.8)),
        demand_candidates=[_candidate("9780000000002", 0.99)],
    )

    assert result.status is SearchStatus.CANDIDATE_SHORTAGE
    assert result.strategy is FallbackStrategy.HYBRID
    assert result.fallback is True
    assert result.reason is FallbackReason.CANDIDATE_SHORTAGE
    assert [item.isbn13 for item in result.items] == ["9780000000001"]
    assert result.can_persist is False


def test_timeout_uses_demand_fallback_and_applies_hard_exclusions() -> None:
    result = RecommendationFallbackPolicy().resolve(
        _search(SearchStatus.TIMEOUT),
        demand_candidates=[
            _candidate("9780000000003", 0.4),
            _candidate("9780000000001", 0.9),
            _candidate("9780000000002", 0.8),
        ],
        exclude_isbns=["9780000000001"],
        seed_isbns=["9780000000002"],
    )

    assert result.strategy is FallbackStrategy.DEMAND
    assert result.reason is FallbackReason.TIMEOUT
    assert result.index_version == "d4l-index-v1"
    assert result.model_version == "d4l-hybrid-v1"
    assert [item.isbn13 for item in result.items] == ["9780000000003"]
    assert result.can_persist is True


def test_missing_index_without_demand_candidates_is_not_persistable() -> None:
    result = RecommendationFallbackPolicy().resolve(_search(SearchStatus.INDEX_NOT_FOUND))

    assert result.strategy is FallbackStrategy.EMPTY
    assert result.fallback is True
    assert result.reason is FallbackReason.NO_DEMAND_CANDIDATES
    assert result.items == ()
    assert result.can_persist is False
