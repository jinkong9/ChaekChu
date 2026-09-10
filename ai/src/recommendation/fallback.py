from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Iterable

from recommendation.demand import ColdStartDemandRanker
from recommendation.vector_search import CandidateHit, CandidateSearchResponse, SearchStatus


class FallbackStrategy(str, Enum):
    HYBRID = "HYBRID"
    DEMAND = "DEMAND"
    EMPTY = "EMPTY"


class FallbackReason(str, Enum):
    CANDIDATE_SHORTAGE = "CANDIDATE_SHORTAGE"
    INDEX_NOT_FOUND = "INDEX_NOT_FOUND"
    TIMEOUT = "TIMEOUT"
    NO_DEMAND_CANDIDATES = "NO_DEMAND_CANDIDATES"


@dataclass(frozen=True, slots=True)
class FallbackResult:
    """The degraded-search outcome that the API layer can serialize and log."""

    status: SearchStatus
    strategy: FallbackStrategy
    fallback: bool
    requested_size: int
    returned_count: int
    items: tuple[CandidateHit, ...]
    model_version: str
    index_version: str | None
    reason: FallbackReason | None
    can_persist: bool


def _filtered_candidates(
    candidates: Iterable[CandidateHit],
    *,
    exclude_isbns: frozenset[str],
    seed_isbns: frozenset[str],
    limit: int,
) -> tuple[CandidateHit, ...]:
    excluded = exclude_isbns | seed_isbns
    unique: dict[str, CandidateHit] = {}
    for candidate in candidates:
        if not candidate.isbn13 or candidate.isbn13 in excluded or candidate.isbn13 in unique:
            continue
        unique[candidate.isbn13] = candidate
    ranked = sorted(unique.values(), key=lambda item: (-item.score, item.isbn13))
    return tuple(ranked[:limit])


class RecommendationFallbackPolicy:
    """Convert vector-search failures into explicit, safe recommendation outcomes."""

    def __init__(self, *, model_version: str = "d4l-hybrid-v1") -> None:
        if not model_version.strip():
            raise ValueError("model_version must not be empty")
        self.model_version = model_version
        self.demand_ranker = ColdStartDemandRanker()

    def resolve(
        self,
        search: CandidateSearchResponse,
        *,
        demand_candidates: Iterable[CandidateHit] = (),
        exclude_isbns: Iterable[str] = (),
        seed_isbns: Iterable[str] = (),
        requested_size: int | None = None,
    ) -> FallbackResult:
        size = search.requested_limit if requested_size is None else requested_size
        if size < 1 or size > 300:
            raise ValueError("requested_size must be between 1 and 300")
        excluded = frozenset(exclude_isbns)
        seeds = frozenset(seed_isbns)
        # Keep the full retrieved pool until hybrid ranking. Truncating here
        # to the API response size can discard a lower-semantic-score tag
        # candidate before tagMatch has a chance to affect its final rank.
        search_items = _filtered_candidates(
            search.items,
            exclude_isbns=excluded,
            seed_isbns=seeds,
            limit=max(size, search.requested_limit),
        )

        if search.status is SearchStatus.OK and len(search_items) >= size:
            return FallbackResult(
                status=SearchStatus.OK,
                strategy=FallbackStrategy.HYBRID,
                fallback=False,
                requested_size=size,
                returned_count=len(search_items),
                items=search_items,
                model_version=self.model_version,
                index_version=search.index_version,
                reason=None,
                can_persist=True,
            )

        if search.status is SearchStatus.CANDIDATE_SHORTAGE or search.status is SearchStatus.OK:
            return FallbackResult(
                status=SearchStatus.CANDIDATE_SHORTAGE,
                strategy=FallbackStrategy.HYBRID,
                fallback=True,
                requested_size=size,
                returned_count=len(search_items),
                items=search_items,
                model_version=self.model_version,
                index_version=search.index_version,
                reason=FallbackReason.CANDIDATE_SHORTAGE,
                can_persist=False,
            )

        demand_items = self.demand_ranker.rank(
            demand_candidates,
            limit=min(size, 30),
            exclude_isbns=excluded,
            seed_isbns=seeds,
        ).items
        if demand_items:
            return FallbackResult(
                status=search.status,
                strategy=FallbackStrategy.DEMAND,
                fallback=True,
                requested_size=size,
                returned_count=len(demand_items),
                items=demand_items,
                model_version=self.model_version,
                index_version=search.index_version,
                reason=FallbackReason(search.status.value),
                can_persist=True,
            )

        return FallbackResult(
            status=search.status,
            strategy=FallbackStrategy.EMPTY,
            fallback=True,
            requested_size=size,
            returned_count=0,
            items=(),
            model_version=self.model_version,
            index_version=search.index_version,
            reason=FallbackReason.NO_DEMAND_CANDIDATES,
            can_persist=False,
        )


__all__ = ["FallbackReason", "FallbackResult", "FallbackStrategy", "RecommendationFallbackPolicy"]
