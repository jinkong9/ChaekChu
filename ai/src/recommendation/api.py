from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI
from pydantic import BaseModel, Field, model_validator

from recommendation.baseline import recommend_content, recommend_popular
from recommendation.d4l import D4LBook


FeatureKey = Literal["taste", "coLoan", "trending", "steady", "newField"]
RecommendationMode = Literal["COLD_START", "PERSONALIZED"]
ReasonType = Literal[
    "TEXT_SIMILARITY",
    "SEGMENT_POPULAR",
    "DEMAND_POPULAR",
]


class RecommendationWeights(BaseModel):
    taste: float = Field(default=60, ge=0)
    coLoan: float = Field(default=0, ge=0)
    trending: float = Field(default=15, ge=0)
    steady: float = Field(default=10, ge=0)
    newField: float = Field(default=15, ge=0)


class LibrarySignal(BaseModel):
    bookId: str = Field(min_length=1)
    status: Literal["WISH", "READ"]
    rating: int | None = Field(default=None, ge=1, le=5)


class CandidateBook(BaseModel):
    bookId: str = Field(min_length=1)
    isbn13: str = Field(pattern=r"^97[89]\d{10}$")
    title: str = Field(min_length=1)
    authors: list[str] = Field(default_factory=list)
    publisher: str | None = None
    description: str | None = None
    keywords: list[str] = Field(default_factory=list)
    loan24m: int = Field(default=0, ge=0)
    loan3m: int = Field(default=0, ge=0)
    rankScore: float | None = Field(default=None, ge=0)


class RecommendationRequest(BaseModel):
    requestId: str = Field(min_length=1)
    userId: str = Field(min_length=1)
    mode: RecommendationMode
    size: int = Field(default=10, ge=1, le=30)
    candidateVersion: str = Field(min_length=1)
    interestTags: list[str] = Field(default_factory=list, max_length=5)
    seedBookIds: list[str] = Field(default_factory=list)
    excludeBookIds: list[str] = Field(default_factory=list)
    library: list[LibrarySignal] = Field(default_factory=list)
    weights: RecommendationWeights = Field(default_factory=RecommendationWeights)
    candidates: list[CandidateBook] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_unique_candidates(self) -> "RecommendationRequest":
        book_ids = [book.bookId for book in self.candidates]
        isbn13s = [book.isbn13 for book in self.candidates]
        if len(book_ids) != len(set(book_ids)):
            raise ValueError("candidates.bookId must be unique")
        if len(isbn13s) != len(set(isbn13s)):
            raise ValueError("candidates.isbn13 must be unique")
        return self


class FeatureScore(BaseModel):
    key: FeatureKey
    rawScore: float | None = Field(ge=0, le=100)


class RecommendationBook(BaseModel):
    bookId: str
    isbn13: str
    title: str
    authors: list[str]
    publisher: str | None


class RecommendationItem(BaseModel):
    book: RecommendationBook
    rank: int = Field(ge=1)
    score: float = Field(ge=0, le=100)
    featureScores: list[FeatureScore]
    tags: list[str]
    reasonText: str
    reasonType: ReasonType


class RecommendationResponse(BaseModel):
    recommendationId: str
    userId: str
    generatedAt: datetime
    mode: RecommendationMode
    modelVersion: str
    fallback: bool
    basedOnCount: int = Field(ge=0)
    weights: RecommendationWeights
    appliedTags: list[str]
    items: list[RecommendationItem]


app = FastAPI(title="B102 Recommendation API", version="0.1.0")


def _to_d4l_book(candidate: CandidateBook) -> D4LBook:
    return D4LBook(
        isbn13=candidate.isbn13,
        title=candidate.title,
        authors=" ".join(candidate.authors),
        publisher=candidate.publisher or "",
        pub_year=None,
        class_no=None,
        class_nm=None,
        description=candidate.description,
        keywords=tuple(candidate.keywords),
        loan_total=round(candidate.rankScore or candidate.loan24m + 4 * candidate.loan3m),
        co_loan=(),
    )


def _normalized(value: int | float, maximum: int | float) -> float | None:
    if maximum <= 0:
        return None
    return round(min(100.0, value / maximum * 100), 4)


