from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import re
from typing import Any, Literal, Protocol

from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field, model_validator

from recommendation.dedup import deduplicate_candidates, join_relation_isbns
from recommendation.fallback import RecommendationFallbackPolicy
from recommendation.query_vector import QueryTagPreference, QueryVectorBuilder
from recommendation.reranking import HybridWeights
from recommendation.top_k import TopKRecommendationRanker
from recommendation.vector_search import CandidateSearchRequest, CandidateSearchResponse, CandidateHit, SearchStatus


RecommendationMode = Literal["COLD_START", "PERSONALIZED"]
ReasonType = Literal["CO_LOAN", "MANIA_REC", "READER_REC", "SAME_AUTHOR", "SAME_CATEGORY", "DEMAND_POPULAR"]
RELATION_FIELDS = ("co_loan", "mania_rec", "reader_rec")
MONTH_PATTERN = re.compile(r"^\d{4}년 (0[1-9]|1[0-2])월$")


class RecommendationWeights(BaseModel):
    """Weights accepted by both the current contract and the legacy snapshot path."""

    model_config = ConfigDict(extra="forbid")

    semantic: float = Field(default=0.45, ge=0)
    tagMatch: float = Field(default=0.25, ge=0)
    coLoan: float = Field(default=0.15, ge=0)
    trending: float = Field(default=0.10, ge=0)
    steady: float = Field(default=0.05, ge=0)
    # Kept only so old snapshot requests remain readable during migration.
    taste: float | None = Field(default=None, ge=0)
    newField: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_positive_weight(self) -> "RecommendationWeights":
        if sum(getattr(self, name) for name in ("semantic", "tagMatch", "coLoan", "trending", "steady")) <= 0:
            if self.taste is None or self.taste <= 0:
                raise ValueError("at least one recommendation weight must be greater than zero")
        return self

    def hybrid(self) -> HybridWeights:
        return HybridWeights.from_mapping(
            {
                "semantic": self.semantic,
                "tagMatch": self.tagMatch,
                "coLoan": self.coLoan,
                "trending": self.trending,
                "steady": self.steady,
            }
        )


class TagPreference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, pattern=r"^[A-Z][A-Z0-9_]{1,39}$")
    weight: float = Field(default=1.0, ge=0, le=1)


class D4LBookInput(BaseModel):
    """The API boundary mirrors fields present in the D4L source snapshot."""

    isbn13: str = Field(pattern=r"^97[89]\d{10}$")
    ok: bool | None = None
    bookname: str = Field(min_length=1)
    authors: str | None = None
    publisher: str | None = None
    pub_year: str | None = None
    class_no: str | None = None
    class_nm: str | None = None
    add_symbol: str | None = None
    loan_total: int = Field(ge=0)
    co_loan: list[list[str]] = Field(default_factory=list)
    mania_rec: list[list[str]] = Field(default_factory=list)
    reader_rec: list[list[str]] = Field(default_factory=list)
    loan_history: list[list[Any]] = Field(default_factory=list)


class RecommendationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requestId: str = Field(min_length=1)
    userId: str = Field(min_length=1)
    mode: RecommendationMode
    size: int = Field(default=5, ge=1, le=10)
    seedIsbns: list[str] = Field(default_factory=list)
    excludeIsbns: list[str] = Field(default_factory=list)
    tags: list[TagPreference] = Field(default_factory=list)
    weights: RecommendationWeights = Field(default_factory=RecommendationWeights)
    # Deprecated compatibility input. New Spring Boot requests must omit it.
    books: list[D4LBookInput] | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def validate_snapshot(self) -> "RecommendationRequest":
        for field_name in ("seedIsbns", "excludeIsbns"):
            values = getattr(self, field_name)
            if any(not re.fullmatch(r"^97[89]\d{10}$", isbn) for isbn in values):
                raise ValueError(f"{field_name} must contain valid ISBN13 values")
            if len(values) != len(set(values)):
                raise ValueError(f"{field_name} must not contain duplicate ISBN13 values")
        if self.books is None:
            return self
        isbns = [book.isbn13 for book in self.books]
        if len(isbns) != len(set(isbns)):
            raise ValueError("books.isbn13 must be unique")
        for book in self.books:
            for field in RELATION_FIELDS:
                for position, item in enumerate(getattr(book, field)):
                    if len(item) < 2 or not item[0] or not item[1]:
                        raise ValueError(f"{field}[{position}] must contain isbn13 and title")
            for position, item in enumerate(book.loan_history):
                if (
                    len(item) < 3
                    or not isinstance(item[0], str)
                    or MONTH_PATTERN.fullmatch(item[0]) is None
                    or not isinstance(item[1], int)
                    or isinstance(item[1], bool)
                    or item[1] < 0
                    or not isinstance(item[2], int)
                    or isinstance(item[2], bool)
                    or item[2] < 0
                ):
                    raise ValueError(f"loan_history[{position}] must be [YYYY년 MM월, non-negative integer, non-negative integer]")
        return self


