from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any, Iterable

from recommendation.vector_search import CandidateHit


@dataclass(frozen=True, slots=True)
class DemandWeights:
    """Weights for cold-start demand signals."""

    trending: float = 0.6
    steady: float = 0.4

    def __post_init__(self) -> None:
        for name, value in (("trending", self.trending), ("steady", self.steady)):
            numeric = float(value)
            if not math.isfinite(numeric) or numeric < 0:
                raise ValueError(f"{name} weight must be a finite non-negative number")
        if self.trending + self.steady <= 0:
            raise ValueError("at least one demand weight must be greater than zero")


@dataclass(frozen=True, slots=True)
class DemandFeatureScores:
    trending: float | None
    steady: float | None

    def as_dict(self) -> dict[str, float | None]:
        return {"trending": self.trending, "steady": self.steady}


@dataclass(frozen=True, slots=True)
class DemandRankingResult:
    items: tuple[CandidateHit, ...]
    fallback: bool
    reason: str


def _score(value: float) -> float:
    return round(min(100.0, max(0.0, value)), 4)


def _latest_loan(payload: dict[str, Any]) -> int | None:
    history = payload.get("loan_history", payload.get("loanHistory"))
    if not isinstance(history, (list, tuple)):
        return None
    values = [
        item[1]
        for item in history
        if isinstance(item, (list, tuple))
        and len(item) >= 2
        and isinstance(item[1], int)
        and not isinstance(item[1], bool)
        and item[1] >= 0
    ]
    return max(values, default=0)


def _numeric_loan_total(payload: dict[str, Any]) -> int | float | None:
    value = payload.get("loan_total", payload.get("loanTotal"))
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value)) and value >= 0:
        return value
    return None


class ColdStartDemandRanker:
    """Rank indexed books using only D4L demand signals; no seed or query vector is needed."""

    def __init__(self, weights: DemandWeights | None = None) -> None:
        self.weights = weights or DemandWeights()

    def rank(
        self,
        candidates: Iterable[CandidateHit],
        *,
        limit: int = 5,
        exclude_isbns: Iterable[str] = (),
        seed_isbns: Iterable[str] = (),
    ) -> DemandRankingResult:
        if limit < 1 or limit > 30:
            raise ValueError("limit must be between 1 and 30")
        excluded = {isbn.strip() for isbn in (*exclude_isbns, *seed_isbns) if isinstance(isbn, str) and isbn.strip()}
        unique: dict[str, CandidateHit] = {}
        for candidate in candidates:
            if candidate.isbn13 and candidate.isbn13 not in excluded and candidate.isbn13 not in unique:
                unique[candidate.isbn13] = candidate
        eligible = tuple(unique.values())
        latest_values = {item.isbn13: _latest_loan(item.payload) for item in eligible}
        total_values = {item.isbn13: _numeric_loan_total(item.payload) for item in eligible}
        max_latest = max((value for value in latest_values.values() if value is not None), default=0)
        max_total = max((value for value in total_values.values() if value is not None), default=0)
        ranked: list[tuple[float, CandidateHit, DemandFeatureScores]] = []
        for candidate in eligible:
            latest = latest_values[candidate.isbn13]
            total = total_values[candidate.isbn13]
            trending = _score(latest / max_latest * 100) if latest is not None and max_latest else None
            steady = _score(float(total) / max_total * 100) if total is not None and max_total else None
            available: list[tuple[float, float]] = []
            if trending is not None and self.weights.trending > 0:
                available.append((trending, self.weights.trending))
            if steady is not None and self.weights.steady > 0:
                available.append((steady, self.weights.steady))
            available_total = sum(weight for _value, weight in available)
            final_score = sum(value * weight for value, weight in available) / available_total if available_total else 0.0
            ranked.append((round(final_score, 4), candidate, DemandFeatureScores(trending, steady)))
        ranked.sort(key=lambda item: (-item[0], item[1].isbn13))
        result: list[CandidateHit] = []
        for final_score, candidate, features in ranked[:limit]:
            payload = dict(candidate.payload)
            payload["demandScores"] = features.as_dict()
            payload["demandScore"] = final_score
            result.append(CandidateHit(candidate.isbn13, round(final_score / 100, 8), payload))
        return DemandRankingResult(tuple(result), fallback=True, reason="COLD_START_DEMAND")


__all__ = ["ColdStartDemandRanker", "DemandFeatureScores", "DemandRankingResult", "DemandWeights"]
