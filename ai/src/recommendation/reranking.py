from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any, Iterable, Mapping

from recommendation.vector_search import CandidateHit


FEATURE_NAMES = ("semantic", "tagMatch", "coLoan", "trending", "steady")
RELATION_FIELDS = ("co_loan", "mania_rec", "reader_rec")
RELATION_WEIGHTS = {"co_loan": 1.0, "mania_rec": 0.75, "reader_rec": 0.5}
DEFAULT_WEIGHTS = {
    "semantic": 0.45,
    "tagMatch": 0.25,
    "coLoan": 0.15,
    "trending": 0.10,
    "steady": 0.05,
}


def _finite_non_negative(value: float, name: str) -> float:
    value = float(value)
    if not math.isfinite(value) or value < 0:
        raise ValueError(f"{name} must be a finite non-negative number")
    return value


def _score_0_to_100(value: float) -> float:
    return round(min(100.0, max(0.0, float(value))), 4)


def _unit_score(value: Any, *, default: float | None = None) -> float | None:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        return default
    numeric = float(value)
    if numeric > 1.0:
        numeric /= 100.0
    return min(1.0, max(0.0, numeric))


@dataclass(frozen=True, slots=True)
class HybridWeights:
    """Validated request weights for the five hybrid ranking features."""

    semantic: float = DEFAULT_WEIGHTS["semantic"]
    tag_match: float = DEFAULT_WEIGHTS["tagMatch"]
    co_loan: float = DEFAULT_WEIGHTS["coLoan"]
    trending: float = DEFAULT_WEIGHTS["trending"]
    steady: float = DEFAULT_WEIGHTS["steady"]

    def __post_init__(self) -> None:
        values = self.as_dict()
        for name, value in values.items():
            _finite_non_negative(value, name)
        if sum(values.values()) <= 0:
            raise ValueError("at least one ranking weight must be greater than zero")

    @classmethod
    def from_mapping(cls, values: Mapping[str, Any] | None) -> "HybridWeights":
        if values is None:
            return cls()
        unknown = set(values) - set(FEATURE_NAMES)
        if unknown:
            raise ValueError(f"unknown ranking weights: {', '.join(sorted(unknown))}")
        provided_total = sum(_finite_non_negative(value, f"{name} weight") for name, value in values.items())
        if values and provided_total <= 0:
            raise ValueError("at least one ranking weight must be greater than zero")
        return cls(
            semantic=values.get("semantic", DEFAULT_WEIGHTS["semantic"]),
            tag_match=values.get("tagMatch", DEFAULT_WEIGHTS["tagMatch"]),
            co_loan=values.get("coLoan", DEFAULT_WEIGHTS["coLoan"]),
            trending=values.get("trending", DEFAULT_WEIGHTS["trending"]),
            steady=values.get("steady", DEFAULT_WEIGHTS["steady"]),
        )

    def as_dict(self) -> dict[str, float]:
        return {
            "semantic": float(self.semantic),
            "tagMatch": float(self.tag_match),
            "coLoan": float(self.co_loan),
            "trending": float(self.trending),
            "steady": float(self.steady),
        }


@dataclass(frozen=True, slots=True)
class CandidateFeatureScores:
    """Normalized 0~100 scores; None means the source feature is unavailable."""

    semantic: float | None
    tag_match: float | None
    co_loan: float | None
    trending: float | None
    steady: float | None

    def as_dict(self) -> dict[str, float | None]:
        return {
            "semantic": self.semantic,
            "tagMatch": self.tag_match,
            "coLoan": self.co_loan,
            "trending": self.trending,
            "steady": self.steady,
        }


@dataclass(frozen=True, slots=True)
class RankedCandidate:
    isbn13: str
    score: float
    feature_scores: CandidateFeatureScores
    contributing_features: tuple[str, ...]
    payload: dict[str, Any]


def _payload_value(payload: Mapping[str, Any], camel: str, snake: str) -> Any:
    return payload.get(camel, payload.get(snake))


def _latest_loan(payload: Mapping[str, Any]) -> int | None:
    history = _payload_value(payload, "loanHistory", "loan_history")
    if not isinstance(history, list):
        return None
    values = [item[1] for item in history if isinstance(item, (list, tuple)) and len(item) >= 2 and isinstance(item[1], int)]
    return max(values, default=0)


def _relation_match_score(payload: Mapping[str, Any], seed_isbns: set[str]) -> float | None:
    present = False
    best = 0.0
    for field, relation_weight in RELATION_WEIGHTS.items():
        camel_field = {"co_loan": "coLoan", "mania_rec": "maniaRec", "reader_rec": "readerRec"}[field]
        relation = _payload_value(payload, camel_field, field)
        if relation is None:
            continue
        present = True
        if not isinstance(relation, (list, tuple)):
            continue
        for rank, item in enumerate(relation, start=1):
            isbn = item[0] if isinstance(item, (list, tuple)) and item else item
            if isinstance(isbn, str) and isbn.strip() in seed_isbns:
                best = max(best, relation_weight / rank)
    return best * 100 if present else None