class RecommendationBook(BaseModel):
    isbn13: str
    bookname: str
    authors: str | None
    publisher: str | None
    pub_year: str | None
    class_no: str | None
    class_nm: str | None


class FeatureScore(BaseModel):
    key: Literal["taste", "coLoan", "trending", "steady", "newField"]
    rawScore: float | None = Field(ge=0, le=100)


class RecommendationItem(BaseModel):
    book: RecommendationBook
    rank: int = Field(ge=1)
    score: float = Field(ge=0, le=100)
    featureScores: list[FeatureScore]
    tags: list[str]
    reasonText: str
    reasonType: ReasonType


ContractReasonType = Literal["TAG_MATCH", "SEMANTIC", "CO_LOAN", "TRENDING", "STEADY"]


class ContractReason(BaseModel):
    type: ContractReasonType
    text: str = Field(min_length=1)


class ContractRecommendationItem(BaseModel):
    isbn13: str = Field(pattern=r"^97[89]\d{10}$")
    rank: int = Field(ge=1)
    score: float = Field(ge=0, le=100)
    featureScores: dict[str, float | None]
    matchedTags: list[str]
    primaryReason: ContractReason | None
    reasons: list[ContractReason]


class ContractRecommendationResponse(BaseModel):
    recommendationId: str
    requestId: str
    userId: str
    modelVersion: str
    indexVersion: str | None
    fallback: bool
    items: list[ContractRecommendationItem]


class RecommendationResponse(BaseModel):
    recommendationId: str
    requestId: str
    userId: str
    generatedAt: datetime
    mode: RecommendationMode
    modelVersion: str
    indexVersion: str | None = None
    fallback: bool
    basedOnCount: int = Field(ge=0)
    weights: RecommendationWeights
    appliedTags: list[str]
    items: list[RecommendationItem]


app = FastAPI(title="B102 Recommendation API", version="0.3.0")


def _relation_map(book: D4LBookInput, isbn: str) -> dict[str, float]:
    scores: dict[str, float] = {}
    field_weights = {"co_loan": 1.0, "mania_rec": 0.75, "reader_rec": 0.5}
    for field, field_weight in field_weights.items():
        relation = getattr(book, field)
        if isbn not in join_relation_isbns(relation, {isbn}):
            continue
        for rank, item in enumerate(relation, start=1):
            if item[0].strip() == isbn:
                scores[field] = field_weight / rank
                break
    return scores


def _latest_loan(book: D4LBookInput) -> int:
    return max((item[1] for item in book.loan_history), default=0)


def _same_author(left: D4LBookInput, right: D4LBookInput) -> bool:
    return bool(left.authors and right.authors and left.authors.strip() == right.authors.strip())


def _same_category(left: D4LBookInput, right: D4LBookInput) -> bool:
    if left.class_no and right.class_no and left.class_no == right.class_no:
        return True
    return bool(left.class_nm and right.class_nm and left.class_nm.split(" > ")[0] == right.class_nm.split(" > ")[0])


def _metadata_score(seed: D4LBookInput, candidate: D4LBookInput) -> float:
    score = 0.0
    if _same_author(seed, candidate):
        score += 60.0
    if _same_category(seed, candidate):
        score += 40.0
    elif seed.publisher and candidate.publisher and seed.publisher == candidate.publisher:
        score += 15.0
    return min(100.0, score)


def _normalized(value: int | float, maximum: int | float) -> float | None:
    if maximum <= 0:
        return None
    return round(min(100.0, value / maximum * 100), 4)


def _weighted_score(features: dict[str, float | None], weights: RecommendationWeights) -> float:
    weight_values = {
        "taste": weights.taste if weights.taste is not None else weights.semantic,
        "coLoan": weights.coLoan,
        "trending": weights.trending,
        "steady": weights.steady,
        "newField": weights.newField if weights.newField is not None else 0.0,
    }
    available = [(value, weight_values[key]) for key, value in features.items() if value is not None and weight_values[key] > 0]
    if not available:
        return 0.0
    return round(sum(value * weight for value, weight in available) / sum(weight for _, weight in available), 4)


