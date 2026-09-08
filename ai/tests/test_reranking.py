from __future__ import annotations

import math

import pytest

from recommendation.reranking import HybridReranker, HybridWeights
from recommendation.vector_search import CandidateHit


def _candidate(isbn: str, score: float, **payload) -> CandidateHit:
    return CandidateHit(isbn13=isbn, score=score, payload=payload)


def test_weights_are_validated_and_missing_features_are_renormalized() -> None:
    reranker = HybridReranker({"semantic": 0.5, "steady": 0.5})

    result = reranker.score(_candidate("9780000000001", 0.8), maximum_loan=100)

    assert result.score == 80.0
    assert result.feature_scores.as_dict() == {
        "semantic": 80.0,
        "tagMatch": None,
        "coLoan": None,
        "trending": None,
        "steady": None,
    }
    assert result.contributing_features == ("semantic",)

    with pytest.raises(ValueError, match="unknown ranking weights"):
        HybridWeights.from_mapping({"taste": 1})
    with pytest.raises(ValueError, match="finite non-negative"):
        HybridWeights.from_mapping({"semantic": math.nan})
    with pytest.raises(ValueError, match="at least one"):
        HybridWeights.from_mapping({"semantic": 0, "steady": 0})


def test_all_hybrid_features_are_normalized_to_0_100() -> None:
    candidate = _candidate(
        "9780000000001",
        0.75,
        tagCodes=["FANTASY", "GROWTH"],
        tagScores={"FANTASY": 0.8, "GROWTH": 0.4},
        co_loan=["9780000000099"],
        mania_rec=[["9780000000002", "other"]],
        loan_history=[["2026년 01월", 20, 40], ["2026년 02월", 50, 80]],
        loan_total=100,
    )

    result = HybridReranker().score(
        candidate,
        seed_isbns=["9780000000099", "9780000000002"],
        requested_tags={"FANTASY": 2, "GROWTH": 1},
        maximum_loan=200,
        maximum_latest_loan=100,
    )

    assert result.feature_scores.as_dict() == {
        "semantic": 75.0,
        "tagMatch": 66.6667,
        "coLoan": 100.0,
        "trending": 50.0,
        "steady": 50.0,
    }
    assert 0 <= result.score <= 100
    assert result.contributing_features == ("semantic", "tagMatch", "coLoan", "trending", "steady")


def test_weight_changes_change_rank_and_ties_use_isbn() -> None:
    candidates = (
        _candidate("9780000000002", 0.9, loan_total=10),
        _candidate("9780000000001", 0.7, loan_total=100),
    )

    semantic_first = HybridReranker({"semantic": 1}).rerank(candidates)
    steady_first = HybridReranker({"steady": 1}).rerank(candidates)

    assert [item.isbn13 for item in semantic_first] == ["9780000000002", "9780000000001"]
    assert [item.isbn13 for item in steady_first] == ["9780000000001", "9780000000002"]
    assert [item.isbn13 for item in HybridReranker({"semantic": 1}).rerank(
        [_candidate("9780000000002", 0.5), _candidate("9780000000001", 0.5)]
    )] == ["9780000000001", "9780000000002"]


def test_missing_tag_and_demand_payload_does_not_create_unsupported_evidence() -> None:
    result = HybridReranker({"semantic": 0, "tagMatch": 1}).score(
        _candidate("9780000000001", 0.5),
        requested_tags={"FANTASY": 1},
    )

    assert result.score == 0.0
    assert result.feature_scores.tag_match is None
    assert result.contributing_features == ()
