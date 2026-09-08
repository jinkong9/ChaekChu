from __future__ import annotations

import math

import pytest

from recommendation.demand import ColdStartDemandRanker, DemandWeights
from recommendation.vector_search import CandidateHit


def _candidate(isbn: str, *, total: int | None = None, latest: int | None = None) -> CandidateHit:
    payload = {}
    if total is not None:
        payload["loan_total"] = total
    if latest is not None:
        payload["loan_history"] = [["2026년 02월", latest, latest * 2]]
    return CandidateHit(isbn, 0.0, payload)


def test_cold_start_ranks_without_seed_using_trending_and_steady() -> None:
    result = ColdStartDemandRanker().rank(
        [
            _candidate("9780000000001", total=100, latest=10),
            _candidate("9780000000002", total=50, latest=30),
        ]
    )

    assert result.fallback is True
    assert result.reason == "COLD_START_DEMAND"
    assert [item.isbn13 for item in result.items] == ["9780000000002", "9780000000001"]
    assert result.items[0].score == 0.8
    assert result.items[0].payload["demandScores"] == {"trending": 100.0, "steady": 50.0}


def test_weight_changes_demand_order_and_exclusions_are_hard() -> None:
    candidates = [
        _candidate("9780000000001", total=100, latest=10),
        _candidate("9780000000002", total=50, latest=30),
    ]

    steady = ColdStartDemandRanker(DemandWeights(trending=0, steady=1)).rank(candidates, exclude_isbns=["9780000000002"])
    trending = ColdStartDemandRanker(DemandWeights(trending=1, steady=0)).rank(candidates, seed_isbns=["9780000000001"])

    assert [item.isbn13 for item in steady.items] == ["9780000000001"]
    assert [item.isbn13 for item in trending.items] == ["9780000000002"]


def test_missing_demand_features_are_not_treated_as_evidence() -> None:
    result = ColdStartDemandRanker().rank(
        [
            _candidate("9780000000001"),
            _candidate("9780000000002", total=10),
        ]
    )

    assert result.items[0].isbn13 == "9780000000002"
    assert result.items[0].payload["demandScores"] == {"trending": None, "steady": 100.0}
    assert result.items[1].score == 0.0


def test_invalid_weight_and_limit_are_rejected() -> None:
    with pytest.raises(ValueError, match="finite non-negative"):
        DemandWeights(trending=math.nan)
    with pytest.raises(ValueError, match="at least one"):
        DemandWeights(trending=0, steady=0)
    with pytest.raises(ValueError, match="between 1 and 30"):
        ColdStartDemandRanker().rank([], limit=31)