def _reason(
    relation_scores: dict[str, float], metadata_score: float, seed: D4LBookInput | None, candidate: D4LBookInput | None
) -> tuple[ReasonType, list[str], str]:
    if "co_loan" in relation_scores:
        return "CO_LOAN", ["#함께대출"], "관심 도서와 함께 대출된 책이에요."
    if "mania_rec" in relation_scores:
        return "MANIA_REC", ["#마니아추천"], "관심 도서와 함께 마니아 추천 목록에 있는 책이에요."
    if "reader_rec" in relation_scores:
        return "READER_REC", ["#다독자추천"], "관심 도서와 함께 다독자 추천 목록에 있는 책이에요."
    if seed is not None and candidate is not None and _same_author(seed, candidate):
        return "SAME_AUTHOR", ["#같은작가"], "관심 도서와 같은 저자의 책이에요."
    if metadata_score > 0:
        return "SAME_CATEGORY", ["#같은분류"], "관심 도서와 같은 분류의 책이에요."
    return "DEMAND_POPULAR", ["#지금뜨는"], "최근 대출 수요가 높은 책이에요."


def generate_recommendations(request: RecommendationRequest) -> RecommendationResponse:
    if request.books is None:
        raise ValueError("books snapshot is required for the legacy recommendation function")
    books = deduplicate_candidates(request.books)
    books_by_isbn = {book.isbn13: book for book in books}
    excluded = set(request.excludeIsbns) | set(request.seedIsbns)
    seeds = [books_by_isbn[isbn] for isbn in request.seedIsbns if isbn in books_by_isbn]
    fallback = not seeds
    mode: RecommendationMode = "COLD_START" if fallback else request.mode
    max_total = max((book.loan_total for book in books), default=0)
    max_latest = max((_latest_loan(book) for book in books), default=0)
    ranked: list[tuple[float, D4LBookInput, dict[str, float | None], ReasonType, list[str], str]] = []

    for candidate in books:
        if candidate.isbn13 in excluded:
            continue
        relation_scores: dict[str, float] = {}
        metadata_score = 0.0
        for seed in seeds:
            for relation, score in _relation_map(seed, candidate.isbn13).items():
                relation_scores[relation] = max(relation_scores.get(relation, 0.0), score)
            metadata_score = max(metadata_score, _metadata_score(seed, candidate))
        relation_score = max(relation_scores.values(), default=0.0) * 100
        features: dict[str, float | None] = {
            "taste": metadata_score if seeds else None,
            "coLoan": relation_score if relation_scores else None,
            "trending": _normalized(_latest_loan(candidate), max_latest),
            "steady": _normalized(candidate.loan_total, max_total),
            "newField": None,
        }
        reason_type, tags, reason_text = _reason(relation_scores, metadata_score, seeds[0] if seeds else None, candidate)
        ranked.append((_weighted_score(features, request.weights), candidate, features, reason_type, tags, reason_text))

    ranked.sort(key=lambda item: (-item[0], -item[1].loan_total, item[1].isbn13))
    items: list[RecommendationItem] = []
    for score, candidate, features, reason_type, tags, reason_text in ranked[: request.size]:
        items.append(
            RecommendationItem(
                book=RecommendationBook(
                    isbn13=candidate.isbn13,
                    bookname=candidate.bookname,
                    authors=candidate.authors,
                    publisher=candidate.publisher,
                    pub_year=candidate.pub_year,
                    class_no=candidate.class_no,
                    class_nm=candidate.class_nm,
                ),
                rank=len(items) + 1,
                score=score,
                featureScores=[FeatureScore(key=key, rawScore=value) for key, value in features.items()],
                tags=tags,
                reasonText=reason_text,
                reasonType=reason_type,
            )
        )

    recommendation_seed = f"{request.requestId}|{request.userId}|d4l-relations-v1"
    recommendation_id = f"rec_{hashlib.sha256(recommendation_seed.encode()).hexdigest()[:16]}"
    return RecommendationResponse(
        recommendationId=recommendation_id,
        requestId=request.requestId,
        userId=request.userId,
        generatedAt=datetime.now(timezone.utc),
        mode=mode,
        modelVersion="d4l-relations-v1",
        indexVersion=None,
        fallback=fallback,
        basedOnCount=len(seeds),
        weights=request.weights,
        appliedTags=[],
        items=items,
    )


class ContractRecommendationEngine(Protocol):
    def recommend(self, request: RecommendationRequest) -> ContractRecommendationResponse: ...


class EmptyRecommendationEngine:
    """Safe default until an embedding/index runtime is configured."""

    model_version = "d4l-hybrid-v1"
    index_version = None

    def recommend(self, request: RecommendationRequest) -> ContractRecommendationResponse:
        return _contract_response(
            request,
            items=(),
            model_version=self.model_version,
            index_version=self.index_version,
            fallback=True,
        )


