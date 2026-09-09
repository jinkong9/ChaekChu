from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any, Iterable, Mapping

from recommendation.reranking import CandidateFeatureScores, HybridReranker, HybridWeights
from recommendation.vector_search import CandidateHit


MAX_RECOMMENDATION_SIZE = 10
DEFAULT_RECOMMENDATION_SIZE = 5
AUTHOR_DIVERSITY_PENALTY = 12.0
WORK_DIVERSITY_PENALTY = 15.0
TOKEN_PATTERN = re.compile(r"[0-9A-Za-z가-힣]+")


@dataclass(frozen=True, slots=True)
class RecommendationReason:
    type: str
    text: str
    feature: str


@dataclass(frozen=True, slots=True)
class TopKCandidate:
    isbn13: str
    rank: int
    score: float
    selection_score: float
    feature_scores: CandidateFeatureScores
    matched_tags: tuple[str, ...]
    primary_reason: RecommendationReason | None
    reasons: tuple[RecommendationReason, ...]
    payload: dict[str, Any]


@dataclass(frozen=True, slots=True)
class TopKResult:
    items: tuple[TopKCandidate, ...]
    requested_size: int
    weights: dict[str, float]


def _normalized_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(token.lower() for token in TOKEN_PATTERN.findall(value))


def _work_key(payload: Mapping[str, Any], isbn13: str) -> str:
    explicit = payload.get("workKey", payload.get("work_key"))
    if isinstance(explicit, str) and explicit.strip():
        return f"explicit:{explicit.strip()}"
    title = _normalized_text(payload.get("bookname", payload.get("title")))
    authors = _normalized_text(payload.get("authors"))
    return f"derived:{title}|{authors}" if title or authors else f"isbn:{isbn13}"


def _author_key(payload: Mapping[str, Any], isbn13: str) -> str:
    authors = _normalized_text(payload.get("authors"))
    return f"author:{authors}" if authors else f"isbn:{isbn13}"


def _tag_codes(payload: Mapping[str, Any], requested_tags: Mapping[str, float]) -> tuple[str, ...]:
    raw = payload.get("tagCodes", payload.get("tag_codes"))
    if not isinstance(raw, (list, tuple, set)):
        return ()
    requested = set(requested_tags)
    return tuple(sorted({code.strip() for code in raw if isinstance(code, str) and code.strip() in requested}))


REASON_TEMPLATES = {
    "tagMatch": ("TAG_MATCH", "선택한 태그와 일치하는 책이에요."),
    "semantic": ("SEMANTIC", "관심 도서와 서지·분류 특성이 비슷한 책이에요."),
    "coLoan": ("CO_LOAN", "관심 도서와 함께 대출된 책이에요."),
    "trending": ("TRENDING", "최근 대출 수요가 높은 책이에요."),
    "steady": ("STEADY", "꾸준히 대출된 책이에요."),
}


def _reasons(
    feature_scores: CandidateFeatureScores,
    contributing_features: Iterable[str],
    weights: Mapping[str, float],
    matched_tags: tuple[str, ...],
) -> tuple[RecommendationReason, ...]:
    values = feature_scores.as_dict()
    candidates: list[tuple[float, str, RecommendationReason]] = []
    for feature in contributing_features:
        if feature == "tagMatch" and not matched_tags:
            continue
        template = REASON_TEMPLATES.get(feature)
        value = values.get(feature)
        if template is None or value is None or value <= 0 or weights.get(feature, 0) <= 0:
            continue
        reason_type, text = template
        candidates.append((value * weights[feature], feature, RecommendationReason(reason_type, text, feature)))
    candidates.sort(key=lambda item: (-item[0], item[1]))
    return tuple(item[2] for item in candidates)


class TopKRecommendationRanker:
    """Apply hard filters, hybrid scores, diversity selection, and evidence reasons."""

    def __init__(
        self,
        weights: HybridWeights | Mapping[str, Any] | None = None,
        *,
        author_penalty: float = AUTHOR_DIVERSITY_PENALTY,
        work_penalty: float = WORK_DIVERSITY_PENALTY,
    ) -> None:
        if author_penalty < 0 or work_penalty < 0:
            raise ValueError("diversity penalties must be non-negative")
        self.reranker = HybridReranker(weights)
        self.author_penalty = float(author_penalty)
        self.work_penalty = float(work_penalty)

    def rank(
        self,
        candidates: Iterable[CandidateHit],
        *,
        size: int = DEFAULT_RECOMMENDATION_SIZE,
        seed_isbns: Iterable[str] = (),
        exclude_isbns: Iterable[str] = (),
        requested_tags: Mapping[str, float] | None = None,
    ) -> TopKResult:
        if size < 1 or size > MAX_RECOMMENDATION_SIZE:
            raise ValueError(f"size must be between 1 and {MAX_RECOMMENDATION_SIZE}")
        seed_values = tuple(seed_isbns)
        excluded = {
            isbn.strip()
            for isbn in (*seed_values, *exclude_isbns)
            if isinstance(isbn, str) and isbn.strip()
        }
        unique: dict[str, CandidateHit] = {}
        for candidate in candidates:
            if candidate.isbn13 and candidate.isbn13 not in excluded:
                current = unique.get(candidate.isbn13)
                if current is None or (candidate.score, candidate.isbn13) > (current.score, current.isbn13):
                    unique[candidate.isbn13] = candidate
        requested = requested_tags or {}
        scored = list(
            self.reranker.rerank(
                unique.values(),
                seed_isbns=seed_values,
                requested_tags=requested,
            )
        )
        selected: list[TopKCandidate] = []
        author_counts: dict[str, int] = {}
        work_counts: dict[str, int] = {}
        while scored and len(selected) < size:
            options: list[tuple[float, float, str, Any]] = []
            for item in scored:
                author = _author_key(item.payload, item.isbn13)
                work = _work_key(item.payload, item.isbn13)
                selection_score = item.score
                selection_score -= author_counts.get(author, 0) * self.author_penalty
                selection_score -= work_counts.get(work, 0) * self.work_penalty
                options.append((selection_score, item.score, item.isbn13, item))
            _selection_score, _raw_score, _isbn, item = min(options, key=lambda value: (-value[0], -value[1], value[2]))
            scored.remove(item)
            author = _author_key(item.payload, item.isbn13)
            work = _work_key(item.payload, item.isbn13)
            author_counts[author] = author_counts.get(author, 0) + 1
            work_counts[work] = work_counts.get(work, 0) + 1
            matched_tags = _tag_codes(item.payload, requested)
            reasons = _reasons(item.feature_scores, item.contributing_features, self.reranker.weights.as_dict(), matched_tags)
            selected.append(
                TopKCandidate(
                    isbn13=item.isbn13,
                    rank=len(selected) + 1,
                    score=item.score,
                    selection_score=round(_selection_score, 4),
                    feature_scores=item.feature_scores,
                    matched_tags=matched_tags,
                    primary_reason=reasons[0] if reasons else None,
                    reasons=reasons,
                    payload=item.payload,
                )
            )
        return TopKResult(tuple(selected), size, self.reranker.weights.as_dict())


__all__ = [
    "DEFAULT_RECOMMENDATION_SIZE",
    "MAX_RECOMMENDATION_SIZE",
    "RecommendationReason",
    "TopKCandidate",
    "TopKRecommendationRanker",
    "TopKResult",
]