def _tag_match_score(payload: Mapping[str, Any], requested_tags: Mapping[str, float]) -> float | None:
    if not requested_tags:
        return None
    raw_codes = _payload_value(payload, "tagCodes", "tag_codes")
    if not isinstance(raw_codes, (list, tuple, set)):
        return None
    candidate_codes = {code.strip() for code in raw_codes if isinstance(code, str) and code.strip()}
    if not candidate_codes:
        return None
    raw_scores = _payload_value(payload, "tagScores", "tag_scores")
    scores = raw_scores if isinstance(raw_scores, Mapping) else {}
    matched_weight = 0.0
    total_weight = sum(requested_tags.values())
    for code, weight in requested_tags.items():
        if code not in candidate_codes:
            continue
        matched_weight += weight * (_unit_score(scores.get(code), default=1.0) or 0.0)
    return _score_0_to_100(matched_weight / total_weight * 100) if total_weight else None


def _features_for(
    candidate: CandidateHit,
    *,
    seed_isbns: set[str],
    requested_tags: Mapping[str, float],
    maximum_loan: int | None,
    maximum_latest_loan: int | None,
) -> CandidateFeatureScores:
    payload = candidate.payload
    latest = _latest_loan(payload)
    loan_total = payload.get("loan_total", payload.get("loanTotal"))
    semantic = _unit_score(candidate.score)
    trending = None
    if latest is not None and maximum_latest_loan is not None and maximum_latest_loan > 0:
        trending = _score_0_to_100(latest / maximum_latest_loan * 100)
    steady = None
    if isinstance(loan_total, (int, float)) and not isinstance(loan_total, bool) and maximum_loan and maximum_loan > 0:
        steady = _score_0_to_100(float(loan_total) / maximum_loan * 100)
    return CandidateFeatureScores(
        semantic=_score_0_to_100((semantic or 0.0) * 100) if semantic is not None else None,
        tag_match=_tag_match_score(payload, requested_tags),
        co_loan=_relation_match_score(payload, seed_isbns),
        trending=trending,
        steady=steady,
    )


class HybridReranker:
    """Calculate reproducible feature scores and weighted hybrid ranking."""

    def __init__(self, weights: HybridWeights | Mapping[str, Any] | None = None) -> None:
        self.weights = weights if isinstance(weights, HybridWeights) else HybridWeights.from_mapping(weights)

    def score(
        self,
        candidate: CandidateHit,
        *,
        seed_isbns: Iterable[str] = (),
        requested_tags: Mapping[str, float] | None = None,
        maximum_loan: int | None = None,
        maximum_latest_loan: int | None = None,
    ) -> RankedCandidate:
        seed_set = {isbn.strip() for isbn in seed_isbns if isinstance(isbn, str) and isbn.strip()}
        tags = {
            str(code).strip(): _finite_non_negative(weight, f"tag weight {code}")
            for code, weight in (requested_tags or {}).items()
            if str(code).strip()
        }
        if tags and sum(tags.values()) <= 0:
            raise ValueError("at least one tag weight must be greater than zero")
        features = _features_for(
            candidate,
            seed_isbns=seed_set,
            requested_tags=tags,
            maximum_loan=maximum_loan,
            maximum_latest_loan=maximum_latest_loan,
        )
        values = features.as_dict()
        weights = self.weights.as_dict()
        available = [(name, value, weights[name]) for name, value in values.items() if value is not None and weights[name] > 0]
        denominator = sum(weight for _name, _value, weight in available)
        final_score = sum(value * weight for _name, value, weight in available) / denominator if denominator else 0.0
        contributing = tuple(name for name, value, weight in available if value > 0 and weight > 0)
        return RankedCandidate(
            isbn13=candidate.isbn13,
            score=round(final_score, 4),
            feature_scores=features,
            contributing_features=contributing,
            payload=dict(candidate.payload),
        )

    def rerank(
        self,
        candidates: Iterable[CandidateHit],
        *,
        seed_isbns: Iterable[str] = (),
        requested_tags: Mapping[str, float] | None = None,
        maximum_loan: int | None = None,
        maximum_latest_loan: int | None = None,
    ) -> tuple[RankedCandidate, ...]:
        items = tuple(candidates)
        seed_set = tuple(seed_isbns)
        if maximum_loan is None:
            totals = [item.payload.get("loan_total", item.payload.get("loanTotal")) for item in items]
            numeric_totals = [value for value in totals if isinstance(value, (int, float)) and not isinstance(value, bool)]
            maximum_loan = max(numeric_totals, default=0)
        if maximum_latest_loan is None:
            latest_values = [_latest_loan(item.payload) for item in items]
            maximum_latest_loan = max((value for value in latest_values if value is not None), default=0)
        scored = [
            self.score(
                item,
                seed_isbns=seed_set,
                requested_tags=requested_tags,
                maximum_loan=maximum_loan,
                maximum_latest_loan=maximum_latest_loan,
            )
            for item in items
        ]
        return tuple(sorted(scored, key=lambda item: (-item.score, item.isbn13)))


__all__ = [
    "CandidateFeatureScores",
    "DEFAULT_WEIGHTS",
    "FEATURE_NAMES",
    "HybridReranker",
    "HybridWeights",
    "RankedCandidate",
]