class IndexedRecommendationEngine:
    """Connect the online DTO to the already implemented query/search/ranking stages.

    The engine is deliberately injected into the FastAPI app. Production wiring can
    provide Qdrant and the batch-built vector stores, while tests use in-memory stores.
    """

    def __init__(
        self,
        *,
        query_builder: QueryVectorBuilder,
        search_service: Any,
        demand_candidates: tuple[CandidateHit, ...] = (),
        model_version: str = "d4l-hybrid-v1",
    ) -> None:
        self.query_builder = query_builder
        self.search_service = search_service
        self.demand_candidates = tuple(demand_candidates)
        self.model_version = model_version
        self.fallback_policy = RecommendationFallbackPolicy(model_version=model_version)

    @property
    def index_version(self) -> str:
        return self.query_builder.index_version

    def recommend(self, request: RecommendationRequest) -> ContractRecommendationResponse:
        requested_tags = {tag.code: tag.weight for tag in request.tags if tag.weight > 0}
        query = self.query_builder.build(
            mode=request.mode,
            seed_isbns=request.seedIsbns,
            tags=(QueryTagPreference(code, weight) for code, weight in requested_tags.items()),
            weights={
                "semantic": request.weights.semantic,
                "tagMatch": request.weights.tagMatch,
            },
        )

        if query.query_vector is None:
            search = CandidateSearchResponse(
                # No query vector means the personalized path is unavailable;
                # let the shared policy select the demand fallback.
                status=SearchStatus.INDEX_NOT_FOUND,
                index_version=self.index_version,
                requested_limit=request.size,
                returned_count=0,
                reason=query.reason.value,
            )
        else:
            candidate_limit = min(300, max(100, request.size * 20))
            search = self.search_service.search(
                CandidateSearchRequest(
                    query_vector=query.query_vector,
                    limit=candidate_limit,
                    exclude_isbns=frozenset(request.excludeIsbns),
                    seed_isbns=frozenset(request.seedIsbns),
                    index_version=self.index_version,
                )
            )

        resolved = self.fallback_policy.resolve(
            search,
            demand_candidates=self.demand_candidates,
            exclude_isbns=request.excludeIsbns,
            seed_isbns=request.seedIsbns,
            requested_size=request.size,
        )
        ranked = TopKRecommendationRanker(request.weights.hybrid()).rank(
            resolved.items,
            size=request.size,
            seed_isbns=request.seedIsbns,
            exclude_isbns=request.excludeIsbns,
            requested_tags=requested_tags,
        )
        items = tuple(_contract_item(item) for item in ranked.items)
        return _contract_response(
            request,
            items=items,
            model_version=self.model_version,
            index_version=resolved.index_version,
            fallback=resolved.fallback,
        )


def _contract_item(item: Any) -> ContractRecommendationItem:
    feature_scores = item.feature_scores.as_dict()
    reasons = [ContractReason(type=reason.type, text=reason.text) for reason in item.reasons]
    primary = ContractReason(type=item.primary_reason.type, text=item.primary_reason.text) if item.primary_reason else None
    return ContractRecommendationItem(
        isbn13=item.isbn13,
        rank=item.rank,
        score=item.score,
        featureScores=feature_scores,
        matchedTags=list(item.matched_tags),
        primaryReason=primary,
        reasons=reasons,
    )


def _contract_response(
    request: RecommendationRequest,
    *,
    items: tuple[ContractRecommendationItem, ...],
    model_version: str,
    index_version: str | None,
    fallback: bool,
) -> ContractRecommendationResponse:
    seed = f"{request.requestId}|{request.userId}|{model_version}|{index_version or 'none'}"
    recommendation_id = f"rec_{hashlib.sha256(seed.encode()).hexdigest()[:16]}"
    return ContractRecommendationResponse(
        recommendationId=recommendation_id,
        requestId=request.requestId,
        userId=request.userId,
        modelVersion=model_version,
        indexVersion=index_version,
        fallback=fallback,
        items=list(items),
    )


def configure_recommendation_engine(engine: ContractRecommendationEngine) -> None:
    """Install the production or test engine without coupling app creation to Qdrant."""

    app.state.recommendation_engine = engine


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post(
    "/internal/v1/recommendations",
    response_model=RecommendationResponse | ContractRecommendationResponse,
)
def create_recommendations(request: RecommendationRequest) -> RecommendationResponse | ContractRecommendationResponse:
    if request.books is not None:
        return generate_recommendations(request)
    engine = getattr(app.state, "recommendation_engine", None) or EmptyRecommendationEngine()
    return engine.recommend(request)