def _feature_scores(
    candidate: CandidateBook,
    taste: float | None,
    candidates: list[CandidateBook],
) -> dict[FeatureKey, float | None]:
    max_loan24m = max((book.loan24m for book in candidates), default=0)
    max_loan3m = max((book.loan3m for book in candidates), default=0)
    return {
        "taste": round(taste, 4) if taste is not None else None,
        "coLoan": None,
        "trending": _normalized(candidate.loan3m, max_loan3m),
        "steady": _normalized(candidate.loan24m, max_loan24m),
        "newField": None,
    }


def _weighted_score(features: dict[FeatureKey, float | None], weights: RecommendationWeights) -> float:
    weight_values = weights.model_dump()
    available = [(features[key], weight_values[key]) for key in features if features[key] is not None and weight_values[key] > 0]
    if not available:
        return 0.0
    numerator = sum(value * weight for value, weight in available)
    denominator = sum(weight for _, weight in available)
    return round(numerator / denominator, 4)


def _item(
    candidate: CandidateBook,
    *,
    rank: int,
    taste: float | None,
    request: RecommendationRequest,
    reason_type: ReasonType,
    candidates: list[CandidateBook],
) -> RecommendationItem:
    features = _feature_scores(candidate, taste, candidates)
    score = _weighted_score(features, request.weights)
    feature_scores = [FeatureScore(key=key, rawScore=value) for key, value in features.items() if value is not None]
    tags = ["#내취향근접"] if reason_type == "TEXT_SIMILARITY" else ["#지금뜨는"]
    if features["steady"] is not None and features["steady"] >= 70:
        tags.append("#스테디셀러")
    reason_text = (
        "관심 도서의 콘텐츠와 가까운 책이에요."
        if reason_type == "TEXT_SIMILARITY"
        else "최근 대출 수요가 높은 책이에요."
    )
    return RecommendationItem(
        book=RecommendationBook(
            bookId=candidate.bookId,
            isbn13=candidate.isbn13,
            title=candidate.title,
            authors=candidate.authors,
            publisher=candidate.publisher,
        ),
        rank=rank,
        score=score,
        featureScores=feature_scores,
        tags=tags,
        reasonText=reason_text,
        reasonType=reason_type,
    )


def generate_recommendations(request: RecommendationRequest) -> RecommendationResponse:
    candidates_by_id = {candidate.bookId: candidate for candidate in request.candidates}
    candidates_by_isbn = {candidate.isbn13: candidate for candidate in request.candidates}
    books = [_to_d4l_book(candidate) for candidate in request.candidates]
    books_by_isbn = {book.isbn13: book for book in books}
    excluded = set(request.excludeBookIds) | {item.bookId for item in request.library}

    seed = next((candidates_by_id[book_id] for book_id in request.seedBookIds if book_id in candidates_by_id), None)
    fallback = seed is None
    mode: RecommendationMode = "COLD_START" if fallback else request.mode
    if seed is not None:
        ranked = recommend_content(books, seed.isbn13, limit=len(books))
        reason_type: ReasonType = "TEXT_SIMILARITY"
    else:
        ranked = recommend_popular(books, "", limit=len(books))
        reason_type = "DEMAND_POPULAR"

    items: list[RecommendationItem] = []
    for result in ranked:
        candidate = candidates_by_isbn[result["isbn13"]]
        if candidate.bookId in excluded:
            continue
        taste = result["score"] * 100 if seed is not None else None
        items.append(
            _item(
                candidate,
                rank=len(items) + 1,
                taste=taste,
                request=request,
                reason_type=reason_type,
                candidates=request.candidates,
            )
        )
        if len(items) >= request.size:
            break

    return RecommendationResponse(
        recommendationId=f"rec_{uuid4().hex}",
        userId=request.userId,
        generatedAt=datetime.now(timezone.utc),
        mode=mode,
        modelVersion="tfidf-content-v1-api",
        fallback=fallback,
        basedOnCount=len(request.seedBookIds) - sum(book_id not in candidates_by_id for book_id in request.seedBookIds),
        weights=request.weights,
        appliedTags=request.interestTags,
        items=items,
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/internal/v1/recommendations", response_model=RecommendationResponse)
def create_recommendations(request: RecommendationRequest) -> RecommendationResponse:
    return generate_recommendations(request)
