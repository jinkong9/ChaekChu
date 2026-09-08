from __future__ import annotations

from collections import Counter
import math
from typing import Any

from recommendation.d4l import D4LBook, tokens


def _vectors(books: list[D4LBook]) -> list[dict[str, float]]:
    documents = [Counter(tokens(book)) for book in books]
    document_frequency: Counter[str] = Counter()
    for document in documents:
        document_frequency.update(document)
    total = len(books)
    vectors: list[dict[str, float]] = []
    for document in documents:
        vector = {
            term: (1.0 + math.log(count))
            * (math.log((total + 1) / (document_frequency[term] + 1)) + 1.0)
            for term, count in document.items()
        }
        vectors.append(vector)
    return vectors


def _cosine(left: dict[str, float], right: dict[str, float]) -> float:
    if not left or not right:
        return 0.0
    if len(left) > len(right):
        left, right = right, left
    dot = sum(value * right.get(term, 0.0) for term, value in left.items())
    left_norm = math.sqrt(sum(value * value for value in left.values()))
    right_norm = math.sqrt(sum(value * value for value in right.values()))
    return dot / (left_norm * right_norm) if left_norm and right_norm else 0.0


def _result(book: D4LBook, score: float, rank: int) -> dict[str, Any]:
    return {
        "rank": rank,
        "isbn13": book.isbn13,
        "title": book.title,
        "authors": book.authors,
        "score": round(score, 6),
        "loanTotal": book.loan_total,
    }


def _recommend_from_vectors(
    books: list[D4LBook],
    vectors: list[dict[str, float]],
    query_position: int,
    limit: int,
) -> list[dict[str, Any]]:
    ranked = sorted(
        (
            (_cosine(vectors[query_position], vector), book)
            for position, (book, vector) in enumerate(zip(books, vectors))
            if position != query_position
        ),
        key=lambda item: (-item[0], item[1].isbn13),
    )
    return [_result(book, score, rank) for rank, (score, book) in enumerate(ranked[:limit], start=1)]


def recommend_content(books: list[D4LBook], query_isbn: str, limit: int = 10) -> list[dict[str, Any]]:
    if limit < 1:
        raise ValueError("limit must be positive")
    index = {book.isbn13: position for position, book in enumerate(books)}
    if query_isbn not in index:
        raise ValueError(f"query isbn13 was not found: {query_isbn}")
    return _recommend_from_vectors(books, _vectors(books), index[query_isbn], limit)


def recommend_popular(books: list[D4LBook], query_isbn: str, limit: int = 10) -> list[dict[str, Any]]:
    ranked = sorted(
        (book for book in books if book.isbn13 != query_isbn),
        key=lambda book: (-book.loan_total, book.isbn13),
    )
    return [_result(book, float(book.loan_total), rank) for rank, book in enumerate(ranked[:limit], start=1)]


def _metric(recommendations: list[dict[str, Any]], target: set[str], k: int) -> tuple[int, float]:
    hits = sum(item["isbn13"] in target for item in recommendations[:k])
    return hits, hits / k if k else 0.0


def evaluate_content(books: list[D4LBook], k: int = 10, recall_k: int = 20) -> dict[str, Any]:
    if k < 1 or recall_k < k:
        raise ValueError("recall_k must be greater than or equal to k, and both must be positive")
    known_isbns = {book.isbn13 for book in books}
    index = {book.isbn13: position for position, book in enumerate(books)}
    vectors = _vectors(books)
    content_p: list[float] = []
    popular_p: list[float] = []
    recalls: list[float] = []
    reciprocal_ranks: list[float] = []
    covered_targets = 0
    total_targets = 0
    evaluated = 0
    for book in books:
        target = set(book.co_loan) & known_isbns
        if not target:
            continue
        evaluated += 1
        covered_targets += len(target)
        total_targets += len(book.co_loan)
        content = _recommend_from_vectors(books, vectors, index[book.isbn13], recall_k)
        popular = recommend_popular(books, book.isbn13, limit=k)
        content_hits, content_precision = _metric(content, target, k)
        _, popular_precision = _metric(popular, target, k)
        content_p.append(content_precision)
        popular_p.append(popular_precision)
        recalls.append(_metric(content, target, recall_k)[0] / len(target))
        first_hit = next((position for position, item in enumerate(content[:k], start=1) if item["isbn13"] in target), None)
        reciprocal_ranks.append(1.0 / first_hit if first_hit else 0.0)
    return {
        "algorithm": "tfidf-content-v1",
        "queries": len(books),
        "evaluatedQueries": evaluated,
        "targetCoverage": round(covered_targets / total_targets, 6) if total_targets else 0.0,
        "pAt10": round(sum(content_p) / len(content_p), 6) if content_p else 0.0,
        "popularPAt10": round(sum(popular_p) / len(popular_p), 6) if popular_p else 0.0,
        "recallAt20": round(sum(recalls) / len(recalls), 6) if recalls else 0.0,
        "mrrAt10": round(sum(reciprocal_ranks) / len(reciprocal_ranks), 6) if reciprocal_ranks else 0.0,
        "k": k,
        "recallK": recall_k,
    }
