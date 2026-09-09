from __future__ import annotations

import pytest

from recommendation.top_k import TopKRecommendationRanker
from recommendation.vector_search import CandidateHit


def _candidate(isbn: str, score: float, *, author: str = "", title: str = "", **payload) -> CandidateHit:
    return CandidateHit(isbn, score, {"authors": author, "bookname": title, **payload})


def test_default_size_is_five_and_maximum_size_is_ten() -> None:
    candidates = [_candidate(f"9780000000{i:03d}", 0.9 - i / 100) for i in range(12)]

    assert len(TopKRecommendationRanker().rank(candidates).items) == 5
    assert len(TopKRecommendationRanker().rank(candidates, size=10).items) == 10
    with pytest.raises(ValueError, match="between 1 and 10"):
        TopKRecommendationRanker().rank(candidates, size=11)


def test_weights_change_order_and_seed_exclusions_are_applied() -> None:
    candidates = [
        _candidate("9780000000001", 0.95, loan_total=10),
        _candidate("9780000000002", 0.70, loan_total=100),
    ]

    semantic = TopKRecommendationRanker({"semantic": 1}).rank(candidates, size=2, seed_isbns=["9780000000002"])
    steady = TopKRecommendationRanker({"steady": 1}).rank(candidates, size=2)

    assert [item.isbn13 for item in semantic.items] == ["9780000000001"]
    assert [item.isbn13 for item in steady.items] == ["9780000000002", "9780000000001"]


def test_duplicate_isbn_is_removed_and_author_diversity_can_change_selection() -> None:
    candidates = [
        _candidate("9780000000001", 0.95, author="같은 작가", title="첫 책"),
        _candidate("9780000000001", 0.90, author="같은 작가", title="첫 책"),
        _candidate("9780000000002", 0.93, author="같은 작가", title="두 번째 책"),
        _candidate("9780000000003", 0.84, author="다른 작가", title="세 번째 책"),
    ]

    result = TopKRecommendationRanker().rank(candidates, size=3)

    assert [item.isbn13 for item in result.items] == [
        "9780000000001",
        "9780000000003",
        "9780000000002",
    ]
    assert len({item.isbn13 for item in result.items}) == 3


def test_same_work_uses_work_key_and_reasons_only_use_actual_features() -> None:
    candidates = [
        _candidate(
            "9780000000001",
            0.8,
            author="작가 A",
            title="책 A",
            workKey="work-1",
            tagCodes=["FANTASY"],
            tagScores={"FANTASY": 1},
            loan_total=100,
        ),
        _candidate(
            "9780000000002",
            0.79,
            author="작가 B",
            title="책 B",
            workKey="work-1",
            loan_total=80,
        ),
        _candidate("9780000000003", 0.7, author="작가 C", title="책 C", loan_total=70),
    ]

    result = TopKRecommendationRanker(
        {"semantic": 0.5, "tagMatch": 0.5, "coLoan": 0, "trending": 0, "steady": 0}
    ).rank(
        candidates,
        size=3,
        requested_tags={"FANTASY": 1},
    )

    assert [item.isbn13 for item in result.items] == [
        "9780000000001",
        "9780000000003",
        "9780000000002",
    ]
    first = result.items[0]
    assert first.matched_tags == ("FANTASY",)
    assert first.primary_reason is not None
    assert first.primary_reason.type == "TAG_MATCH"
    assert [reason.feature for reason in first.reasons] == ["tagMatch", "semantic"]
    assert result.items[1].primary_reason is not None
    assert all(reason.feature != "tagMatch" for reason in result.items[1].reasons)
